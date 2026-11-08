import type { Artwork } from "@arcula/shared";

/** The two columns the manage view sorts by — the Table's headers and the Grid's select agree on them. */
export type ArtworksSortField = "title" | "artistName";

/**
 * The direction. Spelled as mantine-datatable spells it so the shared state
 * feeds the Table's controlled `sortStatus` unchanged, and a header click
 * writes straight back into it.
 */
export type SortDirection = "asc" | "desc";

export interface SortState {
  field: ArtworksSortField;
  direction: SortDirection;
}

// 25 first, so it is also the default: the list's page size is initialised
// from index 0, which keeps the default and the offered options from drifting.
// 10 is deliberately not offered — a 25-row page is the density these lists
// are read at, and a 10-row option only ever produced a page that looked empty
// next to a 50-row one.
export const RECORDS_PER_PAGE_OPTIONS = [25, 50];

// Title and artist are free text in any language, so sorting goes through one
// collator rather than `<`/`>`: `sensitivity: "base"` folds case and accents
// ("Dali" and "Dalí" land together) — and because the collator is case-blind,
// the id tie-break, not the input order, decides which of the two comes first.
// `numeric: true` orders "Study 2" before "Study 10" instead of
// lexicographically after it.
const collator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

/**
 * Sorts a whole collection for display: the field first, then the id.
 *
 * Both views sort the entire set and page the sorted result — sorting only the
 * visible page would reorder one page and leave the collection in a nonsense
 * order. The id tie-break keeps equal values from reshuffling between renders,
 * and it stays ascending in both directions: a direction flips the field's
 * comparison, not the identity of a tie. The input is never mutated — it is
 * React state, and an in-place sort would reorder the collection behind the
 * list's back.
 */
export const sortArtworks = (
  artworks: readonly Artwork[],
  sort: SortState,
): Artwork[] =>
  [...artworks].sort((a, b) => {
    const result = collator.compare(a[sort.field] ?? "", b[sort.field] ?? "");
    if (result !== 0) {
      return sort.direction === "asc" ? result : -result;
    }
    return a.id.localeCompare(b.id);
  });
