/**
 * The Collection PDF's preflight facts.
 *
 * Everything here is a pure decision made before rendering: how a photo fits
 * the 300 dpi print box, which non-ASCII characters the fallback font must
 * cover and how those are chunked for the API, the complete set of strings the
 * document draws, the large-export warning, and the download filename. See
 * `docs/specs/pdf-export.md`.
 */

import {
  MAX_PDF_FALLBACK_CODE_POINTS,
  urlizeName,
  type Artwork,
} from "@arcula/shared";

import {
  buildCollectionPdfPlan,
  type CollectionPdfPage,
} from "./collectionPdfPlan";

/** The density the print box is measured at. */
export const PRINT_DPI = 300;

/**
 * The photo box on a photo page, in points, measured from the page's top-left.
 *
 * It is the whole rectangle the page leaves free rather than a shape chosen for
 * one orientation: the box runs the full 504 pt content column (54 → 558), from
 * just under the header to just above the metadata band. A photo is `contain`
 * fitted, so the box's aspect never crops anything — a wider box is free for
 * every work narrower than it, and it is the only box a 3:4 portrait can grow
 * into. See `docs/specs/pdf-export.md`, **Page geometry**.
 */
export const PHOTO_PRINT_BOX = {
  left: 54,
  top: 60,
  width: 504,
  height: 580,
} as const;

export interface PixelSize {
  width: number;
  height: number;
}

/**
 * 504 × 580 pt at 300 dpi.
 *
 * The width is exactly 2100 px (504 pt), but the height is 2416.67 px and
 * rounds up, so a photo converted into this box can print a hair taller than the
 * box itself; `placeInPhotoBox` caps that away. The height
 * is also what makes `xxlarge` (`apps/api/src/media/variants.ts`) necessary:
 * `xlarge`'s 2400 cap falls 17 px short of it, so the largest page would print
 * 3 pt under its box.
 */
export const PRINT_BOX_PX: PixelSize = {
  width: Math.round((PHOTO_PRINT_BOX.width * PRINT_DPI) / 72),
  height: Math.round((PHOTO_PRINT_BOX.height * PRINT_DPI) / 72),
};

/**
 * The source size fitted inside the print box, never enlarged.
 *
 * `min(1, …)` is what makes a smaller source keep its own pixels; the final
 * `max(1, …)` keeps a very thin source from rounding away to nothing.
 */
export const fitInsideBox = (source: PixelSize, box: PixelSize): PixelSize => {
  const scale = Math.min(
    1,
    box.width / source.width,
    box.height / source.height,
  );
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
};

export interface PointSize {
  width: number;
  height: number;
}

/** A photo's print size: its own pixels at 300 dpi, never scaled to the box. */
export const printedSize = (pixels: PixelSize): PointSize => ({
  width: (pixels.width * 72) / PRINT_DPI,
  height: (pixels.height * 72) / PRINT_DPI,
});

export interface PhotoPlacement extends PointSize {
  left: number;
  top: number;
}

/**
 * Where a converted photo sits on the page: its print size, centred in the
 * print box and capped at it.
 *
 * This is `contain` with no upscaling — the photo keeps its own proportions
 * and is never stretched to fill the box — and it is why a small source still
 * prints small rather than being blown up to a blurry full page.
 */
export const placeInPhotoBox = (printed: PointSize): PhotoPlacement => {
  const width = Math.min(printed.width, PHOTO_PRINT_BOX.width);
  const height = Math.min(printed.height, PHOTO_PRINT_BOX.height);
  return {
    left: PHOTO_PRINT_BOX.left + (PHOTO_PRINT_BOX.width - width) / 2,
    top: PHOTO_PRINT_BOX.top + (PHOTO_PRINT_BOX.height - height) / 2,
    width,
    height,
  };
};

/** The API accepts at most this many distinct code points per subset. */
export const FALLBACK_CHUNK_SIZE = MAX_PDF_FALLBACK_CODE_POINTS;

/**
 * The distinct non-ASCII code points in the drawn text, ascending.
 *
 * Iterating with `for…of` walks code points, so an astral character is one
 * entry rather than two surrogate halves.
 */
export const fallbackCharacters = (texts: string[]): string => {
  const codePoints = new Set<number>();
  for (const text of texts) {
    for (const character of text) {
      const codePoint = character.codePointAt(0);
      // 0x7f (DEL) is ASCII too; the brand face owns every ASCII code point.
      if (codePoint !== undefined && codePoint > 0x7f) {
        codePoints.add(codePoint);
      }
    }
  }
  return [...codePoints]
    .sort((a, b) => a - b)
    .map((codePoint) => String.fromCodePoint(codePoint))
    .join("");
};

/** Split a character string by code point into chunks of at most 512. */
export const fallbackChunks = (characters: string): string[] => {
  const codePoints = Array.from(characters);
  const chunks: string[] = [];
  for (let index = 0; index < codePoints.length; index += FALLBACK_CHUNK_SIZE) {
    chunks.push(codePoints.slice(index, index + FALLBACK_CHUNK_SIZE).join(""));
  }
  return chunks;
};

/** The copy a failed photo page draws instead of the image. */
export const IMAGE_UNAVAILABLE = "Image unavailable";

/** The metadata fields the document prints, in the design's order. */
export const ARTWORK_LEFT_FIELDS = ["artistName", "serie", "media"] as const;

export const ARTWORK_RIGHT_FIELDS = [
  "dimensions",
  "editions",
  "dateOfCreation",
  "placeOfOrigin",
] as const;

const METADATA_FIELDS = [
  ...ARTWORK_LEFT_FIELDS,
  ...ARTWORK_RIGHT_FIELDS,
] as const satisfies ReadonlyArray<keyof Artwork>;

const valuesFor = (artwork: Artwork): string[] => {
  const values = [artwork.title];
  for (const field of METADATA_FIELDS) {
    const value = artwork[field]?.trim();
    if (value) {
      values.push(value);
    }
  }
  return values;
};

const artworksOnPage = (page: CollectionPdfPage): Artwork[] => {
  if (page.kind === "photo") return [page.artwork];
  if (page.kind === "grid") return page.artworks;
  return [];
};

/**
 * Every distinct string the document draws, in document order.
 *
 * The plan is the source, so only exportable works contribute and the order is
 * the reading order rather than the stored array's. Photo filenames are not
 * drawn and are deliberately absent.
 */
export function collectionPdfTexts(
  collectionName: string,
  artworks: Artwork[],
): string[] {
  const texts = new Set<string>();

  if (collectionName !== "") {
    texts.add(collectionName);
  }

  for (const page of buildCollectionPdfPlan(artworks)) {
    for (const artwork of artworksOnPage(page)) {
      for (const value of valuesFor(artwork)) {
        if (value !== "") {
          texts.add(value);
        }
      }
    }
  }

  texts.add(IMAGE_UNAVAILABLE);
  return [...texts];
}

/**
 * Whether an export is large enough to ask before starting.
 *
 * Photo pages are what cost memory, so the count is the plan's, not the
 * collection's artwork count. On a phone the memory API is absent, which is
 * why the mobile layout is a clause of its own.
 */
export const shouldWarnForLargeExport = (
  photoPages: number,
  deviceMemory: number | undefined,
  isMobileLayout: boolean,
): boolean => {
  if (photoPages >= 30) {
    return true;
  }
  return (
    photoPages >= 15 &&
    ((typeof deviceMemory === "number" && deviceMemory <= 4) || isMobileLayout)
  );
};

/** The downloaded filename: the urlized name, `collection` when nothing is. */
export const collectionPdfFileName = (name: string): string =>
  `${urlizeName(name) || "collection"}.pdf`;
