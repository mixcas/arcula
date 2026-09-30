import { describe, expect, it } from "vitest";
import {
  photoOrderChanged,
  photoSrcSet,
  photoUrl,
  photoUrls,
  primaryPhoto,
  reindexPhotos,
  sortPhotos,
} from "@/utils/artworkPhotos";
import type { ArtworkPhoto, ImageVariantKey } from "@/types";

const variant = (key: ImageVariantKey, url: string) => ({
  key,
  url,
  width: 1,
  height: 1,
  size: 1,
  contentType: "image/webp",
});

/** A variant with a real encoded width, which is what `srcset` publishes. */
const sizedVariant = (
  key: ImageVariantKey,
  url: string,
  width: number,
): ArtworkPhoto["variants"][number] => ({
  ...variant(key, url),
  width,
  height: Math.round(width * 0.75),
});

const photo = (id: string, order: number): ArtworkPhoto => ({
  id,
  order,
  name: `${id}.jpg`,
  size: 100,
  contentType: "image/jpeg",
  width: 2000,
  height: 1500,
  original: { url: `orig/${id}`, size: 100, contentType: "image/jpeg" },
  variants: [
    variant("square_lg", `sq-lg/${id}`),
    variant("square_sm", `sq-sm/${id}`),
    variant("large", `large/${id}`),
    variant("medium", `med/${id}`),
  ],
});

describe("reindexPhotos", () => {
  it("renumbers order from array position, closing gaps", () => {
    expect(
      reindexPhotos([photo("a", 7), photo("b", 3), photo("c", 90)]).map(
        (p) => p.order,
      ),
    ).toEqual([0, 1, 2]);
  });

  it("is idempotent", () => {
    const once = reindexPhotos([photo("a", 7), photo("b", 3)]);
    expect(reindexPhotos(once)).toEqual(once);
  });

  it("does not mutate its input", () => {
    const input = [photo("a", 7)];
    reindexPhotos(input);
    expect(input[0].order).toBe(7);
  });
});

describe("sortPhotos", () => {
  it("sorts by order, not by array position", () => {
    expect(
      sortPhotos([photo("c", 2), photo("a", 0), photo("b", 1)]).map(
        (p) => p.id,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("breaks ties on array position so the result is deterministic", () => {
    expect(
      sortPhotos([photo("a", 0), photo("b", 0), photo("c", 0)]).map(
        (p) => p.id,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("returns [] for absent, empty and non-array values", () => {
    expect(sortPhotos(undefined)).toEqual([]);
    expect(sortPhotos([])).toEqual([]);
    expect(sortPhotos(null as unknown as ArtworkPhoto[])).toEqual([]);
  });
});

describe("primaryPhoto", () => {
  it("is the photo at order 0 regardless of array position", () => {
    expect(
      primaryPhoto({ photos: [photo("c", 2), photo("a", 0), photo("b", 1)] })
        ?.id,
    ).toBe("a");
  });

  it("is null when the artwork has no photos", () => {
    expect(primaryPhoto({ photos: [] })).toBeNull();
    expect(
      primaryPhoto({ photos: undefined as unknown as ArtworkPhoto[] }),
    ).toBeNull();
  });
});

describe("photoUrls", () => {
  it("returns originals in sequence order", () => {
    expect(photoUrls({ photos: [photo("b", 1), photo("a", 0)] })).toEqual([
      "orig/a",
      "orig/b",
    ]);
  });

  it("is empty for no photos", () => {
    expect(photoUrls({ photos: [] })).toEqual([]);
  });
});

describe("photoUrl", () => {
  it("returns the requested variant", () => {
    expect(photoUrl(photo("a", 0), "square_sm")).toBe("sq-sm/a");
    expect(photoUrl(photo("a", 0), "large")).toBe("large/a");
  });

  it("falls back to the original when the variant is missing", () => {
    const partial: ArtworkPhoto = {
      ...photo("a", 0),
      variants: [variant("square_sm", "sq/a")],
    };
    expect(photoUrl(partial, "large")).toBe("orig/a");
  });

  it("is null when there is no photo at all", () => {
    expect(photoUrl(null, "large")).toBeNull();
  });
});

describe("photoSrcSet", () => {
  const modern: ArtworkPhoto = {
    ...photo("a", 0),
    variants: [
      sizedVariant("xlarge", "xl/a", 2400),
      sizedVariant("square_lg", "sq-lg/a", 800),
      sizedVariant("large", "large/a", 1200),
      sizedVariant("medium", "med/a", 800),
    ],
  };
  // Written before `xlarge` existed. This is the shape every existing photo has.
  const legacy: ArtworkPhoto = {
    ...photo("b", 0),
    variants: [
      sizedVariant("square_lg", "sq-lg/b", 800),
      sizedVariant("square_sm", "sq-sm/b", 400),
      sizedVariant("large", "large/b", 1200),
      sizedVariant("medium", "med/b", 800),
    ],
  };

  it("offers only the variants the photo actually has, in the order given", () => {
    expect(photoSrcSet(modern, ["xlarge", "large"])).toBe(
      "xl/a 2400w, large/a 1200w",
    );
  });

  it("drops a requested key the photo was uploaded without", () => {
    // A `srcset` may only list candidates that resolve: a 404 makes the browser
    // reach for another and silently degrade. Filtering is the whole point.
    expect(photoSrcSet(legacy, ["xlarge", "large"])).toBe("large/b 1200w");
  });

  it("publishes the recorded width, not the nominal target", () => {
    // `variantSize` never enlarges, so a small plate's `xlarge` is smaller than
    // 2400 and overstating it would make the browser upscale a candidate.
    const plate: ArtworkPhoto = {
      ...photo("c", 0),
      variants: [sizedVariant("xlarge", "xl/c", 300)],
    };
    expect(photoSrcSet(plate, ["xlarge"])).toBe("xl/c 300w");
  });

  it("is undefined for a photo with no variants and for no photo at all", () => {
    // The original is never substituted in: it is the archival source and can
    // be ten megabytes. `photoUrl` still falls back to it for `src`, which is a
    // safety net — not a display candidate. An empty `srcset` attribute would
    // be worse than no attribute at all, hence undefined rather than "".
    expect(photoSrcSet({ ...photo("d", 0), variants: [] }, ["xlarge"])).toBe(
      undefined,
    );
    expect(photoSrcSet(null, ["xlarge", "large"])).toBe(undefined);
  });
});

describe("photoOrderChanged", () => {
  it("is false when only non-order fields would differ", () => {
    const stored = [photo("a", 0), photo("b", 1)];
    const candidate = [
      { ...photo("a", 0), name: "renamed.jpg" },
      { ...photo("b", 1), url: undefined } as ArtworkPhoto,
    ];
    expect(photoOrderChanged(stored, candidate)).toBe(false);
  });

  it("is false for an identical id sequence even with different order numbers", () => {
    expect(
      photoOrderChanged(
        [photo("a", 0), photo("b", 1)],
        [photo("a", 0), photo("b", 1)],
      ),
    ).toBe(false);
  });

  it("is true for a swapped sequence", () => {
    expect(
      photoOrderChanged(
        [photo("a", 0), photo("b", 1)],
        [photo("b", 0), photo("a", 1)],
      ),
    ).toBe(true);
  });

  it("is true when a photo was added or removed", () => {
    expect(
      photoOrderChanged([photo("a", 0)], [photo("a", 0), photo("b", 1)]),
    ).toBe(true);
    expect(
      photoOrderChanged([photo("a", 0), photo("b", 1)], [photo("a", 0)]),
    ).toBe(true);
  });

  it("is true when photos go from absent to present", () => {
    expect(photoOrderChanged(undefined, [photo("a", 0)])).toBe(true);
  });

  it("is false when both sides are empty", () => {
    expect(photoOrderChanged([], [])).toBe(false);
  });
});
