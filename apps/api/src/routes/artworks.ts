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
// Reader access: a member of the collection always; a visitor on the live
// PUBLISHED works in the list, and a single work of a PUBLIC collection
// when the work itself is published and live — the collection is the whole
// gate (docs/adr/0003). The single read, the list read and the read-back
// after a save all go through artworkRead.ts, which now owns the list's SQL
// filter too; a test pins that filter and the verdict together.
//
// Writer access: any member, the owner or a collaborator, for every route
// here (ADR-0004). A save by a collaborator promotes THEIR staged entries
// onto the collection's final keys, but records `artworks.userId` as the
// collection's owner — the mirror, never the session user.

import { asc, eq } from "drizzle-orm";
import {
  artworks as artworksTable,
  artworkDocuments as artworkDocumentsTable,
  artworkPhotos as artworkPhotosTable,
} from "@arcula/db";
import {
  MAX_ARTWORK_DOCUMENTS,
  MAX_ARTWORK_PHOTOS,
  UPDATABLE_TEXT_FIELDS,
  artworkCreateSchema,
  artworkUpdateSchema,
  type ArtworkCreatePayload,
  type ArtworkRead,
  type ArtworkUpdatePayload,
  type StagedEntry,
} from "@arcula/shared";
import { Hono } from "hono";
import { readArtwork, readArtworkList } from "../artworkRead";
import {
  loadArtworkById,
  requireMemberArtwork,
  requireMemberCollection,
} from "../authorize";
import { db } from "../db";
import { ApiError } from "../errors";
import { param, parseBody, safeTx } from "../http";
import { deleteObject } from "../storage";
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

/** The work a save must read back; absence after a successful save is a
 *  server bug, not a half-shaped response. */
async function readSavedArtwork(
  collectionId: string,
  artworkId: string,
  viewer: string,
): Promise<ArtworkRead> {
  const read = await readArtwork(collectionId, artworkId, viewer);
  if (read.status !== "ok") {
    throw new ApiError("internal", "The saved artwork could not be read back");
  }
  return read.artwork;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const artworkRoutes = new Hono();

// GET one — a member always; a visitor when collection and work both admit it.
artworkRoutes.get(
  "/collections/:collectionId/artworks/:artworkId",
  async (c) => {
    const session = await resolveSession(c);
    const collectionId = param(c, "collectionId");
    const read = await readArtwork(
      collectionId,
      param(c, "artworkId"),
      session?.user.id ?? null,
    );
    // A draft work, a deleted work and a public work inside a private
    // collection are one uniform 404 for a visitor: saying which was
    // refused would be a disclosure.
    if (read.status !== "ok") {
      throw new ApiError("not-found", "The artwork does not exist");
    }
    return c.json(read.artwork);
  },
);

// GET list — member: every live work; non-member: the published ones; private
// collection: 403 (never 404 — the client maps the refusal to "private").
artworkRoutes.get("/collections/:collectionId/artworks", async (c) => {
  const session = await resolveSession(c);
  const collectionId = param(c, "collectionId");
  const read = await readArtworkList(collectionId, session?.user.id ?? null);
  if (read.status === "not-found") {
    throw new ApiError("not-found", "The collection does not exist");
  }
  if (read.status === "forbidden") {
    throw new ApiError(
      "forbidden",
      "You do not have access to this collection",
    );
  }
  return c.json(read.artworks);
});

// POST — create the row and promote the staged entries, one transaction.
artworkRoutes.post(
  "/collections/:collectionId/artworks",
  requireSession,
  async (c) => {
    const user = c.get("user");
    const collection = await requireMemberCollection(
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
        // The mirror of the collection's owner, not the session user: a
        // collaborator saves work into someone else's collection (ADR-0004).
        userId: collection.userId,
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
        collection,
        user.id,
        payload.artworkId,
        payload.photos,
        [],
      );
      const documents = await writeDocumentSequence(
        tx,
        collection,
        user.id,
        payload.artworkId,
        payload.documents,
        new Set(),
      );
      return [...photos.stagedKeys, ...documents.stagedKeys];
    });
    for (const key of stagedKeys) {
      await deleteObject(key);
    }

    const artworkRead = await readSavedArtwork(
      collection.id,
      payload.artworkId,
      user.id,
    );
    return c.json(artworkRead, 201);
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
    const { collection, artwork } = await requireMemberArtwork(
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
              collection,
              user.id,
              artwork.id,
              nextPhotos,
              currentPhotos,
            )
          : { stagedKeys: [], removedIds: [] };
      const documents =
        payload.documents !== undefined
          ? await writeDocumentSequence(
              tx,
              collection,
              user.id,
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
      collection,
      artwork.id,
      "photo",
      result.removedPhotos,
    );
    await deleteFinalEntryObjects(
      collection,
      artwork.id,
      "document",
      result.removedDocuments,
    );

    const artworkRead = await readSavedArtwork(
      collection.id,
      artwork.id,
      user.id,
    );
    return c.json(artworkRead);
  },
);
