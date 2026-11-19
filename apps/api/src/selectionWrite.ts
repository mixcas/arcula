// The Selection write cores: create, update and delete as functions of an
// account id where they must ask the membership verdict themselves, and of the
// already-authorized row where a route has just asked it.
//
// No Hono type lives here — the route owns the status codes and the envelope,
// exactly as `catalogueWrite.ts` splits the work with `routes/catalogues.ts`.
// A Selection is not counted against any plan and owns no media, so nothing
// here touches `limits.ts`, the source Catalogue or its works.

import { and, eq, isNull } from "drizzle-orm";
import {
  selectionAccessGrants as grantsTable,
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
import { safeTx } from "./http";
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
