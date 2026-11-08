// The artwork list's sort, as one pure function: the order a collector sees,
// from the records and the sort state alone. No DOM and no component — what a
// screenshot cannot pin: that titles fold case and accents and order numbered
// titles numerically, that a direction flips only the field's comparison and
// leaves the id tie-break ascending so equal values never reshuffle with the
// direction, and that the caller's array is left untouched (it is React state,
// and sorting it in place would reorder the collection behind the list's back).

import { describe, expect, it } from "vitest";
import {
  sortArtworks,
  type SortState,
} from "@/components/manage/collection/artworksSort";
import type { Artwork } from "@arcula/shared";

const artwork = (overrides: Partial<Artwork> & { id: string }): Artwork => ({
  userId: "user-1",
  title: "Untitled",
  artistName: "Unknown",
  documents: [],
  photos: [],
  collectionId: "collection1",
  status: "published",
  deletedAt: null,
  ...overrides,
});

const titleAsc: SortState = { field: "title", direction: "asc" };
const titleDesc: SortState = { field: "title", direction: "desc" };
const artistAsc: SortState = { field: "artistName", direction: "asc" };
const artistDesc: SortState = { field: "artistName", direction: "desc" };

/** The ids in sorted order — the whole answer, without the fixtures around it. */
const ids = (artworks: Artwork[]): string[] => artworks.map((a) => a.id);

describe("sortArtworks", () => {
  // Unordered input, and the title order deliberately differs from the artist
  // order so a sorter reading the wrong field cannot pass by luck.
  const three = [
    artwork({ id: "a", title: "Blue Nude", artistName: "Caillebotte" }),
    artwork({ id: "b", title: "Apples", artistName: "abbey" }),
    artwork({ id: "c", title: "Cypress", artistName: "Braque" }),
  ];

  it("orders by the chosen field, ascending", () => {
    expect(ids(sortArtworks(three, titleAsc))).toEqual(["b", "a", "c"]);
    expect(ids(sortArtworks(three, artistAsc))).toEqual(["b", "c", "a"]);
  });

  it("reverses the field's order descending", () => {
    expect(ids(sortArtworks(three, titleDesc))).toEqual(["c", "a", "b"]);
    expect(ids(sortArtworks(three, artistDesc))).toEqual(["a", "c", "b"]);
  });

  it("folds case, accents and numbers the way the collector reads them", () => {
    const artworks = [
      artwork({ id: "d", title: "Dalí" }),
      artwork({ id: "c", title: "dalí" }),
      artwork({ id: "b", title: "Study 10" }),
      artwork({ id: "a", title: "Study 2" }),
    ];

    // "Dalí" and "dalí" are one value under a base-sensitivity collation, so
    // the id tie-break decides their order; "Study 2" precedes "Study 10"
    // numerically instead of after it the way byte order would put it.
    expect(ids(sortArtworks(artworks, titleAsc))).toEqual(["c", "d", "a", "b"]);
  });

  it("breaks equal values by id ascending, in both directions", () => {
    const untitled = ["a", "b", "c"].map((id) =>
      artwork({ id, title: "Untitled", artistName: "Unknown" }),
    );
    const artworks = [
      ...untitled,
      artwork({ id: "z", title: "Untitled", artistName: "Zed" }),
    ];

    // Titles are all equal: the ids decide, and descending must not flip that
    // — a tie is a tie in either direction.
    expect(ids(sortArtworks(artworks, titleAsc))).toEqual(["a", "b", "c", "z"]);
    expect(ids(sortArtworks(artworks, titleDesc))).toEqual([
      "a",
      "b",
      "c",
      "z",
    ]);
    // Descending artist: "Zed" leads because the field's comparison is
    // negated, while the "Unknown" run keeps its ascending id order.
    expect(ids(sortArtworks(artworks, artistDesc))).toEqual([
      "z",
      "a",
      "b",
      "c",
    ]);
  });

  it("returns a new array and leaves the input in the order it was given", () => {
    const artworks = [
      artwork({ id: "c", title: "Cypress" }),
      artwork({ id: "a", title: "Apples" }),
    ];
    const before = [...artworks];

    const sorted = sortArtworks(artworks, titleAsc);

    expect(sorted).not.toBe(artworks);
    expect(ids(sorted)).toEqual(["a", "c"]);
    expect(artworks).toEqual(before);
    expect(ids(artworks)).toEqual(["c", "a"]);
  });
});
