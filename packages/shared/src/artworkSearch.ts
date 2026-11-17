// Catalogue search: the pure matching rule, shared by the API that runs it
// and the client that explains its caps.
//
// A Catalogue search is a member's query against the recorded fields of one
// catalogue's works. It is not a filter, a find or a lookup: every term the
// query carries has to appear somewhere in the declared fields, and different
// terms may appear in different fields. There is no ranking and no
// highlighting — the caller keeps its own order — so this module answers one
// boolean per work and nothing else.
//
// The Catalogue decides which record fields it has: Title and Artist Name
// always contribute, and the eight togglable fields contribute only while the
// Catalogue records them. A disabled field's stored text is therefore not
// found — the promise the form and the PDF keep, that a field the Catalogue
// does not have is neither asked for nor shown.
//
// ## Normalization
//
// Both sides are decomposed with Unicode NFD, stripped of combining marks and
// lowercased, so "Dalí" and "dali" are the same text. The query is then split
// on everything that is not a letter or a number — whitespace, punctuation and
// symbols all separate terms — which is what makes "Dalí, 1889" read like
// "Dalí 1889". The recorded fields are not split: a term only has to appear
// within the joined text, so a substring match is enough.
//
// ## Blank and zero terms are different answers
//
// A blank query — absent, empty or whitespace-only — is **no search** and never
// reaches this predicate. A query that survives `isBlankSearchQuery` but
// normalizes to zero terms (punctuation only) is a **committed search that
// matches nothing**: the caller asked something, and the honest answer is an
// empty list rather than the whole catalogue.
//
// ## Acquisition date
//
// It is stored as `YYYY-MM-DD` but shown by the form as `MMMM D, YYYY`. The
// haystack carries both forms, so "2023" and "March" each find a March 2023
// acquisition. Date of creation stays free text and is searched as written.

import type { ArtworkFieldKey, ArtworkFieldStates } from "./artworkFields";

/**
 * The two fields a Catalogue search always reads: a work's identity, which the
 * settings never take away.
 */
const ARTWORK_ALWAYS_SEARCHED_FIELDS = ["title", "artistName"] as const;

/**
 * The togglable fields a Catalogue search reads. Each contributes only while
 * the Catalogue records it; the registry owns whether it does, so this list is
 * the search side's subset, not a second field table.
 */
const ARTWORK_TOGGLABLE_SEARCH_FIELDS = [
  "serie",
  "medium",
  "editions",
  "dateOfCreation",
  "acquisitionDate",
  "placeOfOrigin",
  "provenance",
  "notes",
] as const satisfies readonly ArtworkFieldKey[];

/**
 * The ten fields a Catalogue search reads, declared once: the two always-read
 * ones and the eight the Catalogue may switch off.
 *
 * Adding one is a deliberate edit here and in the predicate's test — not a
 * change to a route, a schema or a database query. `title` and `artistName`
 * are required on every work; the rest contribute only when they hold a value
 * and the Catalogue records them.
 */
export type ArtworkSearchField =
  | (typeof ARTWORK_ALWAYS_SEARCHED_FIELDS)[number]
  | (typeof ARTWORK_TOGGLABLE_SEARCH_FIELDS)[number];

/**
 * The searchable shape of a work: the ten fields, any of which may be absent
 * or null. A stored row and a hand-built fixture both satisfy it.
 */
export type ArtworkSearchText = {
  [Field in ArtworkSearchField]?: string | null;
};

/**
 * The caps, shared by the form that blocks the request and the API that
 * enforces it for callers that are not this UI. A query at the cap is allowed;
 * one past it is not.
 */
export const MAX_SEARCH_QUERY_LENGTH = 200;
export const MAX_SEARCH_TERMS = 10;

/**
 * Why a present query cannot be searched: too long, or too many terms.
 * `null` means it is within both caps.
 */
export type SearchQueryOverflow = "too-long" | "too-many-terms";

/** The English month names, for the acquisition date's display form. */
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * NFD, combining marks removed, lowercased. The one normalization both the
 * query and the recorded fields go through, and the key Artist Name
 * suggestions collapse on — a name ought to match the same way it searches.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

/**
 * The query's terms: normalized, then split on everything that is not a letter
 * or a number. A query of punctuation alone yields none — a committed search
 * that matches nothing, not a blank one.
 */
function searchTerms(query: string): string[] {
  return normalizeSearchText(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 0);
}

/**
 * The terms the caps count: whitespace-separated words, deliberately not the
 * predicate's punctuation-separated terms. The cap is a product limit on what
 * a person typed ("10 words"), so a hyphenated phrase is one word there even
 * though matching splits it into several.
 */
function whitespaceTerms(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 0);
}

/**
 * True when the query is absent, empty or whitespace-only: "no search". A
 * punctuation-only query is deliberately not blank — see the module note.
 */
export const isBlankSearchQuery = (query: string | null | undefined): boolean =>
  query === null || query === undefined || query.trim() === "";

/** The cap a present query breaks, if any. Length is checked first. */
export const searchQueryOverflow = (
  query: string,
): SearchQueryOverflow | null => {
  if (query.length > MAX_SEARCH_QUERY_LENGTH) return "too-long";
  if (whitespaceTerms(query).length > MAX_SEARCH_TERMS) return "too-many-terms";
  return null;
};

/**
 * The address suffix that carries a committed query from the catalogue page
 * to the pages that return to it: `?q=…`, or "" when there is nothing to search
 * for. Built from `q` alone — URLSearchParams does the encoding — so no other
 * parameter can follow the user back.
 */
export const artworkSearchSuffix = (query: string): string => {
  const trimmed = query.trim();
  return trimmed === ""
    ? ""
    : `?${new URLSearchParams({ q: trimmed }).toString()}`;
};

/**
 * The acquisition date in both forms: the stored `YYYY-MM-DD` and the
 * `MMMM D, YYYY` the form displays. Anything that is not an ISO date is left as
 * written, so a malformed value still contributes its raw text.
 */
function acquisitionDateText(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  const [, year, month, day] = match;
  const monthName = MONTH_NAMES[Number(month) - 1];
  if (monthName === undefined) return value;
  return `${value} ${monthName} ${Number(day)}, ${year}`;
}

/**
 * One normalized string holding every searchable value of the work, joined by
 * spaces. A field with no value contributes nothing, the acquisition date
 * contributes both of its forms, and a togglable field the Catalogue does not
 * record contributes nothing even when it holds text.
 */
function searchHaystack(
  artwork: ArtworkSearchText,
  enabled: ArtworkFieldStates,
): string {
  const parts: string[] = [];

  const add = (field: ArtworkSearchField): void => {
    const value = artwork[field];
    if (typeof value !== "string" || value.trim() === "") return;
    parts.push(
      normalizeSearchText(
        field === "acquisitionDate" ? acquisitionDateText(value) : value,
      ),
    );
  };

  for (const field of ARTWORK_ALWAYS_SEARCHED_FIELDS) add(field);
  for (const field of ARTWORK_TOGGLABLE_SEARCH_FIELDS) {
    if (enabled[field]) add(field);
  }
  return parts.join(" ");
}

/**
 * Does this work match the query? Every term must appear somewhere in the
 * enabled fields; terms may match different fields. Title and Artist Name are
 * always in the haystack; the eight togglable fields join it only when the
 * Catalogue records them. A query with no terms matches nothing, which is the
 * punctuation-only case.
 */
export const matchesArtworkSearch = (
  artwork: ArtworkSearchText,
  query: string,
  enabled: ArtworkFieldStates,
): boolean => {
  const terms = searchTerms(query);
  if (terms.length === 0) return false;
  const haystack = searchHaystack(artwork, enabled);
  return terms.every((term) => haystack.includes(term));
};
