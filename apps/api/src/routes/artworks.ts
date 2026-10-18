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
// PUBLIC works in the list, and a single work by id when the work itself
// is public — the collection's flag does not hide a direct id read.

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
import { Hono, type Context } from "hono";
import {
  loadArtworkById,
  loadArtworkInCollection,
  loadCollection,
  requireOwnedArtwork,
  requireOwnedCollection,
} from "../authorize";
import { db } from "../db";
import { ApiError } from "../errors";
import { parseBody, safeTx, type Tx } from "../http";
import {
  finalDocumentPrefix,
  finalPhotoPrefix,
  parseMediaKey,
} from "../media/keys";
import { promoteEntry, type PromotedObject } from "../media/promote";
import { deleteObject, listObjects } from "../storage";
import { serializeArtwork, type ArtworkJoined } from "../serialize";
import { resolveSession, requireSession } from "../session";

// The route patterns guarantee these segments; `?? ""` only exists to
// satisfy Hono's optional param type. An empty segment 404s at the row
// lookup.
const param = (c: Context, key: string): string => c.req.param(key) ?? "";

const tooMany = (field: string, cap: number): ApiError =>
  new ApiError("validation", `An artwork may have at most ${cap} ${field}`, {
    fields: { [field]: `At most ${cap} allowed` },
  });

/** One entry listed twice is a client bug the save must refuse. */
function checkUniqueEntryIds(entries: StagedEntry[], field: string): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.entryId)) {
      throw new ApiError("validation", `Duplicate entry id in ${field}`, {
        fields: { [field]: "An entry id appears twice" },
      });
    }
    seen.add(entry.entryId);
  }
}

/**
 * Entry ids are primary keys across the whole table. The row upsert's
 * conflict branch sets only `order`/`name` — not `artworkId` — so reusing
 * an id that belongs to ANOTHER artwork would keep that artwork's row
 * instead of creating one. That is the silent drift this save exists to
 * prevent: refuse it, like the artworkId collision check on create.
 */
async function assertEntriesFree(
  population: "photo" | "document",
  entryIds: string[],
): Promise<void> {
  if (entryIds.length === 0) return;
  const field = population === "photo" ? "photos" : "documents";
  const taken =
    population === "photo"
      ? await db
          .select({ id: artworkPhotosTable.id })
          .from(artworkPhotosTable)
          .where(inArray(artworkPhotosTable.id, entryIds))
      : await db
          .select({ id: artworkDocumentsTable.id })
          .from(artworkDocumentsTable)
          .where(inArray(artworkDocumentsTable.id, entryIds));
  if (taken.length > 0) {
    throw new ApiError(
      "validation",
      `The entry id "${taken[0].id}" is already in use`,
      { fields: { [field]: "An entry id is already in use" } },
    );
  }
}

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
// Save helpers
// ---------------------------------------------------------------------------

/** Upsert one variant row: (parentId, key) is the primary key, which is
 *  exactly what makes a re-save of the same entry a no-op on the rows. */
async function upsertVariantRows(
  tx: Tx,
  parentKind: "photo" | "document",
  parentId: string,
  objects: PromotedObject[],
): Promise<void> {
  for (const object of objects) {
    await tx
      .insert(artworkPhotoVariantsTable)
      .values({
        parentKind,
        parentId,
        key: object.key,
        width: object.width,
        height: object.height,
        size: object.size,
        contentType: object.contentType,
      })
      .onConflictDoUpdate({
        target: [
          artworkPhotoVariantsTable.parentId,
          artworkPhotoVariantsTable.key,
        ],
        set: {
          width: object.width,
          height: object.height,
          size: object.size,
          contentType: object.contentType,
        },
      });
  }
}

/**
 * Far above any live order (the sequence is capped well below it). Parked
 * rows sit here between leaving their slot and taking their new one.
 */
const ORDER_SENTINEL_BASE = 100_000;

/**
 * Write the photo sequence: every payload entry gets its position as
 * `order` (the reindex), new entries are promoted, dropped entries lose
 * their rows (their final objects go AFTER commit, separately).
 *
 * Rows are rewritten in four passes because of the UNIQUE (artworkId,
 * order) constraint:
 *
 * 1. Removed rows are deleted FIRST — their slots must be free before
 *    anything else can land in one.
 * 2. Kept rows that must move are parked at a sentinel order, so the slot
 *    a new row will take is already vacated. Parking walks `current`
 *    order, not payload order: two concurrent saves then take row locks
 *    in the same order, which is what keeps them from deadlocking.
 * 3. New entries are inserted at their final position. Every final
 *    position is distinct, the kept rows are at their own finals or at
 *    sentinels, and the removed rows are gone — so no insert can collide
 *    with a live row, and two saves racing for the SAME slot still hit
 *    the constraint (the loser gets the 23505 → internal).
 * 4. Parked rows are brought home to their final order.
 */
async function writePhotoSequence(
  tx: Tx,
  userId: string,
  collectionId: string,
  artworkId: string,
  next: StagedEntry[],
  current: { id: string; order: number }[],
): Promise<{ stagedKeys: string[]; removedIds: string[] }> {
  const finalIndex = new Map(next.map((e, i) => [e.entryId, i]));
  const stored = new Set(current.map((row) => row.id));
  const stagedKeys: string[] = [];

  const removedIds = current
    .map((row) => row.id)
    .filter((id) => !finalIndex.has(id));
  if (removedIds.length > 0) {
    await tx
      .delete(artworkPhotoVariantsTable)
      .where(
        and(
          eq(artworkPhotoVariantsTable.parentKind, "photo"),
          inArray(artworkPhotoVariantsTable.parentId, removedIds),
        ),
      );
    await tx
      .delete(artworkPhotosTable)
      .where(
        and(
          eq(artworkPhotosTable.artworkId, artworkId),
          inArray(artworkPhotosTable.id, removedIds),
        ),
      );
  }

  // 2: park the movers. A kept row whose name changed but whose order did
  // not just gets the name updated in place.
  const parked: { id: string; final: number }[] = [];
  for (const row of current) {
    const final = finalIndex.get(row.id);
    if (final === undefined) continue;
    if (final !== row.order) {
      parked.push({ id: row.id, final });
      await tx
        .update(artworkPhotosTable)
        .set({ order: ORDER_SENTINEL_BASE + final, name: next[final].name })
        .where(eq(artworkPhotosTable.id, row.id));
    } else {
      await tx
        .update(artworkPhotosTable)
        .set({ name: next[final].name })
        .where(eq(artworkPhotosTable.id, row.id));
    }
  }

  // 3: the new entries, at their final positions. The array position is
  // the order — the first photo of a fresh artwork lands at order 0.
  for (let i = 0; i < next.length; i++) {
    const entry = next[i];
    if (stored.has(entry.entryId)) {
      continue;
    }
    const promoted = await promoteEntry({
      population: "photo",
      userId,
      collectionId,
      artworkId,
      entryId: entry.entryId,
    });
    stagedKeys.push(...promoted.stagedKeys);
    await upsertVariantRows(tx, "photo", entry.entryId, [
      promoted.original,
      ...promoted.variants,
    ]);
    await tx.insert(artworkPhotosTable).values({
      id: entry.entryId,
      artworkId,
      order: i,
      name: entry.name,
    });
  }

  // 4: bring the parked rows home.
  for (const { id, final } of parked) {
    await tx
      .update(artworkPhotosTable)
      .set({ order: final })
      .where(eq(artworkPhotosTable.id, id));
  }

  return { stagedKeys, removedIds };
}

/** The document sequence: no `order` — documents have no sequence. */
async function writeDocumentSequence(
  tx: Tx,
  userId: string,
  collectionId: string,
  artworkId: string,
  next: StagedEntry[],
  storedIds: Set<string>,
): Promise<{ stagedKeys: string[]; removedIds: string[] }> {
  const stagedKeys: string[] = [];
  for (const entry of next) {
    if (!storedIds.has(entry.entryId)) {
      const promoted = await promoteEntry({
        population: "document",
        userId,
        collectionId,
        artworkId,
        entryId: entry.entryId,
      });
      stagedKeys.push(...promoted.stagedKeys);
      await tx.insert(artworkDocumentsTable).values({
        id: entry.entryId,
        artworkId,
        kind: promoted.original.kind,
        name: entry.name,
        size: promoted.original.size,
        contentType: promoted.original.contentType,
        width: promoted.original.width,
        height: promoted.original.height,
      });
      // No `original` variant row for documents: the base row carries the
      // source's size/type/dimensions, and the serializer derives the
      // original's url from the key algebra.
      if (promoted.original.kind === "image") {
        await upsertVariantRows(
          tx,
          "document",
          entry.entryId,
          promoted.variants,
        );
      }
    } else {
      // Stored: the payload echoes the name; the metadata stays in the row
      // and the objects already sit on their final keys.
      await tx
        .update(artworkDocumentsTable)
        .set({ name: entry.name })
        .where(eq(artworkDocumentsTable.id, entry.entryId));
    }
  }
  const kept = new Set(next.map((e) => e.entryId));
  const removedIds = [...storedIds].filter((id) => !kept.has(id));
  if (removedIds.length > 0) {
    await tx
      .delete(artworkPhotoVariantsTable)
      .where(
        and(
          eq(artworkPhotoVariantsTable.parentKind, "document"),
          inArray(artworkPhotoVariantsTable.parentId, removedIds),
        ),
      );
    await tx
      .delete(artworkDocumentsTable)
      .where(
        and(
          eq(artworkDocumentsTable.artworkId, artworkId),
          inArray(artworkDocumentsTable.id, removedIds),
        ),
      );
  }
  return { stagedKeys, removedIds };
}

/**
 * Delete a removed entry's final objects, after the rows are committed.
 * Lists the entry's final prefix and filters through the parser — the
 * character-wise prefix alone reaches sibling entries (`abc_` matches
 * entry `abc_d`'s objects).
 */
async function deleteFinalEntryObjects(
  userId: string,
  collectionId: string,
  artworkId: string,
  population: "photo" | "document",
  entryIds: string[],
): Promise<void> {
  for (const entryId of entryIds) {
    const prefix =
      population === "photo"
        ? finalPhotoPrefix(userId, collectionId, artworkId, entryId)
        : finalDocumentPrefix(userId, collectionId, artworkId, entryId);
    const keys = await listObjects(prefix);
    for (const key of keys) {
      const parsed = parseMediaKey(key);
      if (parsed?.kind !== "final" || parsed.entryId !== entryId) continue;
      await deleteObject(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const artworkRoutes = new Hono();

// GET one — owner always; a visitor when the work is public and live.
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
    const isOwner = session !== null && artwork.userId === session.user.id;
    if (!isOwner) {
      // A private work and a deleted work are both a uniform 404 for a
      // visitor: saying which was refused would be a disclosure.
      if (artwork.deletedAt !== null || !artwork.isPublic) {
        throw new ApiError("not-found", "The artwork does not exist");
      }
    }
    const joined = await loadJoined(collectionId, artworkId);
    return c.json(serializeArtwork(joined));
  },
);

// GET list — owner: every live work; visitor: the public ones; private
// collection: 403 (never 404 — the client maps the refusal to "private").
artworkRoutes.get("/collections/:collectionId/artworks", async (c) => {
  const collectionId = param(c, "collectionId");
  const collection = await loadCollection(collectionId);
  if (!collection) {
    throw new ApiError("not-found", "The collection does not exist");
  }
  const session = await resolveSession(c);
  const isOwner = session !== null && collection.userId === session.user.id;

  let rows: (typeof artworksTable.$inferSelect)[];
  if (isOwner) {
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
  } else if (collection.isPublic) {
    rows = await db
      .select()
      .from(artworksTable)
      .where(
        and(
          eq(artworksTable.collectionId, collectionId),
          eq(artworksTable.isPublic, true),
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
        isPublic: payload.isPublic,
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
      if (payload.isPublic !== undefined) {
        set.isPublic = payload.isPublic;
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
