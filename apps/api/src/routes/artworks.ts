// The artwork resource routes:
//
//   GET    /collections/{cid}/artworks            the collection's live works
//   POST   /collections/{cid}/artworks            create + promote staged entries
//   GET    /collections/{cid}/artworks/{aid}      one work
//   PATCH  /collections/{cid}/artworks/{aid}      edit fields + new sequence
//
// A save is one Postgres transaction: field write → per-entry S3 copy
// (staged → final) and row upserts → row deletes for entries dropped
// from the sequence. An S3 copy cannot roll back with the rows, so a
// failed save may leave final objects with no row — the accepted orphan
// residual. Staged objects are deleted only AFTER commit; what a failed
// save leaves behind is exactly what the sweep and the staging lifecycle
// exist to remove.
//
// Reader access: the owner always; a visitor on the collection's live
// PUBLISHED works in the list, and a single work of a PUBLIC collection
// when the work itself is published and live — the collection is the whole
// gate (docs/adr/0003). The list keeps its SQL filter; the single read calls
// the pure verdict in access.ts, and a test pins the two together.

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  artworks as artworksTable,
  artworkDocuments as artworkDocumentsTable,
  artworkPhotoVariants as artworkPhotoVariantsTable,
  artworkPhotos as artworkPhotosTable,
} from "@arcula/db";
import {
  MAX_ARTWORK_DOCUMENTS,
  MAX_ARTWORK_PHOTOS,
  UPDATABLE_TEXT_FIELDS,
  artworkCreateSchema,
  artworkUpdateSchema,
  type ArtworkCreatePayload,
  type ArtworkUpdatePayload,
  type StagedEntry,
} from "@arcula/shared";
import { Hono } from "hono";
import { canSeeArtwork, canSeeCollection, isOwner } from "../access";
import {
  loadArtworkById,
  loadArtworkInCollection,
  loadCollection,
  requireOwnedArtwork,
  requireOwnedCollection,
} from "../authorize";
import { db } from "../db";
import { ApiError } from "../errors";
import { param, parseBody, safeTx } from "../http";
import { deleteObject } from "../storage";
import { serializeArtwork, type ArtworkJoined } from "../serialize";
import { resolveSession, requireSession } from "../session";
import {
  assertEntriesFree,
  checkUniqueEntryIds,
  deleteFinalEntryObjects,
  tooMany,
  writeDocumentSequence,
  writePhotoSequence,
} from "./artworkSave";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The joined rows the serializer wants; 404 is the caller's, not this one's. */
async function loadJoinedOrNull(
  collectionId: string,
  artworkId: string,
): Promise<ArtworkJoined | null> {
  const artwork = await loadArtworkInCollection(collectionId, artworkId);
  if (!artwork) return null;
  const photos = await db
    .select()
    .from(artworkPhotosTable)
    .where(eq(artworkPhotosTable.artworkId, artworkId))
    .orderBy(asc(artworkPhotosTable.order));
  const documents = await db
    .select()
    .from(artworkDocumentsTable)
    .where(eq(artworkDocumentsTable.artworkId, artworkId))
    .orderBy(asc(artworkDocumentsTable.id));
  const parentIds = [...photos.map((p) => p.id), ...documents.map((d) => d.id)];
  const variants =
    parentIds.length > 0
      ? await db
          .select()
          .from(artworkPhotoVariantsTable)
          .where(inArray(artworkPhotoVariantsTable.parentId, parentIds))
      : [];
  return { artwork, photos, documents, variants };
}

/** Read back after a save; the save just wrote it, so absence is a server bug. */
async function loadJoined(
  collectionId: string,
  artworkId: string,
): Promise<ArtworkJoined> {
  const joined = await loadJoinedOrNull(collectionId, artworkId);
  if (!joined) {
    throw new ApiError("internal", "The saved artwork could not be read back");
  }
  return joined;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const artworkRoutes = new Hono();

// GET one — owner always; a visitor when collection and work both admit it.
artworkRoutes.get(
  "/collections/:collectionId/artworks/:artworkId",
  async (c) => {
    const collectionId = param(c, "collectionId");
    const artworkId = param(c, "artworkId");
    const collection = await loadCollection(collectionId);
    if (!collection) {
      throw new ApiError("not-found", "The collection does not exist");
    }
    const artwork = await loadArtworkInCollection(collectionId, artworkId);
    if (!artwork) {
      throw new ApiError("not-found", "The artwork does not exist");
    }
    const session = await resolveSession(c);
    // A draft work, a deleted work and a public work inside a private
    // collection are one uniform 404 for a visitor: saying which was
    // refused would be a disclosure.
    if (!canSeeArtwork(session?.user.id ?? null, collection, artwork)) {
      throw new ApiError("not-found", "The artwork does not exist");
    }
    const joined = await loadJoined(collectionId, artworkId);
    return c.json(serializeArtwork(joined));
  },
);

// GET list — owner: every live work; visitor: the published ones; private
// collection: 403 (never 404 — the client maps the refusal to "private").
artworkRoutes.get("/collections/:collectionId/artworks", async (c) => {
  const collectionId = param(c, "collectionId");
  const collection = await loadCollection(collectionId);
  if (!collection) {
    throw new ApiError("not-found", "The collection does not exist");
  }
  const session = await resolveSession(c);
  const viewer = session?.user.id ?? null;

  let rows: (typeof artworksTable.$inferSelect)[];
  if (session !== null && isOwner(session.user.id, collection)) {
    rows = await db
      .select()
      .from(artworksTable)
      .where(
        and(
          eq(artworksTable.collectionId, collectionId),
          eq(artworksTable.userId, session.user.id),
          isNull(artworksTable.deletedAt),
        ),
      );
  } else if (canSeeCollection(viewer, collection)) {
    rows = await db
      .select()
      .from(artworksTable)
      .where(
        and(
          eq(artworksTable.collectionId, collectionId),
          eq(artworksTable.status, "published"),
          isNull(artworksTable.deletedAt),
        ),
      );
  } else {
    throw new ApiError(
      "forbidden",
      "You do not have access to this collection",
    );
  }

  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const joined = await loadJoined(collectionId, row.id);
    out.push(serializeArtwork(joined));
  }
  return c.json(out);
});

// POST — create the row and promote the staged entries, one transaction.
artworkRoutes.post(
  "/collections/:collectionId/artworks",
  requireSession,
  async (c) => {
    const user = c.get("user");
    const collection = await requireOwnedCollection(
      c,
      param(c, "collectionId"),
    );
    const payload: ArtworkCreatePayload = await parseBody(
      c,
      artworkCreateSchema,
    );

    // An id is a global primary key: reusing one would promote this
    // save's staged entries under the existing row's id.
    const clash = await loadArtworkById(payload.artworkId);
    if (clash) {
      throw new ApiError("validation", "The artwork id is already in use", {
        fields: { artworkId: "The artwork id is already in use" },
      });
    }
    checkUniqueEntryIds(payload.photos, "photos");
    checkUniqueEntryIds(payload.documents, "documents");
    if (payload.photos.length > MAX_ARTWORK_PHOTOS) {
      throw tooMany("photos", MAX_ARTWORK_PHOTOS);
    }
    if (payload.documents.length > MAX_ARTWORK_DOCUMENTS) {
      throw tooMany("documents", MAX_ARTWORK_DOCUMENTS);
    }
    await assertEntriesFree(
      "photo",
      payload.photos.map((e) => e.entryId),
    );
    await assertEntriesFree(
      "document",
      payload.documents.map((e) => e.entryId),
    );

    const now = new Date();
    const stagedKeys = await safeTx(async (tx) => {
      await tx.insert(artworksTable).values({
        id: payload.artworkId,
        userId: user.id,
        collectionId: collection.id,
        title: payload.title,
        artistName: payload.artistName,
        serie: payload.serie ?? null,
        dateOfCreation: payload.dateOfCreation ?? null,
        media: payload.media ?? null,
        dimensions: payload.dimensions ?? null,
        editions: payload.editions ?? null,
        acquisitionDate: payload.acquisitionDate ?? null,
        acquisitionPrice: payload.acquisitionPrice ?? null,
        placeOfOrigin: payload.placeOfOrigin ?? null,
        provenance: payload.provenance ?? null,
        notes: payload.notes ?? null,
        condition: payload.condition ?? null,
        currentValue: payload.currentValue ?? null,
        status: payload.status,
        // Always written, as null: the list filters on it, and a missing
        // field is not a null (the write-path doctrine).
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      const photos = await writePhotoSequence(
        tx,
        user.id,
        collection.id,
        payload.artworkId,
        payload.photos,
        [],
      );
      const documents = await writeDocumentSequence(
        tx,
        user.id,
        collection.id,
        payload.artworkId,
        payload.documents,
        new Set(),
      );
      return [...photos.stagedKeys, ...documents.stagedKeys];
    });
    for (const key of stagedKeys) {
      await deleteObject(key);
    }

    const joined = await loadJoined(collection.id, payload.artworkId);
    return c.json(serializeArtwork(joined), 201);
  },
);

// PATCH — the edit form: fields plus the full new sequences.
artworkRoutes.patch(
  "/collections/:collectionId/artworks/:artworkId",
  requireSession,
  async (c) => {
    const collectionId = param(c, "collectionId");
    const artworkId = param(c, "artworkId");
    const user = c.get("user");
    const { collection, artwork } = await requireOwnedArtwork(
      c,
      collectionId,
      artworkId,
    );
    const payload: ArtworkUpdatePayload = await parseBody(
      c,
      artworkUpdateSchema,
    );

    // Absent = leave the sequence alone; present = the full new one.
    const currentPhotos = await db
      .select()
      .from(artworkPhotosTable)
      .where(eq(artworkPhotosTable.artworkId, artwork.id))
      .orderBy(asc(artworkPhotosTable.order));
    // Documents carry no position column: id order is their canonical
    // sequence, and the serializer applies it. This read sorts for
    // determinism, but nothing downstream depends on its order —
    // `currentDocs` feeds only `storedDocIds`, the cap check and the
    // uniqueness check.
    const currentDocs = await db
      .select()
      .from(artworkDocumentsTable)
      .where(eq(artworkDocumentsTable.artworkId, artwork.id))
      .orderBy(asc(artworkDocumentsTable.id));
    const storedPhotoIds = new Set(currentPhotos.map((r) => r.id));
    const storedDocIds = new Set(currentDocs.map((r) => r.id));
    const nextPhotos: StagedEntry[] =
      payload.photos ??
      currentPhotos.map((r) => ({ entryId: r.id, name: r.name }));
    const nextDocs: StagedEntry[] =
      payload.documents ??
      currentDocs.map((r) => ({ entryId: r.id, name: r.name }));

    checkUniqueEntryIds(nextPhotos, "photos");
    checkUniqueEntryIds(nextDocs, "documents");
    if (nextPhotos.length > MAX_ARTWORK_PHOTOS) {
      throw tooMany("photos", MAX_ARTWORK_PHOTOS);
    }
    if (nextDocs.length > MAX_ARTWORK_DOCUMENTS) {
      throw tooMany("documents", MAX_ARTWORK_DOCUMENTS);
    }
    // Only the entries this save promotes: an id already stored for THIS
    // artwork is this artwork's own row, not a collision.
    await assertEntriesFree(
      "photo",
      nextPhotos
        .filter((e) => !storedPhotoIds.has(e.entryId))
        .map((e) => e.entryId),
    );
    await assertEntriesFree(
      "document",
      nextDocs
        .filter((e) => !storedDocIds.has(e.entryId))
        .map((e) => e.entryId),
    );

    const now = new Date();
    const result = await safeTx(async (tx) => {
      const set: Partial<typeof artworksTable.$inferInsert> = {
        title: payload.title,
        artistName: payload.artistName,
        updatedAt: now,
      };
      // Present sets (or, as null, clears); absent leaves the column.
      for (const field of UPDATABLE_TEXT_FIELDS) {
        if (payload[field] !== undefined) {
          set[field] = payload[field] ?? null;
        }
      }
      if (payload.status !== undefined) {
        set.status = payload.status;
      }
      await tx
        .update(artworksTable)
        .set(set)
        .where(eq(artworksTable.id, artwork.id));

      const photos =
        payload.photos !== undefined
          ? await writePhotoSequence(
              tx,
              user.id,
              collection.id,
              artwork.id,
              nextPhotos,
              currentPhotos,
            )
          : { stagedKeys: [], removedIds: [] };
      const documents =
        payload.documents !== undefined
          ? await writeDocumentSequence(
              tx,
              user.id,
              collection.id,
              artwork.id,
              nextDocs,
              storedDocIds,
            )
          : { stagedKeys: [], removedIds: [] };
      return {
        stagedKeys: [...photos.stagedKeys, ...documents.stagedKeys],
        removedPhotos: photos.removedIds,
        removedDocuments: documents.removedIds,
      };
    });

    for (const key of result.stagedKeys) {
      await deleteObject(key);
    }
    await deleteFinalEntryObjects(
      user.id,
      collection.id,
      artwork.id,
      "photo",
      result.removedPhotos,
    );
    await deleteFinalEntryObjects(
      user.id,
      collection.id,
      artwork.id,
      "document",
      result.removedDocuments,
    );

    const joined = await loadJoined(collection.id, artwork.id);
    return c.json(serializeArtwork(joined));
  },
);
