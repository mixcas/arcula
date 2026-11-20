import { describe, expect, it } from "vitest";

import {
  photoPageCount,
  type CataloguePdfPage,
} from "@/components/pdf/cataloguePdfPlan";
import { buildSelectionPdfPlan } from "@/components/pdf/selectionPdfPlan";
import type { Artwork, ArtworkPhoto } from "@arcula/shared";

/**
 * A Selection's plan is a second entry point over the Catalogue's page shapes,
 * not a second rule: the read already decided membership (live works, Drafts
 * included) and order (`position`). The plan must therefore preserve what it is
 * handed, drop only a deleted work, and never sort.
 */

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

const artwork = (id: string, overrides: Partial<Artwork> = {}): Artwork => ({
  id,
  userId: "owner-1",
  catalogueId: "catalogue-1",
  title: "Untitled",
  artistName: "Unknown",
  photos: [],
  documents: [],
  ...overrides,
});

const plannedArtworkIds = (plan: CataloguePdfPage[]): string[] => {
  const ids = plan.flatMap((page) => {
    if (page.kind === "photo") return [page.artwork.id];
    if (page.kind === "grid") return page.artworks.map((work) => work.id);
    return [];
  });
  return [...new Set(ids)];
};

describe("buildSelectionPdfPlan order", () => {
  it("keeps the curator's order rather than sorting by artist or title", () => {
    const plan = buildSelectionPdfPlan([
      artwork("zulu", { title: "Zulu", artistName: "Zoe" }),
      artwork("alpha", { title: "Alpha", artistName: "Ana" }),
    ]);

    expect(plannedArtworkIds(plan)).toEqual(["zulu", "alpha"]);
  });

  it("keeps a mixed photo and no-photo list in the order it is read in", () => {
    const plan = buildSelectionPdfPlan([
      artwork("a-photo", { photos: [photo("a-one", 0)] }),
      artwork("b-no-photo"),
      artwork("c-photo", { photos: [photo("c-one", 0)] }),
    ]);

    expect(plannedArtworkIds(plan)).toEqual([
      "a-photo",
      "b-no-photo",
      "c-photo",
    ]);
  });

  it("keeps the order two works that would tie in a sort are read in", () => {
    // `position` is the curator's, and the read breaks a duplicated position by
    // artwork id. Neither rule belongs here: the plan must not re-decide either
    // one, so the input order is the answer even for two identical records.
    const plan = buildSelectionPdfPlan([
      artwork("bbb", { title: "Same", artistName: "Same" }),
      artwork("aaa", { title: "Same", artistName: "Same" }),
    ]);

    expect(plannedArtworkIds(plan)).toEqual(["bbb", "aaa"]);
  });
});

describe("buildSelectionPdfPlan membership", () => {
  it("keeps a Draft: a Selection shows Drafts on purpose", () => {
    const plan = buildSelectionPdfPlan([
      artwork("draft", { status: "draft" }),
      artwork("published", { status: "published" }),
    ]);

    expect(plannedArtworkIds(plan)).toEqual(["draft", "published"]);
  });

  it("drops a work deleted in its Catalogue", () => {
    const plan = buildSelectionPdfPlan([
      artwork("live"),
      artwork("gone", { deletedAt: { seconds: 1, nanoseconds: 0 } }),
      artwork("also-live"),
    ]);

    expect(plannedArtworkIds(plan)).toEqual(["live", "also-live"]);
  });

  it("is exactly one empty page when the Selection has no works", () => {
    expect(buildSelectionPdfPlan([])).toEqual([{ kind: "empty" }]);
  });

  it("is exactly one empty page when the only work was deleted", () => {
    expect(
      buildSelectionPdfPlan([
        artwork("gone", { deletedAt: { seconds: 1, nanoseconds: 0 } }),
      ]),
    ).toEqual([{ kind: "empty" }]);
  });
});

describe("buildSelectionPdfPlan page shapes", () => {
  it("reuses the Catalogue's photo pages, capped at three per work", () => {
    const plan = buildSelectionPdfPlan([
      artwork("photo-work", {
        photos: [
          photo("first", 0),
          photo("second", 1),
          photo("third", 2),
          photo("fourth", 3),
        ],
      }),
    ]);

    const photos = plan.flatMap((page) =>
      page.kind === "photo" ? [page.photo.id] : [],
    );
    expect(photos).toEqual(["first", "second", "third"]);
    expect(photoPageCount(plan)).toBe(3);
  });

  it("groups no-photo works six per grid page in reading order", () => {
    const works = Array.from({ length: 7 }, (_, index) =>
      artwork(`work-${index}`),
    );

    const grids = buildSelectionPdfPlan(works).flatMap((page) =>
      page.kind === "grid" ? [page.artworks.map((work) => work.id)] : [],
    );

    expect(grids).toEqual([
      ["work-0", "work-1", "work-2", "work-3", "work-4", "work-5"],
      ["work-6"],
    ]);
  });
});
