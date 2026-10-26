/**
 * The Collection PDF's photo pipeline.
 *
 * React-PDF decodes JPEG, PNG and SVG and **silently drops** a WebP, a 404 or a
 * 403: `toBlob()` still resolves with a missing photo and only a `console.warn`
 * to show for it. The app therefore owns the image bytes: every scheduled photo
 * is fetched, oriented, fitted to the print box and re-encoded as a JPEG before
 * the document is rendered.
 *
 * Two decisions are the reason this module exists rather than a loop in the
 * document:
 *
 * - **At most four conversions in flight.** Each one holds a decoded bitmap of
 *   up to 1625 × 2163 px, so the cap is what keeps a long collection from
 *   allocating a working set the browser cannot hold.
 * - **A refused photo is not a placeholder until access is re-checked.** The
 *   media proxy answers an expired grant with `404`, so a 403/404 asks the
 *   Collection again (`collectionPdfAccess.ts`) and a lost grant re-locks
 *   instead of printing a document of empty boxes.
 *
 * The failure of one photo is never the failure of the export: it keeps its
 * page, draws the placeholder, and the page count is unchanged.
 *
 * Both seams below take their browser side as a parameter — `PhotoConversionEnv`
 * for the one conversion, `convert` for the scheduler — so the decisions can be
 * tested without a decoder or a canvas.
 */

import { photoUrl, type ArtworkPhoto } from "@arcula/shared";

import {
  CollectionPdfAccessError,
  type AccessOutcome,
} from "./collectionPdfAccess";
import {
  fitInsideBox,
  PRINT_BOX_PX,
  type PixelSize,
} from "./collectionPdfPreflight";
import type { CollectionPdfPage } from "./collectionPdfPlan";

/** How many photos may be fetched and encoded at the same time. */
export const PHOTO_CONCURRENCY = 4;

/** The JPEG the document embeds. */
const JPEG_TYPE = "image/jpeg";
const JPEG_QUALITY = 0.9;
/** JPEG has no alpha; a transparent source would otherwise print black. */
const WHITE = "#ffffff";

/**
 * The photo's object: the `xlarge` variant, with the `original` as the ladder's
 * only fallback. The original is never embedded directly — it may be WebP, may
 * carry EXIF orientation and can be arbitrarily large — but a photo whose
 * variant is missing still has something to print.
 */
export const scheduledPhotoUrl = (photo: ArtworkPhoto | null): string | null =>
  // An empty string is a record with no object behind it, which is the same
  // situation as no record at all: both print the placeholder.
  photoUrl(photo, "xlarge") || null;

/**
 * The distinct photos the plan schedules, in document order.
 *
 * One entry per photo, not per page: the plan already caps a work at three
 * photos.
 */
export const scheduledPhotos = (pages: CollectionPdfPage[]): ArtworkPhoto[] => {
  const seen = new Set<string>();
  const photos: ArtworkPhoto[] = [];
  for (const page of pages) {
    if (page.kind !== "photo" || seen.has(page.photo.id)) {
      continue;
    }
    seen.add(page.photo.id);
    photos.push(page.photo);
  }
  return photos;
};

/** The name a cancelled run rejects with, whichever layer did the cancelling. */
const ABORTED = "AbortError";

/**
 * A cancelled run — a cancel, an unmount, a superseded export — rather than a
 * failure. It is a plain `Error` named `AbortError`, so the same check covers
 * this and the `DOMException` `fetch` itself throws when a request aborts.
 */
export const isAbortError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { name?: unknown }).name === ABORTED;

const abortError = (): Error =>
  Object.assign(new Error("the export was cancelled"), { name: ABORTED });

/** Stop between phases, where there is no request in flight to abort. */
export const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw abortError();
  }
};

/** A refused media object whose refusal may mean the access is gone. */
export class MediaRefusal extends Error {
  constructor(status: number) {
    super(`the media object was refused with ${status}`);
    this.name = "MediaRefusal";
  }
}

/** One photo's converted JPEG and the pixel box it was fitted into. */
export interface ConvertedPhoto {
  blob: Blob;
  pixels: PixelSize;
}

/** The browser as one conversion uses it. */
export interface PhotoBitmap {
  width: number;
  height: number;
  close(): void;
}

/** The drawing surface: white ground, one draw, one JPEG. */
export interface PhotoSurface {
  fill(color: string): void;
  draw(image: PhotoBitmap): void;
  encode(type: string, quality: number): Promise<Blob>;
}

export interface PhotoConversionEnv {
  fetch(input: string, init: RequestInit): Promise<Response>;
  decode(blob: Blob): Promise<PhotoBitmap>;
  surface(width: number, height: number): PhotoSurface;
}

/** The conversion the scheduler calls. Injectable so its decisions are testable. */
export type PhotoConverter = (
  photo: ArtworkPhoto,
  signal?: AbortSignal,
) => Promise<ConvertedPhoto>;

type PaintContext =
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** What every surface does the same way: the white ground and the draw. */
const painter = (
  context: PaintContext,
  width: number,
  height: number,
): Pick<PhotoSurface, "fill" | "draw"> => ({
  fill: (color) => {
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
  },
  draw: (image) => context.drawImage(image, 0, 0, width, height),
});

/**
 * The browser's own 2D canvas, whichever one this runtime has.
 *
 * `OffscreenCanvas` keeps the work off the document and is what every current
 * browser has; the DOM canvas is the fallback for the ones that do not. A
 * surface that cannot be built is a failed photo, not a failed export.
 */
const browserSurface = (width: number, height: number): PhotoSurface => {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("the offscreen canvas has no 2d context");
    }
    return {
      ...painter(context, width, height),
      encode: (type, quality) => canvas.convertToBlob({ type, quality }),
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("the canvas has no 2d context");
  }
  return {
    ...painter(context, width, height),
    encode: (type, quality) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("the canvas could not encode the photo"));
            }
          },
          type,
          quality,
        );
      }),
  };
};

export const browserPhotoEnv: PhotoConversionEnv = {
  fetch: (input, init) => fetch(input, init),
  // The variant is written already oriented, but the ladder's fallback is the
  // original, which carries the uploader's EXIF orientation. Decoding "from
  // image" applies it, so a portrait phone photo is fitted as a portrait.
  decode: (blob) => createImageBitmap(blob, { imageOrientation: "from-image" }),
  surface: browserSurface,
};

/**
 * One photo: fetch, decode, fit, ground, draw, encode.
 *
 * A refusal of the object itself (403, 404) is a `MediaRefusal`, which the
 * scheduler turns into an access question; everything else — no object at all,
 * a dropped connection, a decode failure, an encoder failure — is just a failed
 * photo, and a failed photo is a placeholder. The bitmap is released as soon as
 * the JPEG exists, on every path.
 */
export async function convertPhoto(
  photo: ArtworkPhoto,
  signal?: AbortSignal,
  env: PhotoConversionEnv = browserPhotoEnv,
): Promise<ConvertedPhoto> {
  const url = scheduledPhotoUrl(photo);
  if (!url) {
    // The ladder's end: no object to fetch and no second variant to try. No
    // read refused anything, so there is nothing to ask the Collection about.
    throw new Error("the photo has no object to fetch");
  }

  const response = await env.fetch(url, {
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    if (response.status === 403 || response.status === 404) {
      throw new MediaRefusal(response.status);
    }
    throw new Error(`the photo answered ${response.status}`);
  }

  const bitmap = await env.decode(await response.blob());
  try {
    // The print box is the hard upper bound; a smaller source keeps its own
    // pixels rather than being blown up to fill it.
    const pixels = fitInsideBox(
      { width: bitmap.width, height: bitmap.height },
      PRINT_BOX_PX,
    );
    const surface = env.surface(pixels.width, pixels.height);
    surface.fill(WHITE);
    surface.draw(bitmap);
    const blob = await surface.encode(JPEG_TYPE, JPEG_QUALITY);
    return { blob, pixels };
  } finally {
    bitmap.close();
  }
}

export interface PreparePhotosOptions {
  /** Aborted by a cancel, an unmount or a superseded export. */
  signal?: AbortSignal;
  /**
   * Asked after a refusal, to tell a missing object from lost access. Refusals
   * that arrive while a re-read is in flight share its answer; the next one to
   * arrive afterwards asks again, because access can die at any point in a long
   * export.
   */
  recheckAccess?: () => Promise<AccessOutcome>;
  /** The conversion itself. Defaults to the browser pipeline. */
  convert?: PhotoConverter;
  /**
   * Called with `0 of total` before the first conversion and again after every
   * photo settles, whether it became a JPEG or a placeholder. `total` is the
   * number of distinct scheduled photos, so a no-photo export never reports
   * `0 of 0`.
   */
  onProgress?: (done: number, total: number) => void;
}

/** The converted photos by photo id. A photo with no entry is a placeholder. */
export type PhotoResults = Map<string, ConvertedPhoto>;

/**
 * Convert every scheduled photo, four at a time, and answer what each page
 * prints.
 *
 * A failed photo is simply absent from the answer, which is what the document
 * draws as a placeholder, and the run continues. A lost access throws
 * `CollectionPdfAccessError` and the run stops, because a document of
 * placeholders for a collection the reader can no longer see is worse than no
 * document at all. An aborted run throws `AbortError` and answers nothing.
 */
export async function preparePhotos(
  photos: ArtworkPhoto[],
  options: PreparePhotosOptions = {},
): Promise<PhotoResults> {
  const { signal, recheckAccess, convert = convertPhoto, onProgress } = options;

  const results: PhotoResults = new Map();
  let next = 0;
  let done = 0;
  // A holder rather than a `let`: the workers assign it after the compiler's
  // control-flow analysis has already looked at it.
  const lost: { error: CollectionPdfAccessError | null } = { error: null };

  if (photos.length > 0) {
    onProgress?.(0, photos.length);
  }

  const settled = (): void => {
    done += 1;
    onProgress?.(done, photos.length);
  };

  let access: Promise<AccessOutcome> | null = null;
  const refusalOutcome = (): Promise<AccessOutcome> => {
    if (!recheckAccess) {
      return Promise.resolve<AccessOutcome>({ status: "continue" });
    }
    // Shared while it is pending, forgotten once it answers: one question for
    // a wave of refusals, a fresh one for the next.
    access ??= recheckAccess().finally(() => {
      access = null;
    });
    return access;
  };

  const worker = async (): Promise<void> => {
    while (!lost.error && !signal?.aborted && next < photos.length) {
      const photo = photos[next];
      next += 1;

      try {
        results.set(photo.id, await convert(photo, signal));
      } catch (error) {
        // A cancel is not a failed photo: it drops its work and says nothing.
        if (signal?.aborted) {
          return;
        }
        if (error instanceof MediaRefusal) {
          const outcome = await refusalOutcome();
          if (signal?.aborted) {
            return;
          }
          if (outcome.status !== "continue") {
            lost.error ??= new CollectionPdfAccessError(outcome);
            return;
          }
        }
      }

      // A failed photo is still settled: it keeps its page and draws the
      // placeholder. The count is photos finished, not photos that loaded.
      settled();
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(PHOTO_CONCURRENCY, photos.length) }, worker),
  );

  if (signal?.aborted) {
    results.clear();
    throw abortError();
  }
  if (lost.error) {
    results.clear();
    throw lost.error;
  }
  return results;
}
