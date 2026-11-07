// Collection search: the pure matching rule, shared by the API that runs it
// and the client that explains its caps.
//
// A Collection search is a member's query against the recorded fields of one
// collection's works. It is not a filter, a find or a lookup: every term the
// query carries has to appear somewhere in the ten declared fields, and
// different terms may appear in different fields. There is no ranking and no
// highlighting — the caller keeps its own order — so this module answers one
// boolean per work and nothing else.
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
// empty list rather than the whole collection.
//
// ## Acquisition date
//
// It is stored as `YYYY-MM-DD` but shown by the form as `MMMM D, YYYY`. The
// haystack carries both forms, so "2023" and "March" each find a March 2023
// acquisition. Date of creation stays free text and is searched as written.

/**
 * The ten fields a Collection search reads, declared once.
 *
 * Adding one is a deliberate edit here and in the predicate's test — not a
 * change to a route, a schema or a database query. `title` and `artistName`
 * are required on every work; the rest contribute only when they hold a value.
 */
export const ARTWORK_SEARCH_FIELDS = [
  "title",
  "artistName",
  "serie",
  "media",
  "editions",
  "dateOfCreation",
  "acquisitionDate",
  "placeOfOrigin",
  "provenance",
  "notes",
] as const;

export type ArtworkSearchField = (typeof ARTWORK_SEARCH_FIELDS)[number];

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
 * query and the recorded fields go through.
 */
function normalize(value: string): string {
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
  return normalize(query)
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
 * The address suffix that carries a committed query from the collection page
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
 * spaces. A field with no value contributes nothing, and the acquisition date
 * contributes both of its forms.
 */
function searchHaystack(artwork: ArtworkSearchText): string {
  const parts: string[] = [];
  for (const field of ARTWORK_SEARCH_FIELDS) {
    const value = artwork[field];
    if (typeof value !== "string" || value.trim() === "") continue;
    parts.push(
      normalize(
        field === "acquisitionDate" ? acquisitionDateText(value) : value,
      ),
    );
  }
  return parts.join(" ");
}

/**
 * Does this work match the query? Every term must appear somewhere in the ten
 * fields; terms may match different fields. A query with no terms matches
 * nothing, which is the punctuation-only case.
 */
export const matchesArtworkSearch = (
  artwork: ArtworkSearchText,
  query: string,
): boolean => {
  const terms = searchTerms(query);
  if (terms.length === 0) return false;
  const haystack = searchHaystack(artwork);
  return terms.every((term) => haystack.includes(term));
};
