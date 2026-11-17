// A Catalogue's works counted by status, as `get_catalogue` answers them.
//
// One grouped query, because the count is a fact about the whole catalogue and
// not about a page: `(catalogueId, status, deletedAt)` is already an index, so
// no migration rides with this module. Deleted works are never counted.
//
// The audience decides what is answered. A member is told every status key — a
// key at zero included, so the shape does not wobble with the catalogue's
// contents. A visitor gets published works only and no draft key at all: the
// visitor rule is the catalogue's gate (ADR-0003), and a draft's existence is
// not something a stranger is told.

import { and, count, eq, isNull } from "drizzle-orm";
import { artworks as artworksTable } from "@arcula/db";
import { artworkStatusSchema, type ArtworkStatus } from "@arcula/shared";
import type { CatalogueAudience } from "./access";
import { db } from "./db";

/**
 * Live works by status. `published` is always present; a member's answer adds
 * every other status, zero included. A visitor's answer has no other key.
 */
export type CatalogueWorkCounts = Partial<Record<ArtworkStatus, number>> & {
  readonly published: number;
};

export async function catalogueWorkCounts(
  catalogueId: string,
  audience: CatalogueAudience,
): Promise<CatalogueWorkCounts> {
  const rows = await db
    .select({ status: artworksTable.status, total: count() })
    .from(artworksTable)
    .where(
      and(
        eq(artworksTable.catalogueId, catalogueId),
        isNull(artworksTable.deletedAt),
      ),
    )
    .groupBy(artworksTable.status);

  const counted = new Map(rows.map((row) => [row.status, row.total]));
  const counts: CatalogueWorkCounts = {
    published: counted.get("published") ?? 0,
  };
  if (audience === "member") {
    for (const status of artworkStatusSchema.options) {
      if (status === "published") continue;
      counts[status] = counted.get(status) ?? 0;
    }
  }
  return counts;
}
