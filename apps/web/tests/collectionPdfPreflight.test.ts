import { describe, expect, it } from "vitest";

import {
  collectionPdfFileName,
  collectionPdfTexts,
  fallbackCharacters,
  fallbackChunks,
  fitInsideBox,
  IMAGE_UNAVAILABLE,
  PHOTO_PRINT_BOX,
  placeInPhotoBox,
  PRINT_BOX_PX,
  printedSize,
  shouldWarnForLargeExport,
} from "@/components/pdf/collectionPdfPreflight";
import type { Artwork, ArtworkPhoto } from "@arcula/shared";

const photo = (id: string, name = `${id}.jpg`): ArtworkPhoto => ({
  id,
  order: 0,
  name,
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

describe("fitInsideBox", () => {
  it("never enlarges a source smaller than the box", () => {
    expect(
      fitInsideBox({ width: 100, height: 50 }, { width: 1625, height: 2163 }),
    ).toEqual({ width: 100, height: 50 });
  });

  it("preserves the aspect ratio when the source is wider than the box", () => {
    expect(
      fitInsideBox(
        { width: 3250, height: 2000 },
        { width: 1625, height: 2163 },
      ),
    ).toEqual({ width: 1625, height: 1000 });
  });

  it("preserves the aspect ratio when the source is taller than the box", () => {
    expect(
      fitInsideBox(
        { width: 2000, height: 4326 },
        { width: 1625, height: 2163 },
      ),
    ).toEqual({ width: 1000, height: 2163 });
  });

  it("targets 1625 x 2163 px for a source exactly twice the print box", () => {
    // The print box is 390 x 519 pt at 300 dpi.
    expect(fitInsideBox({ width: 3250, height: 4326 }, PRINT_BOX_PX)).toEqual({
      width: 1625,
      height: 2163,
    });
  });

  it("rounds to at least one pixel on a very thin source", () => {
    expect(
      fitInsideBox({ width: 10000, height: 1 }, { width: 10, height: 10 }),
    ).toEqual({ width: 10, height: 1 });
  });

  it("rounds fractional dimensions", () => {
    expect(
      fitInsideBox(
        { width: 1000, height: 4000 },
        { width: 1625, height: 2163 },
      ),
    ).toEqual({ width: 541, height: 2163 });
  });
});

describe("printedSize", () => {
  it("converts pixels to points at 300 dpi", () => {
    // 1625 px / 300 dpi = 5.4167 in = 390 pt.
    expect(printedSize({ width: 1625, height: 1000 })).toEqual({
      width: 390,
      height: 240,
    });
  });

  it("keeps the converted photo's own pixel size, which may exceed the box", () => {
    // 2163 px at 300 dpi is 519.12 pt; the box is the cap, not the source.
    expect(printedSize(PRINT_BOX_PX).height).toBeCloseTo(519.12, 3);
  });
});

describe("placeInPhotoBox", () => {
  it("centres a photo that is exactly the box", () => {
    expect(placeInPhotoBox({ width: 390, height: 519 })).toEqual({
      left: PHOTO_PRINT_BOX.left,
      top: PHOTO_PRINT_BOX.top,
      width: 390,
      height: 519,
    });
  });

  it("centres a landscape photo vertically without stretching it", () => {
    // 1625 x 1000 px is 390 x 240 pt: full width, 139.5 pt above and below.
    const placement = placeInPhotoBox({ width: 390, height: 240 });

    expect(placement.width).toBe(390);
    expect(placement.height).toBe(240);
    expect(placement.left).toBe(PHOTO_PRINT_BOX.left);
    expect(placement.top).toBeCloseTo(PHOTO_PRINT_BOX.top + 139.5, 3);
  });

  it("centres a small photo at its own size instead of enlarging it", () => {
    // 500 x 500 px is 120 x 120 pt, well inside the box.
    const placement = placeInPhotoBox({ width: 120, height: 120 });

    expect(placement.width).toBe(120);
    expect(placement.height).toBe(120);
    expect(placement.left).toBeCloseTo(PHOTO_PRINT_BOX.left + 135, 3);
    expect(placement.top).toBeCloseTo(PHOTO_PRINT_BOX.top + 199.5, 3);
  });

  it("caps a photo larger than the box instead of overflowing it", () => {
    const placement = placeInPhotoBox({ width: 390, height: 519.12 });

    expect(placement.height).toBe(519);
    expect(placement.top).toBe(PHOTO_PRINT_BOX.top);
  });
});

describe("fallbackCharacters", () => {
  it("returns an empty string for ASCII-only text, DEL included", () => {
    expect(fallbackCharacters(["Cafe 123", "plain", "\u007f"])).toBe("");
  });

  it("keeps distinct non-ASCII code points, sorted", () => {
    expect(fallbackCharacters(["aéé中中"])).toBe("é中");
  });

  it("returns the non-ASCII subset of a mixed string", () => {
    expect(fallbackCharacters(["Café 123 日本"])).toBe("é日本");
  });

  it("combines several strings", () => {
    expect(fallbackCharacters(["é", "abc", "中"])).toBe("é中");
  });

  it("handles an astral code point as one character", () => {
    const characters = fallbackCharacters(["a😀b😀"]);

    expect(characters).toBe("😀");
    expect(Array.from(characters)).toHaveLength(1);
  });
});

describe("fallbackChunks", () => {
  it("splits the empty string into no chunks", () => {
    expect(fallbackChunks("")).toEqual([]);
  });

  it("keeps one chunk for one character", () => {
    expect(fallbackChunks("é")).toEqual(["é"]);
  });

  it("keeps one chunk at the 512-character boundary", () => {
    const chunks = fallbackChunks("é".repeat(512));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("é".repeat(512));
  });

  it("splits two chunks past 512 characters", () => {
    expect(fallbackChunks("é".repeat(513))).toEqual(["é".repeat(512), "é"]);
  });

  it("splits by code point, not by UTF-16 unit", () => {
    const chunks = fallbackChunks("😀".repeat(513));

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe("😀".repeat(512));
    expect(chunks[1]).toBe("😀");
    expect(Array.from(chunks[0])).toHaveLength(512);
  });
});

describe("collectionPdfTexts", () => {
  it("collects the collection name, titles, metadata values and placeholder", () => {
    const texts = collectionPdfTexts("Flores Solares", [
      artwork({
        title: "Estudio en rojo",
        artistName: "María López",
        serie: "Rojo",
        media: "Oil",
        dimensions: "100 × 80 cm",
        editions: "3/5",
        dateOfCreation: "2024",
        placeOfOrigin: "Madrid",
        photos: [photo("one", "IMG_1234.webp")],
      }),
    ]);

    expect(texts).toEqual([
      "Flores Solares",
      "Estudio en rojo",
      "María López",
      "Rojo",
      "Oil",
      "100 × 80 cm",
      "3/5",
      "2024",
      "Madrid",
      IMAGE_UNAVAILABLE,
    ]);
  });

  it("excludes the photo filename", () => {
    const texts = collectionPdfTexts("Flores Solares", [
      artwork({ photos: [photo("one", "IMG_1234.webp")] }),
    ]);

    expect(texts).not.toContain("IMG_1234.webp");
    expect(texts.join(" ")).not.toContain("IMG_1234");
  });

  it("omits absent and blank metadata values", () => {
    const texts = collectionPdfTexts("C", [
      artwork({
        title: "Sparse",
        artistName: "Ana",
        serie: "   ",
        media: "",
      }),
    ]);

    expect(texts).toEqual(["C", "Sparse", "Ana", IMAGE_UNAVAILABLE]);
  });

  it("excludes drafts and deleted works", () => {
    const texts = collectionPdfTexts("C", [
      artwork({
        id: "draft",
        title: "Secret draft",
        artistName: "Draft Artist",
        status: "draft",
      }),
      artwork({
        id: "deleted",
        title: "Deleted work",
        artistName: "Deleted Artist",
        deletedAt: { seconds: 1, nanoseconds: 0 },
      }),
    ]);

    expect(texts).toEqual(["C", IMAGE_UNAVAILABLE]);
  });

  it("keeps document order: photo pages before the grid", () => {
    const texts = collectionPdfTexts("C", [
      // Sorts first by artist, but it is a grid work and comes after the
      // photo pages in the document.
      artwork({ id: "grid", title: "Alpha", artistName: "Ana" }),
      artwork({
        id: "photo",
        title: "Zulu",
        artistName: "Zoe",
        photos: [photo("one")],
      }),
    ]);

    expect(texts).toEqual([
      "C",
      "Zulu",
      "Zoe",
      "Alpha",
      "Ana",
      IMAGE_UNAVAILABLE,
    ]);
  });

  it("dedupes repeated values", () => {
    const texts = collectionPdfTexts("C", [
      artwork({ id: "a", title: "One", artistName: "Same Artist" }),
      artwork({ id: "b", title: "Two", artistName: "Same Artist" }),
    ]);

    expect(texts.filter((text) => text === "Same Artist")).toHaveLength(1);
  });

  it("feeds a non-ASCII title and collection name to the fallback set", () => {
    const texts = collectionPdfTexts("收藏", [
      artwork({ title: "Été 日本", artistName: "Ana" }),
    ]);

    expect(fallbackCharacters(texts)).toBe("Éé收日本藏");
  });

  it("does not feed a non-ASCII photo filename to the fallback set", () => {
    const texts = collectionPdfTexts("C", [
      artwork({
        title: "Plain",
        artistName: "Ana",
        photos: [photo("one", "写真.jpg")],
      }),
    ]);

    expect(fallbackCharacters(texts)).not.toContain("写");
  });
});

describe("shouldWarnForLargeExport", () => {
  it.each([
    [30, undefined, false, true],
    [29, undefined, false, false],
    [15, 4, false, true],
    [15, 3, false, true],
    [15, undefined, true, true],
    [15, 8, true, true],
    [15, 8, false, false],
    [14, 4, true, false],
    [0, 1, true, false],
    [99, undefined, false, true],
  ])(
    "warns for %i photo pages with memory %s and mobile %s as %s",
    (photoPages, deviceMemory, isMobileLayout, expected) => {
      expect(
        shouldWarnForLargeExport(photoPages, deviceMemory, isMobileLayout),
      ).toBe(expected);
    },
  );
});

describe("collectionPdfFileName", () => {
  it("urlizes the collection name", () => {
    expect(collectionPdfFileName("Flores Solares")).toBe("flores-solares.pdf");
  });

  it("collapses punctuation and spacing", () => {
    expect(collectionPdfFileName("  ¡Hola!  Arte ")).toBe("hola-arte.pdf");
  });

  it("falls back to collection for a fully non-ASCII name", () => {
    expect(collectionPdfFileName("收藏")).toBe("collection.pdf");
  });

  it("falls back to collection for a name with nothing urlizable", () => {
    expect(collectionPdfFileName("!!!")).toBe("collection.pdf");
  });

  it("falls back to collection for an empty name", () => {
    expect(collectionPdfFileName("")).toBe("collection.pdf");
  });
});
