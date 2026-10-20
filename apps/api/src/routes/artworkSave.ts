// The write half of a save: what happens to the staged entries once the
// payload has been validated.
//
// A save is one Postgres transaction — field write, per-entry S3 copy
// (staged → final) and row upserts, then row deletes for entries dropped
// from the sequence. An S3 copy cannot roll back with the rows, so a failed
// save may leave final objects with no row: the accepted orphan residual.
// Staged objects are deleted only AFTER commit, which is why these helpers
// hand the staged keys back rather than deleting them themselves.
//
// Kept apart from `artworks.ts` because it is a different reason to change:
// the routes change with the resource's surface, this with how an entry is
// promoted and ordered.

import { and, eq, inArray } from "drizzle-orm";
import {
  artworkDocuments as artworkDocumentsTable,
  artworkPhotoVariants as artworkPhotoVariantsTable,
  artworkPhotos as artworkPhotosTable,
} from "@arcula/db";
import type { StagedEntry } from "@arcula/shared";
import type { CollectionRow } from "../authorize";
import { db } from "../db";
import { ApiError } from "../errors";
import type { Tx } from "../http";
import { mediaNamespaceOf, parseMediaKey } from "../media/keys";
import { POPULATIONS, type PopulationKind } from "../media/populations";
import { promoteEntry, type PromotedObject } from "../media/promote";
import { deleteObject, listObjects } from "../storage";

export const tooMany = (field: string, cap: number): ApiError =>
  new ApiError("validation", `An artwork may have at most ${cap} ${field}`, {
    fields: { [field]: `At most ${cap} allowed` },
  });

/** One entry listed twice is a client bug the save must refuse. */
export function checkUniqueEntryIds(
  entries: StagedEntry[],
  field: string,
): void {
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
export async function assertEntriesFree(
  kind: PopulationKind,
  entryIds: string[],
): Promise<void> {
  if (entryIds.length === 0) return;
  const { population, table } = POPULATIONS[kind];
  const taken = await db
    .select({ id: table.id })
    .from(table)
    .where(inArray(table.id, entryIds));
  if (taken.length > 0) {
    throw new ApiError(
      "validation",
      `The entry id "${taken[0].id}" is already in use`,
      { fields: { [population]: "An entry id is already in use" } },
    );
  }
}

// ---------------------------------------------------------------------------
// Save helpers
// ---------------------------------------------------------------------------

/** Upsert one variant row: (parentId, key) is the primary key, which is
 *  exactly what makes a re-save of the same entry a no-op on the rows. */
export async function upsertVariantRows(
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
export async function writePhotoSequence(
  tx: Tx,
  collection: CollectionRow,
  uploaderId: string,
  artworkId: string,
  next: StagedEntry[],
  current: { id: string; order: number }[],
): Promise<{ stagedKeys: string[]; removedIds: string[] }> {
  const collectionId = collection.id;
  const namespaceId = mediaNamespaceOf(collection);
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
      namespaceId,
      uploaderId,
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
export async function writeDocumentSequence(
  tx: Tx,
  collection: CollectionRow,
  uploaderId: string,
  artworkId: string,
  next: StagedEntry[],
  storedIds: Set<string>,
): Promise<{ stagedKeys: string[]; removedIds: string[] }> {
  const collectionId = collection.id;
  const namespaceId = mediaNamespaceOf(collection);
  const stagedKeys: string[] = [];
  for (const entry of next) {
    if (!storedIds.has(entry.entryId)) {
      const promoted = await promoteEntry({
        population: "document",
        namespaceId,
        uploaderId,
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
export async function deleteFinalEntryObjects(
  collection: CollectionRow,
  artworkId: string,
  kind: PopulationKind,
  entryIds: string[],
): Promise<void> {
  const { finalPrefix } = POPULATIONS[kind];
  const namespaceId = mediaNamespaceOf(collection);
  for (const entryId of entryIds) {
    const prefix = finalPrefix(namespaceId, collection.id, artworkId, entryId);
    const keys = await listObjects(prefix);
    for (const key of keys) {
      const parsed = parseMediaKey(key);
      if (parsed?.kind !== "final" || parsed.entryId !== entryId) continue;
      await deleteObject(key);
    }
  }
}
