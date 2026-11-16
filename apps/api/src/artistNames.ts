// Artist Name suggestions: the caller-scoped aggregate read, and the pure
// decision that turns its rows into the dropdown's list.
//
// The resource is the caller's artist vocabulary, not a catalogue's: every
// name here is one the caller may already read through the ordinary catalogue
// reads. The scope is the signed-in `/catalogues` list — the catalogues the
// caller owns or collaborates on — so the aggregate cannot reveal a name from a
// catalogue the caller could not open.
//
// The database aggregates **exact spellings**: one row per stored
// `artistName`, with its live-work count and its newest update. Collapsing
// those spellings to one artist is a pure function over those rows, using a
// trim, then the shared Catalogue-search normalization (NFD, strip
// diacritics, lowercase), so "María López" and "Maria Lopez" are one artist
// here exactly as they are one search term there. The winning spelling is the
// most-used one; ties fall to the most recently updated work and then to
// lexicographic order, so the answer is deterministic.
//
// No Hono type appears here. The route owns the wire and the status codes, as
// the artwork read module and its route already split; when a curated global
// index arrives it replaces the source behind this module's seam.

import { count, eq, isNull, max } from "drizzle-orm";
import {
  artworks as artworksTable,
  catalogueCollaborators as catalogueCollaboratorsTable,
  catalogues as cataloguesTable,
} from "@arcula/db";
import { normalizeSearchText } from "@arcula/shared";
import { collaboratorJoin, readableCataloguesWhere } from "./catalogueScope";
import { db } from "./db";

/**
 * One exact spelling inside the caller's scope: how many live works use it and
 * when the newest of them was last updated. `lastUpdatedAt` is the database's
 * `max("updatedAt")`; a null (an old row with no timestamp) sorts as the epoch.
 */
export interface ArtistNameAggregateRow {
  readonly name: string;
  readonly count: number;
  readonly lastUpdatedAt: Date;
}

/**
 * The silent cap. A suggestion list is a hint, not the data, so past this many
 * artists the list is cut rather than refused. 2,000 names fit comfortably in
 * one response for any realistic set of catalogues; approaching it is the
 * trigger to revisit server-side filtering, not to raise the number.
 */
export const MAX_ARTIST_NAME_SUGGESTIONS = 2000;

/** The key two spellings share when they name the same artist. */
const artistKey = (name: string): string => normalizeSearchText(name.trim());

/** Does `candidate` beat `current` as the spelling to offer for one artist? */
const beats = (
  candidate: ArtistNameAggregateRow,
  current: ArtistNameAggregateRow,
): boolean => {
  if (candidate.count !== current.count) return candidate.count > current.count;
  const candidateTime = candidate.lastUpdatedAt.getTime();
  const currentTime = current.lastUpdatedAt.getTime();
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  return candidate.name < current.name;
};

/** Most-used first, then display name ascending, case-insensitively. */
const compareSuggestions = (
  a: ArtistNameAggregateRow,
  b: ArtistNameAggregateRow,
): number => {
  if (a.count !== b.count) return b.count - a.count;
  const byName = a.name.localeCompare(b.name, undefined, {
    sensitivity: "base",
  });
  if (byName !== 0) return byName;
  // A locale may call two spellings equal while they are different strings;
  // the plain comparison keeps the order total.
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
};

/**
 * The dropdown's names, from the aggregate rows: blank spellings dropped, case
 * and accent variants collapsed to the most-used spelling, ordered by use and
 * then by display name, and capped silently.
 */
export function collapseArtistNames(
  rows: readonly ArtistNameAggregateRow[],
): string[] {
  const byArtist = new Map<string, ArtistNameAggregateRow>();
  for (const row of rows) {
    if (row.name.trim() === "") continue;
    const key = artistKey(row.name);
    const current = byArtist.get(key);
    if (current === undefined || beats(row, current)) {
      byArtist.set(key, row);
    }
  }
  return [...byArtist.values()]
    .sort(compareSuggestions)
    .slice(0, MAX_ARTIST_NAME_SUGGESTIONS)
    .map((row) => row.name);
}

/**
 * The caller's artist names: exact spellings grouped inside the membership
 * scope, collapsed and ordered by `collapseArtistNames`.
 *
 * The scope is the signed-in `/catalogues` list's own — `catalogueScope.ts`'s
 * left join and readable-catalogue filter — so a name from a catalogue the
 * caller cannot open is never read. Inside it, only live works count: a draft
 * contributes, a deleted work does not, exactly as in Catalogue search. The
 * query aggregates exact spellings and leaves the accent/case collapse to the
 * pure function, which is why no Postgres `unaccent` extension and no new index
 * are involved.
 */
export async function readArtistNames(userId: string): Promise<string[]> {
  const rows = await db
    .select({
      name: artworksTable.artistName,
      count: count(),
      lastUpdatedAt: max(artworksTable.updatedAt),
    })
    .from(artworksTable)
    .innerJoin(
      cataloguesTable,
      eq(cataloguesTable.id, artworksTable.catalogueId),
    )
    .leftJoin(catalogueCollaboratorsTable, collaboratorJoin(userId))
    .where(readableCataloguesWhere(userId, isNull(artworksTable.deletedAt)))
    .groupBy(artworksTable.artistName);

  return collapseArtistNames(
    rows.map((row) => ({
      name: row.name,
      count: Number(row.count),
      // A grouped row always has a work, so the max is present; an old row
      // with no timestamp is the epoch, which the tie-break can compare.
      lastUpdatedAt: row.lastUpdatedAt ?? new Date(0),
    })),
  );
}
