import { describe, expect, it } from "vitest";

import {
  buildCollectionPdfPlan,
  isExportableArtwork,
  photoPageCount,
  type CollectionPdfPage,
} from "@/components/pdf/collectionPdfPlan";
import type { Artwork, ArtworkPhoto } from "@arcula/shared";

const photo = (id: string, order: number): ArtworkPhoto => ({
  id,
  order,
  name: `${id}.jpg`,
  size: 100,
  contentType: "image/jpeg",
  width: 10,
  height: 10,
  original: { url: `/media/${id}`, size: 100, contentType: "image/jpeg" },
  variants: [],
});

const artwork = (overrides: Partial<Artwork> = {}): Artwork => ({
  id: "artwork-1",
  userId: "owner-1",
  collectionId: "collection-1",
  title: "Untitled",
  artistName: "Unknown",
  photos: [],
  documents: [],
  ...overrides,
});

const photoPages = (plan: CollectionPdfPage[]) =>
  plan.filter((page) => page.kind === "photo");

const gridPages = (plan: CollectionPdfPage[]) =>
  plan.filter((page) => page.kind === "grid");

/** The works named by a plan, in reading order, without duplicates. */
const plannedArtworkIds = (plan: CollectionPdfPage[]): string[] => {
  const ids = plan.flatMap((page) => {
    if (page.kind === "photo") return [page.artwork.id];
    if (page.kind === "grid") return page.artworks.map((work) => work.id);
    return [];
  });
  return [...new Set(ids)];
};

describe("isExportableArtwork", () => {
  it("exports a published work", () => {
    expect(isExportableArtwork(artwork({ status: "published" }))).toBe(true);
  });

  it("excludes a draft", () => {
    expect(isExportableArtwork(artwork({ status: "draft" }))).toBe(false);
  });

  it("reads an absent status as published", () => {
    const work = artwork();
    delete work.status;
    expect(isExportableArtwork(work)).toBe(true);
  });

  it("excludes a soft-deleted work", () => {
    expect(
      isExportableArtwork(
        artwork({ deletedAt: { seconds: 1, nanoseconds: 0 } }),
      ),
    ).toBe(false);
  });

  it("treats a null deletedAt as live", () => {
    expect(isExportableArtwork(artwork({ deletedAt: null }))).toBe(true);
  });
});

describe("buildCollectionPdfPlan ordering", () => {
  it("orders by artist name before title", () => {
    const plan = buildCollectionPdfPlan([
      artwork({ id: "b", artistName: "Beta", title: "Alpha" }),
      artwork({ id: "a", artistName: "Alpha", title: "Zulu" }),
    ]);

    expect(plannedArtworkIds(plan)).toEqual(["a", "b"]);
  });

  it("orders by title within one artist", () => {
    const plan = buildCollectionPdfPlan([
      artwork({ id: "beta", artistName: "Same", title: "Beta" }),
      artwork({ id: "alpha", artistName: "Same", title: "Alpha" }),
    ]);

    expect(plannedArtworkIds(plan)).toEqual(["alpha", "beta"]);
  });

  it("is case-insensitive", () => {
    const plan = buildCollectionPdfPlan([
      artwork({ id: "upper", artistName: "Beta" }),
      artwork({ id: "lower", artistName: "alpha" }),
    ]);

    expect(plannedArtworkIds(plan)).toEqual(["lower", "upper"]);
  });

  it("is accent-insensitive", () => {
    // Base sensitivity makes these two artists equal, so the id decides; the
    // default variant sensitivity would put the accented name last instead.
    const plan = buildCollectionPdfPlan([
      artwork({ id: "a", artistName: "Émile" }),
      artwork({ id: "b", artistName: "Emile" }),
    ]);

    expect(plannedArtworkIds(plan)).toEqual(["a", "b"]);
  });

  it("is numeric-aware", () => {
    const plan = buildCollectionPdfPlan([
      artwork({ id: "ten", artistName: "Same", title: "Plate 10" }),
      artwork({ id: "two", artistName: "Same", title: "Plate 2" }),
    ]);

    expect(plannedArtworkIds(plan)).toEqual(["two", "ten"]);
  });

  it("breaks an exact tie by raw id, not by the base collator", () => {
    // `p02` and `p2` are equal under the base/numeric collator, so a
    // collator-based tie-break would keep the input order; the raw id must
    // decide.
    const plan = buildCollectionPdfPlan([
      artwork({ id: "p2", artistName: "Same", title: "Same" }),
      artwork({ id: "p02", artistName: "Same", title: "Same" }),
      artwork({ id: "a", artistName: "Same", title: "Same" }),
      artwork({ id: "b", artistName: "Same", title: "Same" }),
    ]);

    expect(plannedArtworkIds(plan)).toEqual(["a", "b", "p02", "p2"]);
  });
});

describe("buildCollectionPdfPlan photo pages", () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 3],
  ])("turns %i photos into %i pages", (count, expectedPages) => {
    const photos = Array.from({ length: count }, (_, index) =>
      photo(`photo-${index}`, index),
    );
    const plan = buildCollectionPdfPlan([artwork({ photos })]);

    expect(photoPages(plan)).toHaveLength(expectedPages);
    expect(plan).toHaveLength(expectedPages);
  });

  it("uses the first three photos in stored order and never the fourth", () => {
    const plan = buildCollectionPdfPlan([
      artwork({
        id: "shuffled",
        photos: [
          photo("third", 2),
          photo("first", 0),
          photo("second", 1),
          photo("fourth", 3),
        ],
      }),
    ]);

    expect(
      photoPages(plan).map((page) =>
        page.kind === "photo" ? page.photo.id : null,
      ),
    ).toEqual(["first", "second", "third"]);
  });

  it("classifies a photo page by presence, not by a usable URL", () => {
    const unloadable = photo("missing", 0);
    unloadable.original = { url: "", size: 0, contentType: "" };
    unloadable.variants = [];

    const plan = buildCollectionPdfPlan([artwork({ photos: [unloadable] })]);

    expect(photoPages(plan)).toHaveLength(1);
    expect(gridPages(plan)).toHaveLength(0);
  });
});

describe("buildCollectionPdfPlan grid pages", () => {
  it("groups no-photo works six per page with a partial last page", () => {
    const works = Array.from({ length: 7 }, (_, index) =>
      artwork({
        id: `work-${index}`,
        artistName: `Artist ${index}`,
      }),
    );

    const plan = buildCollectionPdfPlan(works);
    const grids = gridPages(plan);

    expect(grids).toHaveLength(2);
    expect(
      grids.map((page) => (page.kind === "grid" ? page.artworks.length : 0)),
    ).toEqual([6, 1]);
  });

  it("keeps the sorted order inside and across grid pages", () => {
    const works = [
      artwork({ id: "g", artistName: "Artist 7" }),
      artwork({ id: "c", artistName: "Artist 3" }),
      artwork({ id: "a", artistName: "Artist 1" }),
      artwork({ id: "f", artistName: "Artist 6" }),
      artwork({ id: "b", artistName: "Artist 2" }),
      artwork({ id: "e", artistName: "Artist 5" }),
      artwork({ id: "d", artistName: "Artist 4" }),
    ];

    const ids = gridPages(buildCollectionPdfPlan(works)).flatMap((page) =>
      page.kind === "grid" ? page.artworks.map((work) => work.id) : [],
    );

    expect(ids).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("never crosses a work between the photo pages and the grid", () => {
    const withPhotos = artwork({
      id: "photo-work",
      artistName: "A",
      photos: [photo("one", 0), photo("two", 1), photo("three", 2)],
    });
    const firstGrid = artwork({ id: "grid-a", artistName: "B" });
    const secondGrid = artwork({ id: "grid-b", artistName: "C" });

    const plan = buildCollectionPdfPlan([withPhotos, firstGrid, secondGrid]);

    expect(
      photoPages(plan).every(
        (page) => page.kind === "photo" && page.artwork.id === "photo-work",
      ),
    ).toBe(true);
    expect(
      gridPages(plan).flatMap((page) =>
        page.kind === "grid" ? page.artworks.map((work) => work.id) : [],
      ),
    ).toEqual(["grid-a", "grid-b"]);
  });
});

describe("buildCollectionPdfPlan page count", () => {
  it("is the photo pages plus the grid pages for a mixed collection", () => {
    const threePhotos = artwork({
      id: "three",
      artistName: "A",
      photos: [photo("a", 0), photo("b", 1), photo("c", 2)],
    });
    const onePhoto = artwork({
      id: "one",
      artistName: "B",
      photos: [photo("d", 0)],
    });
    const gridWorks = Array.from({ length: 7 }, (_, index) =>
      artwork({ id: `grid-${index}`, artistName: `Grid ${index}` }),
    );

    const plan = buildCollectionPdfPlan([threePhotos, onePhoto, ...gridWorks]);

    const photoCount = photoPages(plan).length;
    const gridCount = gridPages(plan).length;

    expect(photoCount).toBe(4);
    expect(gridCount).toBe(2);
    expect(photoPageCount(plan)).toBe(photoCount);
    expect(plan).toHaveLength(photoCount + gridCount);
    expect(plan).toHaveLength(6);
  });

  it("counts no photo pages in a grid-only or empty plan", () => {
    expect(photoPageCount(buildCollectionPdfPlan([artwork()]))).toBe(0);
    expect(photoPageCount(buildCollectionPdfPlan([]))).toBe(0);
  });

  it("is exactly one empty page for an empty collection", () => {
    expect(buildCollectionPdfPlan([])).toEqual([{ kind: "empty" }]);
  });

  it("is exactly one empty page when every work is a draft", () => {
    const plan = buildCollectionPdfPlan([
      artwork({ id: "draft-a", status: "draft" }),
      artwork({ id: "draft-b", status: "draft" }),
    ]);

    expect(plan).toEqual([{ kind: "empty" }]);
  });

  it("is exactly one empty page when the only works are deleted", () => {
    const plan = buildCollectionPdfPlan([
      artwork({
        id: "gone",
        deletedAt: { seconds: 1, nanoseconds: 0 },
      }),
    ]);

    expect(plan).toEqual([{ kind: "empty" }]);
  });
});
