// The Selection reads: the member list and the member document.
//
// The list is name-ordered and carries each row's live-work count, counted
// over the works a reader would actually see: a work deleted in its Catalogue
// is not counted, and a Draft is (a Selection shows Drafts on purpose). One
// grouped query for every row — the count is a fact about the page, not a
// reason to ask per Selection.
//
// No Hono type lives here: the route owns the envelope and the status codes.

import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import {
  artworks as artworksTable,
  selectionWorks as selectionWorksTable,
  selections as selectionsTable,
} from "@arcula/db";
import type { SelectionPageRow, SelectionRead } from "@arcula/shared";
import type { SelectionRow } from "./authorize";
import { db } from "./db";
import { wireTimestamp } from "./serialize";

/**
 * The exact member wire document.
 *
 * Blank text is an absent key, never `null`. `isPasswordProtected` is derived
 * from the hash's presence — the hash itself never leaves the server — and is
 * a member fact only; the public read in the next slice does not carry it.
 */
export function readSelection(row: SelectionRow): SelectionRead {
  const out: SelectionRead = {
    id: row.id,
    catalogueId: row.catalogueId,
    name: row.name,
    isPublic: row.isPublic,
    createdAt: wireTimestamp(row.createdAt),
    updatedAt: wireTimestamp(row.updatedAt),
    isPasswordProtected: row.passwordHash !== null,
  };
  if (row.description !== null) out.description = row.description;
  return out;
}

/**
 * A Catalogue's live Selections, name-ordered, each with its live-work count.
 *
 * Counts are read in one grouped query keyed by the live Selection ids the
 * list already loaded. A Selection with no rows is absent from the group and
 * counts zero; a deleted work is excluded by the join's own condition, so a
 * Selection whose works were all deleted reads as empty rather than stale.
 */
export async function readSelectionPage(
  catalogueId: string,
): Promise<SelectionPageRow[]> {
  const rows = await db
    .select()
    .from(selectionsTable)
    .where(
      and(
        eq(selectionsTable.catalogueId, catalogueId),
        isNull(selectionsTable.deletedAt),
      ),
    )
    .orderBy(asc(selectionsTable.name), asc(selectionsTable.id));

  if (rows.length === 0) return [];

  const counts = await db
    .select({
      selectionId: selectionWorksTable.selectionId,
      total: count(),
    })
    .from(selectionWorksTable)
    .innerJoin(
      artworksTable,
      eq(artworksTable.id, selectionWorksTable.artworkId),
    )
    .where(
      and(
        inArray(
          selectionWorksTable.selectionId,
          rows.map((row) => row.id),
        ),
        isNull(artworksTable.deletedAt),
      ),
    )
    .groupBy(selectionWorksTable.selectionId);

  const counted = new Map(counts.map((row) => [row.selectionId, row.total]));
  return rows.map((row) => ({
    ...readSelection(row),
    workCount: counted.get(row.id) ?? 0,
  }));
}
