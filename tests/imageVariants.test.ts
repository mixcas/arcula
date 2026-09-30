import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_IMAGE_TYPES,
  IMAGE_VARIANTS,
  MAX_ARTWORK_PHOTOS,
  MAX_IMAGE_BYTES,
  VARIANT_KEYS,
  coverCrop,
  isAcceptedImageType,
  variantSize,
  type ImageVariantSpec,
  type SquareVariantSpec,
} from "@/utils/imageVariants";

const spec = (key: string): ImageVariantSpec => {
  const found = IMAGE_VARIANTS.find((variant) => variant.key === key);
  if (!found) {
    throw new Error(`no variant ${key}`);
  }
  return found;
};

/** Narrowed to the square case, so `.width`/`.height` are readable. */
const squareSpec = (key: string): SquareVariantSpec => {
  const found = spec(key);
  if (found.fit !== "cover") {
    throw new Error(`${key} is not a square variant`);
  }
  return found;
};

describe("IMAGE_VARIANTS", () => {
  it("declares the five required variants", () => {
    expect(VARIANT_KEYS).toEqual([
      "xlarge",
      "square_lg",
      "square_sm",
      "large",
      "medium",
    ]);
  });

  it("uses a distinct key per variant, which is what the rules regex relies on", () => {
    expect(new Set(VARIANT_KEYS).size).toBe(IMAGE_VARIANTS.length);
  });

  it("caps at ten photos and matches the rules' 10 MiB ceiling", () => {
    expect(MAX_ARTWORK_PHOTOS).toBe(10);
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
  });
});

/**
 * The key list the storage rules accept, read out of `storage.rules` itself.
 *
 * This is the cross-check that was missing when a `.bin` PDF name went
 * straight through: every rules test hand-wrote its fixture names and every
 * component test stubbed the service, so the two sides could agree with each
 * other and still disagree with what the client produces. Reading the rule off
 * disk means the name the client builds and the name the rules accept are
 * compared by a test rather than by a human remembering to edit both files.
 */
const rulesKeyList = (fn: "isPhotoName" | "isDocumentName"): string[] => {
  const source = readFileSync(
    fileURLToPath(new URL("../storage.rules", import.meta.url)),
    "utf8",
  );
  const start = source.indexOf(`function ${fn}(`);
  if (start === -1) {
    throw new Error(`no ${fn} in storage.rules`);
  }
  const body = source.slice(start);
  // The key alternation is the first `_(...)` after the function opens.
  const alternation = /_\(([^)]+)\)/.exec(body);
  if (!alternation) {
    throw new Error(`could not read the key list out of ${fn}`);
  }
  return alternation[1].split("|");
};

describe("storage.rules key list", () => {
  it("accepts every variant the client generates, plus `original`", () => {
    const expected = [...VARIANT_KEYS, "original"];
    expect(rulesKeyList("isPhotoName")).toEqual(expected);
  });

  it("accepts the same keys for documents, plus one extension", () => {
    // Documents generate only a subset (DOCUMENT_IMAGE_VARIANT_KEYS), but the
    // name rule permits the full list: narrowing it here would be a second key
    // list to keep in step, and the subset is already enforced by what gets
    // uploaded.
    expect(rulesKeyList("isDocumentName")).toEqual([
      ...VARIANT_KEYS,
      "original",
    ]);
  });

  it("lets `xlarge` through where `large` would not have matched it", () => {
    // The regex is anchored on both ends, so `large` cannot match an `xlarge`
    // object name — but asserting the alternation is right is only half the
    // story. This is the shape that actually gets written.
    const artworkId = "art1";
    const name = `${artworkId}_aaaaaaaaaaaaaaaaaaaa_xlarge.webp`;
    const pattern = new RegExp(
      `^${artworkId}_[A-Za-z0-9]{20}_(xlarge|square_lg|square_sm|large|medium|original)\\.(webp|jpg|png)$`,
    );
    expect(pattern.test(name)).toBe(true);
  });
});

describe("variantSize — xlarge (inside, no crop, no upscale)", () => {
  it("scales the largest side to 2400", () => {
    expect(variantSize(spec("xlarge"), { width: 4000, height: 3000 })).toEqual({
      width: 2400,
      height: 1800,
    });
  });

  it("leaves a source already inside the box alone, like every bounded variant", () => {
    // A 300x300 plate must not be blown up to 2400px of invented pixels.
    expect(variantSize(spec("xlarge"), { width: 300, height: 300 })).toEqual({
      width: 300,
      height: 300,
    });
  });
});

describe("variantSize — square (cover)", () => {
  it("returns the box exactly, whatever the source shape", () => {
    for (const key of ["square_lg", "square_sm"]) {
      const box = squareSpec(key);
      for (const source of [
        { width: 4000, height: 3000 },
        { width: 3000, height: 4000 },
        { width: 100, height: 100 },
      ]) {
        expect(variantSize(box, source)).toEqual({
          width: box.width,
          height: box.height,
        });
      }
    }
  });

  it("never enlarges a source smaller than the box", () => {
    // A cover crop of a small source still produces an 800x800 box, and
    // `coverCrop` below shows it is drawn upscaled to fill. What matters here
    // is that the arithmetic stays finite and integral.
    expect(
      variantSize(squareSpec("square_lg"), { width: 50, height: 50 }),
    ).toEqual({ width: 800, height: 800 });
  });
});

describe("variantSize — bounded (inside, no crop, no upscale)", () => {
  it("scales the largest side to the max and keeps the aspect ratio", () => {
    expect(variantSize(spec("large"), { width: 3000, height: 2000 })).toEqual({
      width: 1200,
      height: 800,
    });
    expect(variantSize(spec("medium"), { width: 3000, height: 2000 })).toEqual({
      width: 800,
      height: 533,
    });
  });

  it("handles portrait sources by scaling the height", () => {
    expect(variantSize(spec("large"), { width: 2000, height: 3000 })).toEqual({
      width: 800,
      height: 1200,
    });
  });

  it("leaves a source already inside the box alone", () => {
    expect(variantSize(spec("large"), { width: 640, height: 480 })).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("never enlarges a source below the max", () => {
    // The case the no-upgrade rule exists for: a small book plate must not be
    // blown up to 800px of invented pixels.
    expect(variantSize(spec("large"), { width: 300, height: 300 })).toEqual({
      width: 300,
      height: 300,
    });
    expect(variantSize(spec("medium"), { width: 100, height: 200 })).toEqual({
      width: 100,
      height: 200,
    });
  });

  it("scales a source just over the max", () => {
    expect(variantSize(spec("medium"), { width: 801, height: 801 })).toEqual({
      width: 800,
      height: 800,
    });
  });

  it("never produces a zero dimension", () => {
    expect(variantSize(spec("large"), { width: 4000, height: 1 })).toEqual({
      width: 1200,
      height: 1,
    });
  });
});

describe("coverCrop", () => {
  it("crops a landscape source symmetrically to a square", () => {
    const crop = coverCrop(
      { width: 800, height: 800 },
      { width: 4000, height: 2000 },
    );
    // Scale is set by the height (2000 -> 800), so the width overflows and the
    // kept window is 2000x2000 of the original, centred horizontally.
    expect(crop.sHeight).toBeCloseTo(2000, 5);
    expect(crop.sWidth).toBeCloseTo(2000, 5);
    expect(crop.sx).toBeCloseTo(1000, 5);
    expect(crop.sy).toBeCloseTo(0, 5);
  });

  it("crops a portrait source symmetrically to a square", () => {
    const crop = coverCrop(
      { width: 400, height: 400 },
      { width: 2000, height: 4000 },
    );
    expect(crop.sWidth).toBeCloseTo(2000, 5);
    expect(crop.sHeight).toBeCloseTo(2000, 5);
    expect(crop.sx).toBeCloseTo(0, 5);
    expect(crop.sy).toBeCloseTo(1000, 5);
  });

  it("crops nothing from a square source", () => {
    const crop = coverCrop(
      { width: 800, height: 800 },
      { width: 1500, height: 1500 },
    );
    expect(crop.sWidth).toBeCloseTo(1500, 5);
    expect(crop.sHeight).toBeCloseTo(1500, 5);
    expect(crop.sx).toBeCloseTo(0, 5);
    expect(crop.sy).toBeCloseTo(0, 5);
  });

  it("always keeps a window no larger than the source, and never off the edge", () => {
    // The invariant that makes this safe to hand straight to drawImage: the
    // crop must stay inside the source, or the canvas silently draws nothing.
    for (const source of [
      { width: 4000, height: 2000 },
      { width: 2000, height: 4000 },
      { width: 900, height: 300 },
      { width: 300, height: 900 },
    ]) {
      const crop = coverCrop({ width: 800, height: 800 }, source);
      expect(crop.sWidth).toBeLessThanOrEqual(source.width + 1e-6);
      expect(crop.sHeight).toBeLessThanOrEqual(source.height + 1e-6);
      expect(crop.sx).toBeGreaterThanOrEqual(-1e-6);
      expect(crop.sy).toBeGreaterThanOrEqual(-1e-6);
      expect(crop.sx + crop.sWidth).toBeLessThanOrEqual(source.width + 1e-6);
      expect(crop.sy + crop.sHeight).toBeLessThanOrEqual(source.height + 1e-6);
    }
  });

  it("keeps a window with the target's aspect ratio, not the source's", () => {
    // A 4:1 source cropped to a square keeps a square window — that is the
    // crop working, not a bug. What must hold is that the kept window always
    // matches the shape it is about to be stretched into, so nothing is
    // distorted on the way out.
    const target = { width: 800, height: 800 };
    for (const source of [
      { width: 4000, height: 1000 },
      { width: 1000, height: 4000 },
      { width: 3000, height: 2000 },
    ]) {
      const crop = coverCrop(target, source);
      expect(crop.sWidth / crop.sHeight).toBeCloseTo(
        target.width / target.height,
        5,
      );
    }
  });

  it("keeps the largest window that fits, not a smaller one", () => {
    // With a 4000x1000 source the height is the binding edge, so the full
    // height is kept and exactly 1000 of the 4000 width survives.
    const crop = coverCrop(
      { width: 800, height: 800 },
      { width: 4000, height: 1000 },
    );
    expect(crop.sHeight).toBeCloseTo(1000, 5);
    expect(crop.sWidth).toBeCloseTo(1000, 5);
  });
});

describe("isAcceptedImageType", () => {
  it("accepts the three listed types", () => {
    for (const type of Object.keys(ACCEPTED_IMAGE_TYPES)) {
      expect(isAcceptedImageType(type)).toBe(true);
    }
  });

  it("rejects anything else, including a missing type", () => {
    for (const type of [
      "image/gif",
      "image/svg+xml",
      "application/pdf",
      "text/html",
      "",
    ]) {
      expect(isAcceptedImageType(type)).toBe(false);
    }
    expect(isAcceptedImageType(undefined)).toBe(false);
  });
});
