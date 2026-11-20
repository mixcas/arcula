import { describe, expect, it } from "vitest";

import {
  artworkPdfFields,
  cataloguePdfFields,
  cataloguePdfFileName,
  cataloguePdfTexts,
  fitInsideBox,
  IMAGE_UNAVAILABLE,
  PHOTO_PRINT_BOX,
  placeInPhotoBox,
  PRINT_BOX_PX,
  printedArtworkFields,
  printedSize,
  pdfTexts,
  selectionPdfFileName,
  shouldWarnForLargeExport,
} from "@/components/pdf/cataloguePdfPreflight";
import {
  buildCataloguePdfPlan,
  type CataloguePdfPage,
} from "@/components/pdf/cataloguePdfPlan";
import {
  ARTWORK_FIELD_KEYS,
  pdfFallbackCharacters,
  resolveArtworkFields,
  type Artwork,
  type ArtworkFieldDeviations,
  type ArtworkFieldStates,
  type ArtworkPhoto,
  type Catalogue,
} from "@arcula/shared";

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
  catalogueId: "catalogue-1",
  title: "Untitled",
  artistName: "Unknown",
  photos: [],
  documents: [],
  ...overrides,
});

const catalogue = (overrides: Partial<Catalogue> = {}): Catalogue => ({
  id: "catalogue-1",
  name: "Flores Solares",
  kind: "collection",
  userId: "owner-1",
  isPublic: true,
  ...overrides,
});

/** The printed set of a plain Collection: every field on. */
const printed = () => cataloguePdfFields(catalogue());

describe("PRINT_BOX_PX", () => {
  it("is the 504 x 580 pt box at 300 dpi: 2100 x 2417 px", () => {
    // The width is exact; the height rounds up from 2416.67. Both numbers are
    // a correctness floor rather than a preference: the conversion caps here,
    // and `xxlarge`'s 3000 px exists because 2417 is past `xlarge`'s 2400.
    expect(PRINT_BOX_PX).toEqual({ width: 2100, height: 2417 });
  });
});

describe("fitInsideBox", () => {
  it("never enlarges a source smaller than the box", () => {
    expect(
      fitInsideBox({ width: 100, height: 50 }, { width: 2100, height: 2417 }),
    ).toEqual({ width: 100, height: 50 });
  });

  it("preserves the aspect ratio when the source is wider than the box", () => {
    expect(
      fitInsideBox(
        { width: 3250, height: 2000 },
        { width: 2100, height: 2417 },
      ),
    ).toEqual({ width: 2100, height: 1292 });
  });

  it("preserves the aspect ratio when the source is taller than the box", () => {
    expect(
      fitInsideBox(
        { width: 2000, height: 4326 },
        { width: 2100, height: 2417 },
      ),
    ).toEqual({ width: 1117, height: 2417 });
  });

  it("targets the box itself for a source exactly twice its size", () => {
    expect(
      fitInsideBox(
        { width: PRINT_BOX_PX.width * 2, height: PRINT_BOX_PX.height * 2 },
        PRINT_BOX_PX,
      ),
    ).toEqual({ width: 2100, height: 2417 });
  });

  it("fits the largest variant into the whole box", () => {
    // `xxlarge` of a 3:4 upload: 2250 x 3000 px. The height binds, and the
    // result is the box's height — which is what makes the largest photo page
    // fill its box rather than stopping 3 pt short.
    expect(fitInsideBox({ width: 2250, height: 3000 }, PRINT_BOX_PX)).toEqual({
      width: 1813,
      height: 2417,
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
        { width: 2100, height: 2417 },
      ),
    ).toEqual({ width: 604, height: 2417 });
  });
});

describe("printedSize", () => {
  it("converts pixels to points at 300 dpi", () => {
    // 2100 px / 300 dpi = 7 in = 504 pt.
    expect(printedSize({ width: 2100, height: 1000 })).toEqual({
      width: 504,
      height: 240,
    });
  });

  it("keeps the converted photo's own pixel size, which may exceed the box", () => {
    // 2417 px at 300 dpi is 580.08 pt; the box is the cap, not the source.
    expect(printedSize(PRINT_BOX_PX).height).toBeCloseTo(580.08, 3);
  });
});

describe("placeInPhotoBox", () => {
  it("centres a photo that is exactly the box", () => {
    expect(placeInPhotoBox({ width: 504, height: 580 })).toEqual({
      left: PHOTO_PRINT_BOX.left,
      top: PHOTO_PRINT_BOX.top,
      width: 504,
      height: 580,
    });
  });

  it("centres a landscape photo vertically without stretching it", () => {
    // 2100 x 1000 px is 504 x 240 pt: full width, 170 pt above and below.
    const placement = placeInPhotoBox({ width: 504, height: 240 });

    expect(placement.width).toBe(504);
    expect(placement.height).toBe(240);
    expect(placement.left).toBe(PHOTO_PRINT_BOX.left);
    expect(placement.top).toBeCloseTo(PHOTO_PRINT_BOX.top + 170, 3);
  });

  it("centres a small photo at its own size instead of enlarging it", () => {
    // 500 x 500 px is 120 x 120 pt, well inside the box.
    const placement = placeInPhotoBox({ width: 120, height: 120 });

    expect(placement.width).toBe(120);
    expect(placement.height).toBe(120);
    expect(placement.left).toBeCloseTo(PHOTO_PRINT_BOX.left + 192, 3);
    expect(placement.top).toBeCloseTo(PHOTO_PRINT_BOX.top + 230, 3);
  });

  it("caps a photo larger than the box instead of overflowing it", () => {
    const placement = placeInPhotoBox({ width: 504, height: 580.08 });

    expect(placement.height).toBe(580);
    expect(placement.top).toBe(PHOTO_PRINT_BOX.top);
  });
});

describe("cataloguePdfTexts", () => {
  it("collects the catalogue name, titles, metadata values and placeholder", () => {
    const texts = cataloguePdfTexts(
      "Flores Solares",
      [
        artwork({
          title: "Estudio en rojo",
          artistName: "María López",
          serie: "Rojo",
          medium: "Oil",
          dimensions: "100 × 80 cm",
          editions: "3/5",
          dateOfCreation: "2024",
          placeOfOrigin: "Madrid",
          photos: [photo("one", "IMG_1234.webp")],
        }),
      ],
      printed(),
    );

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
    const texts = cataloguePdfTexts(
      "Flores Solares",
      [artwork({ photos: [photo("one", "IMG_1234.webp")] })],
      printed(),
    );

    expect(texts).not.toContain("IMG_1234.webp");
    expect(texts.join(" ")).not.toContain("IMG_1234");
  });

  it("omits absent and blank metadata values", () => {
    const texts = cataloguePdfTexts(
      "C",
      [
        artwork({
          title: "Sparse",
          artistName: "Ana",
          serie: "   ",
          medium: "",
        }),
      ],
      printed(),
    );

    expect(texts).toEqual(["C", "Sparse", "Ana", IMAGE_UNAVAILABLE]);
  });

  it("excludes drafts and deleted works", () => {
    const texts = cataloguePdfTexts(
      "C",
      [
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
      ],
      printed(),
    );

    expect(texts).toEqual(["C", IMAGE_UNAVAILABLE]);
  });

  it("keeps document order: photo pages before the grid", () => {
    const texts = cataloguePdfTexts(
      "C",
      [
        // Sorts first by artist, but it is a grid work and comes after the
        // photo pages in the document.
        artwork({ id: "grid", title: "Alpha", artistName: "Ana" }),
        artwork({
          id: "photo",
          title: "Zulu",
          artistName: "Zoe",
          photos: [photo("one")],
        }),
      ],
      printed(),
    );

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
    const texts = cataloguePdfTexts(
      "C",
      [
        artwork({ id: "a", title: "One", artistName: "Same Artist" }),
        artwork({ id: "b", title: "Two", artistName: "Same Artist" }),
      ],
      printed(),
    );

    expect(texts.filter((text) => text === "Same Artist")).toHaveLength(1);
  });

  it("feeds a non-ASCII title and catalogue name to the fallback set", () => {
    const texts = cataloguePdfTexts(
      "收藏",
      [artwork({ title: "Été 日本", artistName: "Ana" })],
      printed(),
    );

    expect(pdfFallbackCharacters(texts)).toBe("Éé收日本藏");
  });

  it("does not feed a non-ASCII photo filename to the fallback set", () => {
    const texts = cataloguePdfTexts(
      "C",
      [
        artwork({
          title: "Plain",
          artistName: "Ana",
          photos: [photo("one", "写真.jpg")],
        }),
      ],
      printed(),
    );

    expect(pdfFallbackCharacters(texts)).not.toContain("写");
  });
});

describe("pdfTexts", () => {
  it("collects the document's own title and the works its pages print", () => {
    const works = [
      artwork({
        id: "photo",
        title: "Zulu",
        artistName: "Zoe",
        photos: [photo("one")],
      }),
      artwork({ id: "grid", title: "Alpha", artistName: "Ana" }),
    ];
    const pages = buildCataloguePdfPlan(works);

    expect(pdfTexts("Flores Solares", pages, printed())).toEqual([
      "Flores Solares",
      "Zulu",
      "Zoe",
      "Alpha",
      "Ana",
      IMAGE_UNAVAILABLE,
    ]);
  });

  it("reads the pages it is given, not a Catalogue's plan", () => {
    // A Selection's plan keeps Drafts and never sorts; feeding the document's
    // own pages is what keeps the fallback font's set and the printed title in
    // agreement with the renderer.
    const pages: CataloguePdfPage[] = [
      {
        kind: "grid",
        artworks: [artwork({ id: "draft", title: "Draft", status: "draft" })],
      },
    ];

    const texts = pdfTexts("Winter shortlist", pages, printed());

    expect(texts).toEqual([
      "Winter shortlist",
      "Draft",
      "Unknown",
      IMAGE_UNAVAILABLE,
    ]);
  });
});

/** Every togglable field off: a Catalogue that records only the fixed two. */
const everyFieldOff = (): ArtworkFieldDeviations =>
  Object.fromEntries(ARTWORK_FIELD_KEYS.map((field) => [field, false]));

describe("the fields the Catalogue records", () => {
  it("prints the fields the enabled set holds, in the design's order", () => {
    const enabled: ArtworkFieldStates = resolveArtworkFields("collection", {
      medium: false,
      editions: false,
    }).enabled;

    expect(printedArtworkFields(enabled)).toEqual({
      left: ["artistName", "serie"],
      right: ["dimensions", "dateOfCreation", "placeOfOrigin"],
    });
  });

  it("drops a disabled field's line and keeps the design's order", () => {
    const fields = cataloguePdfFields(
      catalogue({ artworkFields: { medium: false, editions: false } }),
    );

    expect(fields).toEqual({
      left: ["artistName", "serie"],
      right: ["dimensions", "dateOfCreation", "placeOfOrigin"],
    });

    const texts = cataloguePdfTexts(
      "C",
      [
        artwork({
          title: "Title",
          artistName: "Artist",
          serie: "Serie",
          medium: "Oil",
          dimensions: "100 × 80 cm",
          editions: "3/5",
          dateOfCreation: "2024",
          placeOfOrigin: "Madrid",
        }),
      ],
      fields,
    );

    // The disabled fields' values are absent; the layout's order is untouched.
    expect(texts).toEqual([
      "C",
      "Title",
      "Artist",
      "Serie",
      "100 × 80 cm",
      "2024",
      "Madrid",
      IMAGE_UNAVAILABLE,
    ]);
  });

  it("always prints Title and Artist name, even with every togglable field off", () => {
    const fields = cataloguePdfFields(
      catalogue({ artworkFields: everyFieldOff() }),
    );

    expect(fields).toEqual({ left: ["artistName"], right: [] });

    const texts = cataloguePdfTexts(
      "C",
      [
        artwork({
          title: "Still Named",
          artistName: "Still Credited",
          serie: "Hidden",
          notes: "Hidden too",
        }),
      ],
      fields,
    );

    expect(texts).toEqual([
      "C",
      "Still Named",
      "Still Credited",
      IMAGE_UNAVAILABLE,
    ]);
  });

  it("keeps the photo pages when a field is disabled", () => {
    const fields = cataloguePdfFields(
      catalogue({ artworkFields: { medium: false } }),
    );

    const texts = cataloguePdfTexts(
      "C",
      [
        artwork({
          id: "grid",
          title: "Alpha",
          artistName: "Ana",
          medium: "Oil",
        }),
        artwork({
          id: "photo",
          title: "Zulu",
          artistName: "Zoe",
          medium: "Oil",
          photos: [photo("one")],
        }),
      ],
      fields,
    );

    // The photo page still leads the document; only the disabled line is gone.
    expect(texts).toEqual([
      "C",
      "Zulu",
      "Zoe",
      "Alpha",
      "Ana",
      IMAGE_UNAVAILABLE,
    ]);
  });

  it("filters a visitor's PDF exactly as a member's, from the public read", () => {
    const works = [
      artwork({
        title: "Title",
        artistName: "Artist",
        serie: "Serie",
        medium: "Oil",
      }),
    ];
    // A member's read adds the role and the password bit; the public read is
    // the same document without them. The printed set reads neither.
    const member = catalogue({
      artworkFields: { medium: false },
      role: "owner",
      isPasswordProtected: false,
    });
    const visitor = catalogue({ artworkFields: { medium: false } });

    expect(cataloguePdfFields(visitor)).toEqual(cataloguePdfFields(member));
    expect(
      cataloguePdfTexts(visitor.name, works, cataloguePdfFields(visitor)),
    ).toEqual(
      cataloguePdfTexts(member.name, works, cataloguePdfFields(member)),
    );
    expect(
      cataloguePdfTexts(visitor.name, works, cataloguePdfFields(visitor)),
    ).not.toContain("Oil");
  });

  it("resolves a Selection's public read to the source Catalogue's printed set", () => {
    // The public Selection read carries the same Kind and deviations a
    // Catalogue's does, so both exports pass the same facts to this resolver.
    const source = catalogue({
      kind: "portfolio",
      artworkFields: { medium: false, editions: false },
    });

    expect(artworkPdfFields(source.kind, source.artworkFields)).toEqual(
      cataloguePdfFields(source),
    );
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

describe("cataloguePdfFileName", () => {
  it("urlizes the catalogue name", () => {
    expect(cataloguePdfFileName("Flores Solares")).toBe("flores-solares.pdf");
  });

  it("collapses punctuation and spacing", () => {
    expect(cataloguePdfFileName("  ¡Hola!  Arte ")).toBe("hola-arte.pdf");
  });

  it("falls back to catalogue for a fully non-ASCII name", () => {
    expect(cataloguePdfFileName("收藏")).toBe("catalogue.pdf");
  });

  it("falls back to catalogue for a name with nothing urlizable", () => {
    expect(cataloguePdfFileName("!!!")).toBe("catalogue.pdf");
  });

  it("falls back to catalogue for an empty name", () => {
    expect(cataloguePdfFileName("")).toBe("catalogue.pdf");
  });
});

describe("selectionPdfFileName", () => {
  it("urlizes the Selection's name", () => {
    expect(selectionPdfFileName("Winter Shortlist")).toBe(
      "winter-shortlist.pdf",
    );
  });

  it("falls back to selection, never to catalogue", () => {
    expect(selectionPdfFileName("收藏")).toBe("selection.pdf");
    expect(selectionPdfFileName("!!!")).toBe("selection.pdf");
    expect(selectionPdfFileName("")).toBe("selection.pdf");
  });
});
