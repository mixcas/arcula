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
import {
  artworkAvailabilitySchema,
  artworkStatusSchema,
} from "./schemas/artwork";

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
 * The ten fields a Catalogue search reads, in one list: the two always-read
 * fields and the eight a Catalogue may switch off. The structured filter names
 * these; whether a Catalogue records one is the resolver's answer, applied by
 * the predicates below.
 */
export const ARTWORK_SEARCH_FIELDS = [
  ...ARTWORK_ALWAYS_SEARCHED_FIELDS,
  ...ARTWORK_TOGGLABLE_SEARCH_FIELDS,
] as const satisfies readonly ArtworkSearchField[];

/**
 * The two enumerated fields a structured filter adds to the ten text ones.
 * The values are the schemas' own options, so a word added to a save enum
 * cannot go missing from the search contract.
 */
const ARTWORK_SEARCH_ENUM_FIELDS = {
  status: artworkStatusSchema.options,
  availability: artworkAvailabilitySchema.options,
} as const;

type ArtworkSearchEnumField = keyof typeof ARTWORK_SEARCH_ENUM_FIELDS;

/** Every field a structured filter may name: the ten text fields, then the two enums. */
export const ARTWORK_FILTER_FIELDS = [
  ...ARTWORK_SEARCH_FIELDS,
  "status",
  "availability",
] as const;

export type ArtworkFilterField = (typeof ARTWORK_FILTER_FIELDS)[number];

/**
 * The searchable shape of a work: the ten fields, any of which may be absent
 * or null. A stored row and a hand-built fixture both satisfy it.
 */
export type ArtworkSearchText = {
  [Field in ArtworkSearchField]?: string | null;
};

/**
 * A work as a structured filter sees it: the ten text fields plus the two
 * enumerated ones. A stored row satisfies it unchanged — both enumerated
 * columns are text with a database CHECK, so the row's own type is `string`,
 * which is what lets the read hand a row straight to the predicate.
 * `availability` may be null, which is every work in a Catalogue that does not
 * record the field. Which values may be *asked for* is the parser's business:
 * it refuses one outside the schema enum before this runs.
 */
export type ArtworkFilterable = ArtworkSearchText & {
  readonly status?: string | null;
  readonly availability?: string | null;
};

/**
 * The structured query's caps. A request at a cap is allowed; one past it is
 * a validation error naming the field that broke it.
 *
 * `MAX_ARTWORK_LIST_LIMIT` bounds a page, never the whole result: an absent
 * `limit` still answers every match, which is what the web reads.
 * `MAX_FACET_VALUES` bounds one field's facet list after it is ordered, so a
 * catalogue with thousands of titles still answers a usable list.
 */
export const MAX_SEARCH_FILTER_VALUES = 20;
export const MAX_SEARCH_FILTER_FIELDS = 8;
export const MAX_ARTWORK_LIST_LIMIT = 100;
export const MAX_FACET_VALUES = 500;

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
 * One text field's normalized search text, with the acquisition date carrying
 * both of its forms. A field with no value contributes the empty string, which
 * no non-empty search term or filter value occurs in.
 */
function artworkFieldText(
  field: ArtworkSearchField,
  value: string | null | undefined,
): string {
  if (typeof value !== "string" || value.trim() === "") return "";
  return normalizeSearchText(
    field === "acquisitionDate" ? acquisitionDateText(value) : value,
  );
}

/** Whether a Catalogue records a field: the two fixed fields always are. */
function searchFieldEnabled(
  field: ArtworkSearchField,
  enabled: ArtworkFieldStates,
): boolean {
  return (
    field === "title" ||
    field === "artistName" ||
    enabled[field as ArtworkFieldKey]
  );
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
  for (const field of ARTWORK_ALWAYS_SEARCHED_FIELDS) {
    const text = artworkFieldText(field, artwork[field]);
    if (text !== "") parts.push(text);
  }
  for (const field of ARTWORK_TOGGLABLE_SEARCH_FIELDS) {
    if (!enabled[field]) continue;
    const text = artworkFieldText(field, artwork[field]);
    if (text !== "") parts.push(text);
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

// ---------------------------------------------------------------------------
// The structured query: its parse, its filters, its order and its facets
// ---------------------------------------------------------------------------

/**
 * The orders a list request may name. `updated` is the default because it is
 * the one a person means by "the list": the work they touched last is the one
 * they are looking for. Every order ends on `id`, so the sort is total and a
 * paged read can neither skip nor repeat a row.
 */
export const ARTWORK_LIST_SORTS = [
  "updated",
  "title",
  "artistName",
  "dateOfCreation",
] as const;

export type ArtworkListSort = (typeof ARTWORK_LIST_SORTS)[number];

const DEFAULT_ARTWORK_LIST_SORT: ArtworkListSort = "updated";

/** One field's filter values, as the caller sent them. */
export type ArtworkSearchFilters = Partial<
  Record<ArtworkFilterField, readonly string[]>
>;

/** A parsed, valid structured query. */
interface ArtworkSearchQuery {
  readonly filters: ArtworkSearchFilters;
  readonly sort: ArtworkListSort;
  /** `null` means every match: paging was not asked for. */
  readonly limit: number | null;
  readonly offset: number;
  /** The fields whose facet lists were asked for. */
  readonly facets: readonly ArtworkFilterField[];
}

/**
 * Why a structured query cannot be answered, attributed to the request field
 * that carries the problem. The message is what an agent relays verbatim, so
 * it names the offending field, value or cap.
 */
export interface ArtworkSearchProblem {
  readonly field: string;
  readonly message: string;
}

export type ArtworkSearchQueryParse =
  | { readonly status: "ok"; readonly query: ArtworkSearchQuery }
  | { readonly status: "invalid"; readonly problem: ArtworkSearchProblem };

const isArtworkFilterField = (value: string): value is ArtworkFilterField =>
  (ARTWORK_FILTER_FIELDS as readonly string[]).includes(value);

/** Whether a filter field is one of the two enumerated ones. */
const isArtworkSearchEnumField = (
  field: ArtworkFilterField,
): field is ArtworkSearchEnumField =>
  field === "status" || field === "availability";

const isArtworkListSort = (value: string): value is ArtworkListSort =>
  (ARTWORK_LIST_SORTS as readonly string[]).includes(value);

/** A non-negative whole number, or `null` when the text is not one. */
function wholeNumber(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

const invalidQuery = (
  field: string,
  message: string,
): ArtworkSearchQueryParse => ({
  status: "invalid",
  problem: { field, message },
});

/**
 * Parse the list route's raw query strings (`c.req.queries()`), which is the
 * only shape that can carry a repeated parameter as a set of values.
 *
 * `q` is deliberately not parsed here: the free-text search is the route's
 * own member-only condition and reaches the read separately. Everything else
 * a request may carry is either a filter field, `sort`, `limit`, `offset`,
 * `facets` — or a validation error naming the parameter.
 *
 * A filter value is trimmed; a blank one is dropped, so `title=` carries no
 * condition rather than matching every work. An enumerated value is not
 * trimmed and never ignored: one outside its list is an error.
 */
export function parseArtworkSearchQuery(
  params: Readonly<Record<string, readonly string[] | undefined>>,
): ArtworkSearchQueryParse {
  for (const key of Object.keys(params)) {
    if (key === "q" || key === "facets") continue;
    if (isArtworkFilterField(key)) continue;
    if (key === "sort" || key === "limit" || key === "offset") continue;
    return invalidQuery(key, `Unknown search field "${key}"`);
  }

  let sort: ArtworkListSort = DEFAULT_ARTWORK_LIST_SORT;
  const rawSort = params.sort;
  if (rawSort !== undefined) {
    if (rawSort.length > 1) {
      return invalidQuery("sort", "Give `sort` one value");
    }
    const value = rawSort[0] ?? "";
    if (!isArtworkListSort(value)) {
      return invalidQuery(
        "sort",
        `Unknown sort "${value}"; use ${ARTWORK_LIST_SORTS.join(", ")}`,
      );
    }
    sort = value;
  }

  const filters: Record<string, readonly string[]> = {};
  let filterFields = 0;
  for (const field of ARTWORK_FILTER_FIELDS) {
    const raw = params[field];
    if (raw === undefined) continue;
    const isEnum = isArtworkSearchEnumField(field);
    const values = isEnum
      ? [...raw]
      : raw.map((value) => value.trim()).filter((value) => value.length > 0);
    if (values.length === 0) continue;
    if (filterFields === MAX_SEARCH_FILTER_FIELDS) {
      return invalidQuery(
        field,
        `A search filters at most ${MAX_SEARCH_FILTER_FIELDS} fields; "${field}" is one too many`,
      );
    }
    if (values.length > MAX_SEARCH_FILTER_VALUES) {
      return invalidQuery(
        field,
        `Filter "${field}" accepts at most ${MAX_SEARCH_FILTER_VALUES} values`,
      );
    }
    if (isEnum) {
      const allowed: readonly string[] = ARTWORK_SEARCH_ENUM_FIELDS[field];
      for (const value of values) {
        if (!allowed.includes(value)) {
          return invalidQuery(
            field,
            `"${value}" is not a valid ${field}; use ${allowed.join(", ")}`,
          );
        }
      }
    }
    filters[field] = values;
    filterFields += 1;
  }

  let limit: number | null = null;
  const rawLimit = params.limit;
  if (rawLimit !== undefined) {
    if (rawLimit.length > 1) {
      return invalidQuery("limit", "Give `limit` one value");
    }
    const parsed = wholeNumber(rawLimit[0] ?? "");
    if (parsed === null) {
      return invalidQuery("limit", "A limit is a whole number of rows");
    }
    if (parsed > MAX_ARTWORK_LIST_LIMIT) {
      return invalidQuery(
        "limit",
        `A limit is at most ${MAX_ARTWORK_LIST_LIMIT} rows`,
      );
    }
    limit = parsed;
  }

  let offset = 0;
  const rawOffset = params.offset;
  if (rawOffset !== undefined) {
    if (rawOffset.length > 1) {
      return invalidQuery("offset", "Give `offset` one value");
    }
    if (limit === null) {
      return invalidQuery(
        "offset",
        "An offset needs a limit; add `limit` or drop `offset`",
      );
    }
    const parsed = wholeNumber(rawOffset[0] ?? "");
    if (parsed === null) {
      return invalidQuery("offset", "An offset is a whole number of rows");
    }
    offset = parsed;
  }

  const facets: ArtworkFilterField[] = [];
  for (const raw of params.facets ?? []) {
    const field = raw.trim();
    if (!isArtworkFilterField(field)) {
      return invalidQuery(
        "facets",
        `"${field}" is not a filterable field; use ${ARTWORK_FILTER_FIELDS.join(", ")}`,
      );
    }
    if (!facets.includes(field)) facets.push(field);
  }

  return { status: "ok", query: { filters, sort, limit, offset, facets } };
}

/**
 * Does this work match the structured filters?
 *
 * Values within one field are alternatives — either artist — and different
 * fields are all required. A text value is normalized and matched within its
 * own field's text (never another field's), so `medium=oil` finds "Oil on
 * canvas" and `placeOfOrigin=malaga` finds "Málaga"; an enumerated value is
 * compared exactly, and a work whose enumerated field is absent (as
 * `availability` is on every Collection work) never matches one.
 */
export function matchesArtworkFilters(
  artwork: ArtworkFilterable,
  filters: ArtworkSearchFilters,
  enabled: ArtworkFieldStates,
): boolean {
  for (const field of ARTWORK_SEARCH_FIELDS) {
    const values = filters[field];
    if (values === undefined || values.length === 0) continue;
    if (!searchFieldEnabled(field, enabled)) return false;
    const wanted = values
      .map((value) => normalizeSearchText(value.trim()))
      .filter((value) => value.length > 0);
    if (wanted.length === 0) continue;
    const text = artworkFieldText(field, artwork[field]);
    if (!wanted.some((value) => text.includes(value))) return false;
  }
  for (const field of Object.keys(
    ARTWORK_SEARCH_ENUM_FIELDS,
  ) as ArtworkSearchEnumField[]) {
    const values = filters[field];
    if (values === undefined || values.length === 0) continue;
    if (field === "availability" && !enabled.availability) return false;
    const actual = artwork[field];
    if (actual === null || actual === undefined) return false;
    if (!values.includes(actual)) return false;
  }
  return true;
}

/** One facet value and how many works carry it. */
export interface ArtworkFacetEntry {
  readonly value: string;
  readonly count: number;
}

/** The facet lists a request asked for, keyed by field. */
export type ArtworkFacets = Partial<
  Record<ArtworkFilterField, readonly ArtworkFacetEntry[]>
>;

/**
 * The facet value of one work for one field: a text field's value normalized
 * (so "Dalí" and "Dali" are one entry, and the value a caller reads back is
 * one it can send as a filter), or an enumerated field's value exactly. A
 * field with no value yields none: it is not a facet entry, and a caller
 * cannot ask for "no value".
 */
function facetValueOf(
  field: ArtworkFilterField,
  artwork: ArtworkFilterable,
  enabled: ArtworkFieldStates,
): string | null {
  if (isArtworkSearchEnumField(field)) {
    if (field === "status") return artwork.status ?? null;
    return enabled.availability ? (artwork.availability ?? null) : null;
  }
  if (!searchFieldEnabled(field, enabled)) return null;
  const value = artwork[field];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : normalizeSearchText(trimmed);
}

/**
 * Count each requested field's values over `artworks` — the set the filters
 * left, before paging — so a facet agrees with the page it accompanies.
 * Entries are ordered by count descending and then value, and each field
 * answers at most `MAX_FACET_VALUES` of them. A field with no values still
 * answers, as an empty list.
 */
export function artworkFacets(
  artworks: readonly ArtworkFilterable[],
  fields: readonly ArtworkFilterField[],
  enabled: ArtworkFieldStates,
): ArtworkFacets {
  const facets: ArtworkFacets = {};
  for (const field of fields) {
    const counts = new Map<string, number>();
    for (const artwork of artworks) {
      const value = facetValueOf(field, artwork, enabled);
      if (value === null) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    facets[field] = [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          (a.value < b.value ? -1 : a.value > b.value ? 1 : 0),
      )
      .slice(0, MAX_FACET_VALUES);
  }
  return facets;
}

/** A work as the list's order sees it. */
export interface ArtworkSortable {
  readonly id: string;
  readonly title: string;
  readonly artistName: string;
  readonly dateOfCreation?: string | null;
  readonly updatedAt: Date;
}

/** Case- and accent-blind text order, so "Dalí" and "Dali" land together. */
function compareListText(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const a = normalizeSearchText(left ?? "");
  const b = normalizeSearchText(right ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The list's total order. `updated` is newest first; every other sort is
 * ascending on its field, compared normalized. `id` breaks every tie, so two
 * reads of the same catalogue agree and offset paging cannot skip or repeat a
 * row.
 */
export function compareArtworksForList(
  a: ArtworkSortable,
  b: ArtworkSortable,
  sort: ArtworkListSort,
): number {
  const result =
    sort === "updated"
      ? b.updatedAt.getTime() - a.updatedAt.getTime()
      : compareListText(a[sort], b[sort]);
  if (result !== 0) return result;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
