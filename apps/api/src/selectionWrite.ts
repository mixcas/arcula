// The Selection write cores: create, update, delete and the two curation
// writes, as functions of an account id where they must ask the membership
// verdict themselves, and of the already-authorized row where a route has just
// asked it.
//
// No Hono type lives here — the route owns the status codes and the envelope,
// exactly as `catalogueWrite.ts` splits the work with `routes/catalogues.ts`.
// A Selection is not counted against any plan and owns no media, so nothing
// here touches `limits.ts`, the source Catalogue or its works.
//
// The two curation writes are one rule with two shapes: every id must be a
// live work of the **source** Catalogue, both rewrite the positions to
// `0..n-1`, and both run in one transaction. Append skips what is already
// there (a double click is harmless); replace states the whole list (the
// reorder and the remove, empty included).

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  artworks as artworksTable,
  selectionAccessGrants as grantsTable,
  selectionWorks as selectionWorksTable,
  selections as selectionsTable,
} from "@arcula/db";
import type {
  SelectionCreatePayload,
  SelectionRead,
  SelectionUpdatePayload,
} from "@arcula/shared";
import {
  loadSelection,
  memberCatalogueForSelection,
  memberSelectionFor,
  type SelectionRow,
} from "./authorize";
import { hashPassword } from "./cataloguePassword";
import { db } from "./db";
import { ApiError } from "./errors";
import { safeTx, type Tx } from "./http";
import { mintId } from "./ids";
import { readSelection } from "./selectionRead";

/**
 * Create a Selection cut from this Catalogue and answer it as a member read.
 *
 * The id is minted like any other row's; `isPublic` defaults to false in the
 * schema, so a caller that says nothing starts Private. Nothing else is
 * written: the Selection owns no skin, no media and no works yet.
 */
export async function createSelection(
  userId: string,
  catalogueId: string,
  payload: SelectionCreatePayload,
): Promise<SelectionRead> {
  await memberCatalogueForSelection(userId, catalogueId);
  const id = mintId();
  const now = new Date();
  await db.insert(selectionsTable).values({
    id,
    catalogueId,
    name: payload.name,
    description: payload.description ?? null,
    isPublic: payload.isPublic,
    createdAt: now,
    updatedAt: now,
  });
  // The insert just committed; a failed read-back is a server bug.
  const row = await loadSelection(catalogueId, id);
  if (!row) {
    throw new ApiError(
      "internal",
      "The created selection could not be read back",
    );
  }
  return readSelection(row);
}

/**
 * Write an already-authorized Selection and answer it as a member read.
 *
 * Present sets (or, as `null`, clears), absent leaves the column. A body that
 * names nothing writes nothing — no column moves and `updatedAt` is left
 * alone, so "updated" continues to mean something was. The name is required
 * and trimmed by the request schema, so an empty one never reaches here.
 *
 * A password present means a write: a string sets or overwrites it, `null`
 * removes it, and either revokes every grant the Selection has issued in the
 * same transaction, so a reader can never keep access to the old password. The
 * hash is computed before the transaction because it touches no row.
 */
export async function writeSelection(
  selection: SelectionRow,
  payload: SelectionUpdatePayload,
): Promise<SelectionRead> {
  const passwordHash =
    payload.password === undefined
      ? undefined
      : payload.password === null
        ? null
        : await hashPassword(payload.password);

  const set: Partial<typeof selectionsTable.$inferInsert> = {};
  if (payload.name !== undefined) {
    set.name = payload.name;
  }
  if (payload.description !== undefined) {
    set.description = payload.description ?? null;
  }
  if (payload.isPublic !== undefined) {
    set.isPublic = payload.isPublic;
  }
  if (passwordHash !== undefined) {
    set.passwordHash = passwordHash;
  }
  if (Object.keys(set).length > 0) {
    set.updatedAt = new Date();
    await safeTx(async (tx) => {
      await tx
        .update(selectionsTable)
        .set(set)
        .where(eq(selectionsTable.id, selection.id));
      if (passwordHash !== undefined) {
        await tx
          .delete(grantsTable)
          .where(eq(grantsTable.selectionId, selection.id));
      }
    });
  }

  const row = await loadSelection(selection.catalogueId, selection.id);
  if (!row) {
    throw new ApiError(
      "internal",
      "The saved selection could not be read back",
    );
  }
  return readSelection(row);
}

/**
 * Delete a Selection: stamp it, close its grants, and touch nothing else.
 *
 * One transaction, guarded on `deletedAt IS NULL` so two deletes race to one
 * stamp and the loser answers not-found. Every work, every photo and the source
 * Catalogue stay exactly where they were — a Selection references works, it
 * does not own them. The Selection's works rows are left too: the row is the
 * record, and nothing reads it through a stamped Selection.
 */
export async function deleteSelection(
  userId: string,
  catalogueId: string,
  selectionId: string,
): Promise<void> {
  const { selection } = await memberSelectionFor(
    userId,
    catalogueId,
    selectionId,
  );
  const now = new Date();
  await safeTx(async (tx) => {
    const stamped = await tx
      .update(selectionsTable)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(selectionsTable.id, selection.id),
          isNull(selectionsTable.deletedAt),
        ),
      )
      .returning({ id: selectionsTable.id });
    if (stamped.length === 0) {
      throw new ApiError("not-found", "The selection does not exist");
    }
    await tx
      .delete(grantsTable)
      .where(eq(grantsTable.selectionId, selection.id));
  });
}

/**
 * Every named id must be a live work of the **source** Catalogue.
 *
 * One query for the whole set, not one per id, and the refusal names the ids
 * that failed so a client can say which. A work of another Catalogue, a work
 * deleted in this one and an id that was never a work are the same refusal:
 * a Selection may only curate from its own Catalogue. The app has no `invalid`
 * code, so this is `validation` (400) with the ids in the details — the
 * envelope's one shape for a request that cannot be done.
 */
async function assertLiveWorks(
  catalogueId: string,
  artworkIds: readonly string[],
): Promise<void> {
  const wanted = [...new Set(artworkIds)];
  if (wanted.length === 0) return;
  const live = await db
    .select({ id: artworksTable.id })
    .from(artworksTable)
    .where(
      and(
        eq(artworksTable.catalogueId, catalogueId),
        isNull(artworksTable.deletedAt),
        inArray(artworksTable.id, wanted),
      ),
    );
  const present = new Set(live.map((row) => row.id));
  const missing = wanted.filter((id) => !present.has(id));
  if (missing.length > 0) {
    throw new ApiError(
      "validation",
      "Some of those works are not in this catalogue",
      { artworkIds: missing },
    );
  }
}

/**
 * Rewrite the Selection's positions to `0..n-1` in the list's own order.
 *
 * The read orders by `position, artworkId`, so the ordering here is the one a
 * reader sees — which is what makes a repair and a no-op the same thing. The
 * list is small and every write renumbers it; `position` has no unique
 * constraint, so this is a sequence of updates rather than a deferred swap.
 */
async function renumber(tx: Tx, selectionId: string): Promise<void> {
  const rows = await tx
    .select({
      artworkId: selectionWorksTable.artworkId,
      position: selectionWorksTable.position,
    })
    .from(selectionWorksTable)
    .where(eq(selectionWorksTable.selectionId, selectionId))
    .orderBy(
      asc(selectionWorksTable.position),
      asc(selectionWorksTable.artworkId),
    );
  for (const [index, row] of rows.entries()) {
    if (row.position === index) continue;
    await tx
      .update(selectionWorksTable)
      .set({ position: index })
      .where(
        and(
          eq(selectionWorksTable.selectionId, selectionId),
          eq(selectionWorksTable.artworkId, row.artworkId),
        ),
      );
  }
}

/** Mark the Selection itself changed: the list's "last change" is a curation
 *  decision too, and a write that moved nothing leaves it alone. */
async function touchSelection(tx: Tx, selectionId: string): Promise<void> {
  await tx
    .update(selectionsTable)
    .set({ updatedAt: new Date() })
    .where(eq(selectionsTable.id, selectionId));
}

/**
 * Append works to a Selection, in the order given.
 *
 * Ids already curated are skipped, including a repeat within the payload, so a
 * double click or two tabs sending the same work is a harmless success with
 * the unchanged list rather than a conflict. New rows take positions after the
 * existing ones, and the whole list is then renumbered `0..n-1` — the answer a
 * reorder would give, without touching the rows that were already curated.
 *
 * Membership of the source Catalogue is the write verdict; the ids are checked
 * against that Catalogue, live works only. One transaction: a partial append,
 * or a position left behind by a failed insert, is never observable.
 */
export async function addSelectionWorks(
  userId: string,
  catalogueId: string,
  selectionId: string,
  artworkIds: readonly string[],
): Promise<void> {
  const { selection } = await memberSelectionFor(
    userId,
    catalogueId,
    selectionId,
  );
  await assertLiveWorks(catalogueId, artworkIds);

  await safeTx(async (tx) => {
    const existing = await tx
      .select({ artworkId: selectionWorksTable.artworkId })
      .from(selectionWorksTable)
      .where(eq(selectionWorksTable.selectionId, selection.id));
    const present = new Set(existing.map((row) => row.artworkId));
    const toAdd = [...new Set(artworkIds)].filter((id) => !present.has(id));
    if (toAdd.length === 0) return;
    await tx.insert(selectionWorksTable).values(
      toAdd.map((artworkId, index) => ({
        selectionId: selection.id,
        artworkId,
        position: existing.length + index,
      })),
    );
    await renumber(tx, selection.id);
    await touchSelection(tx, selection.id);
  });
}

/**
 * Replace a Selection's works with exactly this list, in this order: the
 * reorder and the remove.
 *
 * An empty list is the last removal and is allowed. A duplicate id is refused
 * — the schema refuses it first, and the invariant is kept here so a direct
 * caller cannot turn a repeated id into a primary-key failure. Delete and
 * insert are one transaction: a reader never sees a half-rewritten list, and a
 * failed insert leaves the previous order in place.
 */
export async function replaceSelectionWorks(
  userId: string,
  catalogueId: string,
  selectionId: string,
  artworkIds: readonly string[],
): Promise<void> {
  const { selection } = await memberSelectionFor(
    userId,
    catalogueId,
    selectionId,
  );
  if (new Set(artworkIds).size !== artworkIds.length) {
    throw new ApiError("validation", "Each artwork can appear only once", {
      artworkIds: [...artworkIds],
    });
  }
  await assertLiveWorks(catalogueId, artworkIds);

  await safeTx(async (tx) => {
    await tx
      .delete(selectionWorksTable)
      .where(eq(selectionWorksTable.selectionId, selection.id));
    if (artworkIds.length > 0) {
      await tx.insert(selectionWorksTable).values(
        artworkIds.map((artworkId, position) => ({
          selectionId: selection.id,
          artworkId,
          position,
        })),
      );
    }
    await touchSelection(tx, selection.id);
  });
}
