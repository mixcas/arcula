// The Artworks manage view's remembered choices, in one browser-storage key.
//
// Two preferences today — the view (Table or Grid) and the sort — and they are
// stored as one versioned object rather than two keys so that the next
// preference needs no migration of its own: a writer merges into whatever is
// already there, and a reader fills whatever is missing from the defaults.
//
// The parser is total on purpose. Storage is shared ground — an older build, a
// hand-edited value, a torn write, a private-mode browser that throws — and a
// preference is not worth a broken page, so every input that is not exactly our
// object answers a complete settings object with the defaults. That is also the
// reset story: clearing browser storage returns Grid sorted Title A-Z.
//
// No React and no Hono: the list reads once on mount and writes on each change,
// which is all the cross-tab or reactive behaviour a preference needs.

import type { SortState } from "@/components/manage/collection/artworksSort";

export type ArtworksView = "table" | "grid";

/**
 * The sort as the settings spell it. Flat strings rather than the runtime
 * `{ field, direction }` because this is stored text: a flat value is one
 * comparison to validate, and it cannot carry a field we do not have.
 */
export type ArtworksSort =
  "title-asc" | "title-desc" | "artist-asc" | "artist-desc";

export interface UserSettings {
  version: 1;
  artworksView: ArtworksView;
  artworksSort: ArtworksSort;
}

export const STORAGE_KEY = "arcula.userSettings";

export const DEFAULT_USER_SETTINGS: UserSettings = {
  version: 1,
  artworksView: "grid",
  artworksSort: "title-asc",
};

const VIEWS: readonly ArtworksView[] = ["table", "grid"];
const SORTS: readonly ArtworksSort[] = [
  "title-asc",
  "title-desc",
  "artist-asc",
  "artist-desc",
];

const isView = (value: unknown): value is ArtworksView =>
  VIEWS.includes(value as ArtworksView);

const isSort = (value: unknown): value is ArtworksSort =>
  SORTS.includes(value as ArtworksSort);

/**
 * Reads the runtime sort as the stored one. The pair is total in both
 * directions — two fields times two directions — so there is no fallback here
 * to hide a new field behind.
 */
export const toArtworksSort = (sort: SortState): ArtworksSort =>
  `${sort.field === "artistName" ? "artist" : "title"}-${sort.direction}`;

/** And back: the runtime sort the Grid's select and the shared state use. */
export const fromArtworksSort = (value: ArtworksSort): SortState => {
  const [field, direction] = value.split("-");
  return {
    field: field === "artist" ? "artistName" : "title",
    direction: direction === "desc" ? "desc" : "asc",
  };
};

/**
 * A complete settings object from whatever storage held.
 *
 * `raw` is the stored string (or `null`); an already-parsed value is accepted
 * too, so the same rules read a future shape. Every key is judged on its own:
 * losing the sort to a bad view would quietly reset a preference the reader
 * never touched, so a broken key falls back to its default and the others stay.
 */
export const parseUserSettings = (raw: unknown): UserSettings => {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_USER_SETTINGS };
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_USER_SETTINGS };
  }
  const record = value as Record<string, unknown>;
  // A version we do not know is not a shape we can read: a later version may
  // have moved or re-typed what we would look for, so guessing is worse than
  // the defaults.
  if (record.version !== 1) {
    return { ...DEFAULT_USER_SETTINGS };
  }
  return {
    version: 1,
    artworksView: isView(record.artworksView)
      ? record.artworksView
      : DEFAULT_USER_SETTINGS.artworksView,
    artworksSort: isSort(record.artworksSort)
      ? record.artworksSort
      : DEFAULT_USER_SETTINGS.artworksSort,
  };
};

/**
 * The current stored settings, or the defaults when there is nothing readable.
 *
 * Every access is guarded: a browser can refuse `localStorage` outright
 * (Safari private mode throws on the property itself), not only on `getItem`.
 */
export const readUserSettings = (): UserSettings => {
  try {
    return parseUserSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_USER_SETTINGS };
  }
};

/**
 * Writes `patch` into the stored object, keeping every other key.
 *
 * Re-reads first, so a write from this tab never erases a preference another
 * tab stored in between (there is no cross-tab sync; last writer wins, but only
 * on the keys it changed). Best effort throughout: a blocked or full storage
 * still leaves the caller's in-memory state correct for this visit.
 */
const writeUserSettings = (
  patch: Partial<Omit<UserSettings, "version">>,
): void => {
  try {
    const next = { ...readUserSettings(), ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A preference is not worth a failed page.
  }
};

export const writeArtworksView = (artworksView: ArtworksView): void =>
  writeUserSettings({ artworksView });

export const writeArtworksSort = (artworksSort: ArtworksSort): void =>
  writeUserSettings({ artworksSort });
