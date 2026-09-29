/**
 * Canvas drawing and encoding, with no worker and no React.
 *
 * Split from `imageProcessing.ts` so the Web Worker shell and the main-thread
 * fallback can both use it without an import cycle: the orchestrator spawns the
 * worker, and the worker imports this.
 *
 * Everything here is browser-only. The arithmetic lives in `imageVariants.ts`
 * precisely so that the part worth testing exhaustively runs in plain node,
 * where there is no canvas to be had.
 */

import {
  IMAGE_VARIANTS,
  coverCrop,
  variantSize,
  type ImageVariantSpec,
} from "./imageVariants";
import type { ImageVariantKey } from "@/types";

/**
 * Encoder settings.
 *
 * 0.95 is a deliberate quality choice rather than a size one. Artwork is
 * unforgiving of ringing and mush around fine brushwork, and WebP at 95 is
 * visually near-lossless while still being far smaller than a PNG. The JPEG
 * fallback uses the same figure for the same reason — a browser that cannot
 * encode WebP should not silently get a worse picture as well.
 */
export const WEBP_QUALITY = 0.95;
export const JPEG_QUALITY = 0.95;

/** Output formats, in preference order. */
export const WEBP_TYPE = "image/webp";
export const JPEG_TYPE = "image/jpeg";

/**
 * File extension per format. The object name carries it; the URL does not.
 *
 * PNG is here for the *original* upload, not for the variants — a canvas
 * re-encode never produces one, since every generated variant is lossy WebP or
 * JPEG. A PNG source is stored as the PNG it is rather than being renamed, so
 * it can keep its alpha channel in the archive. This list is the one
 * `storage.rules` matches the object name against, so the two must agree.
 */
export const EXTENSION_BY_TYPE: Record<string, string> = {
  [WEBP_TYPE]: "webp",
  [JPEG_TYPE]: "jpg",
  "image/png": "png",
};

/** A rendered, not-yet-uploaded variant. */
export interface GeneratedVariant {
  key: ImageVariantKey;
  blob: Blob;
  width: number;
  height: number;
  contentType: string;
}

// A canvas is either an OffscreenCanvas (worker) or an HTMLCanvasElement
// (main-thread fallback). Both satisfy what is used here.
type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type AnyContext2D =
  OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** Anything `drawImage` accepts as a source. */
type Drawable = ImageBitmap | HTMLImageElement;

/** The minimal encoder surface the WebP probe needs. Injectable for tests. */
export type ProbeEncoder = (
  type: string,
  quality: number,
) => Promise<Blob | null>;

/**
 * The probe's canvas size.
 *
 * Small enough to be free, large enough to be a real encode. See
 * `probeWithCanvas` for why 1x1 is not. Exported so the size is assertable:
 * everything else about the probe can be tested through an injected canvas,
 * but the size comes from the real factory and is otherwise unobservable
 * without a browser.
 */
export const PROBE_SIZE = 8;

/**
 * Whether this browser can really ENCODE WebP through a canvas.
 *
 * This is not defensive padding — it is the only thing standing between the
 * app and a broken upload. Safari has no WebP canvas encoder, and the HTML
 * spec's response to an unsupported `type` in `toBlob` is not an error: the
 * browser silently substitutes `image/png`. No throw, no null, no warning. So
 * asking for WebP and trusting the request would name a PNG `photo.webp` in
 * Storage and serve it as an image that does not match its own extension.
 *
 * The only reliable signal is to encode a probe and read back what came out,
 * which is what this does. The answer is cached by the caller, since it cannot
 * change for the life of the page.
 */
export const probeWebpEncoding = async (
  encode: ProbeEncoder,
): Promise<boolean> => {
  try {
    const blob = await encode(WEBP_TYPE, WEBP_QUALITY);
    return blob !== null && blob.type === WEBP_TYPE;
  } catch {
    // A canvas that refuses to encode at all is not a WebP canvas. Note the
    // consequence: this conflates "threw" with "substituted", so a probe that
    // fails for an unrelated reason silently downgrades every variant to JPEG.
    // `probeWithCanvas` is kept simple enough that there is little left to
    // throw, and the chosen format is surfaced in the form so a downgrade is
    // visible rather than something to discover in the Storage console.
    return false;
  }
};

/**
 * Create a canvas of the given size, preferring OffscreenCanvas.
 *
 * `new OffscreenCanvas(w, h)` does not allocate a backing store eagerly; the
 * work happens when a context is requested or the canvas is encoded. That is
 * what makes the small probe canvas below free.
 */
const createCanvas = (width: number, height: number): AnyCanvas | null => {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
};

/** Encode a canvas, normalising the two very different canvas APIs. */
export const encodeCanvas = (
  canvas: AnyCanvas,
  type: string,
  quality: number,
): Promise<Blob | null> => {
  if ("convertToBlob" in canvas) {
    // Both APIs take `quality` in 0..1, so nothing needs converting between
    // them. Neither rejects an unsupported `type`: the HTML spec has the
    // browser substitute `image/png` and return that instead, silently. So
    // every caller must read the type back off the blob it gets — which is
    // what `probeWebpEncoding` exists to do.
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
};

/**
 * The 2D context of a canvas, or null.
 *
 * The string is the filter: `getContext("2d")` only ever hands back a 2D
 * context, and the null case is what a browser without canvas support (or a
 * jsdom test) gives instead.
 */
const context2d = (canvas: AnyCanvas): AnyContext2D | null =>
  canvas.getContext("2d");

/** Creates the canvas the probe encodes, or null where canvas is unavailable. */
export type ProbeCanvasFactory = () => AnyCanvas | null;

/** The real factory. */
const realProbeCanvas: ProbeCanvasFactory = () =>
  createCanvas(PROBE_SIZE, PROBE_SIZE);

/**
 * The WebP probe bound to a real canvas.
 *
 * The factory is a parameter so the *probe's own* behaviour can be asserted.
 * Everything else in the probe is already injected — `probeWebpEncoding` takes
 * the encoder — which left the one part that had actually been wrong untested:
 * what the probe drew, how big it was, and whether it drew anything at all.
 */
export const probeWithCanvas = (
  factory: ProbeCanvasFactory = realProbeCanvas,
): ProbeEncoder => {
  return (type, quality) => {
    const canvas = factory();
    if (!canvas) {
      return Promise.resolve(null);
    }
    // Paint before encoding, and never probe a 1x1 canvas.
    //
    // A canvas that has never been drawn to is a *placeholder* canvas, and a
    // 1x1 one is the smallest degenerate case there is — too small for an
    // encoder to be exercised the way an 800x800 thumbnail will exercise it.
    // Asking it to encode one asks about the edge case rather than the encoder,
    // and it fails silently: the probe reports "no WebP", every variant is
    // written as `.jpg`, and the app looks like it simply chose JPEG. An 8x8
    // with a real fill still costs nothing to encode and is the thing actually
    // being asked about.
    const context = context2d(canvas);
    if (!context) {
      return Promise.resolve(null);
    }
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return encodeCanvas(canvas, type, quality);
  };
};

/**
 * Decode a file to a drawable, honouring EXIF orientation.
 *
 * `imageOrientation: "from-image"` is the whole point: phone photos carry a
 * rotation tag rather than rotated pixels, and without it a portrait scan
 * uploads sideways and every generated variant inherits the mistake
 * permanently. It is applied at decode so all four variants, and the recorded
 * width/height, agree with what the camera actually saw.
 *
 * Falls back to an `HTMLImageElement` where `createImageBitmap` is missing.
 * That path cannot apply EXIF rotation itself, so a rotated file on such a
 * browser stays sideways — noted rather than worked around, because the
 * browsers that lack `createImageBitmap` are not the ones serving this app.
 */
export const decodeImage = async (file: Blob): Promise<Drawable> => {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }
  if (typeof Image === "undefined") {
    throw new Error("This browser cannot decode images.");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    // The blob is already decoded into the image by this point.
    URL.revokeObjectURL(url);
  }
};

/** The pixel size of an already-decoded image. */
export const drawableSize = (
  source: Drawable,
): { width: number; height: number } => ({
  width: source.width,
  height: source.height,
});

/**
 * Render one variant.
 *
 * JPEG has no alpha channel, so a transparent source encodes to a black square
 * on some encoders. Painting the canvas white first costs one rect and removes
 * the whole class of problem. WebP keeps its alpha, so it skips this.
 */
const renderVariant = async (
  source: Drawable,
  sourceSize: { width: number; height: number },
  spec: ImageVariantSpec,
  contentType: string,
): Promise<GeneratedVariant | null> => {
  const target = variantSize(spec, sourceSize);

  if (
    target.width === sourceSize.width &&
    target.height === sourceSize.height
  ) {
    // Nothing to do: the source is already exactly the target size. Re-encoding
    // would burn CPU to produce a byte-different file of the same dimensions.
    return null;
  }

  const canvas = createCanvas(target.width, target.height);
  if (!canvas) {
    throw new Error("This browser cannot render images.");
  }
  const context = context2d(canvas);
  if (!context) {
    throw new Error("This browser cannot render images.");
  }

  // Ask for the better downscaler. Without it the browser picks, and the
  // default is bilinear — which throws away exactly the fine detail a
  // painting is made of when a 12-megapixel source is halved for `medium`.
  // The property exists on both context types, so this is the one place it
  // has to be set for the worker and the fallback alike.
  context.imageSmoothingQuality = "high";

  if (contentType === JPEG_TYPE) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, target.width, target.height);
  }

  if (spec.fit === "cover") {
    // Take a centred window of the source and stretch it to the box. The box is
    // square by construction, so the aspect distortion is the crop's, not the
    // resize's.
    const crop = coverCrop(
      { width: target.width, height: target.height },
      sourceSize,
    );
    context.drawImage(
      source,
      crop.sx,
      crop.sy,
      crop.sWidth,
      crop.sHeight,
      0,
      0,
      target.width,
      target.height,
    );
  } else {
    context.drawImage(source, 0, 0, target.width, target.height);
  }

  // The quality that goes with the format, not whichever constant is nearest.
  // They are equal today; passing WEBP_QUALITY unconditionally meant JPEG_QUALITY
  // was dead code that looked load-bearing.
  const quality = contentType === WEBP_TYPE ? WEBP_QUALITY : JPEG_QUALITY;
  const blob = await encodeCanvas(canvas, contentType, quality);
  if (!blob) {
    throw new Error("The image could not be encoded.");
  }

  return {
    key: spec.key,
    blob,
    width: target.width,
    height: target.height,
    contentType: blob.type || contentType,
  };
};

/**
 * Render every variant of one decoded image.
 *
 * `webpSupported` comes from `probeWebpEncoding` and is passed in rather than
 * re-probed here, so the cost is paid once per page and not once per image.
 */
export const renderVariants = async (
  source: Drawable,
  webpSupported: boolean,
  specs: readonly ImageVariantSpec[] = IMAGE_VARIANTS,
): Promise<GeneratedVariant[]> => {
  const contentType = webpSupported ? WEBP_TYPE : JPEG_TYPE;
  const sourceSize = drawableSize(source);
  const rendered: GeneratedVariant[] = [];

  for (const spec of specs) {
    const variant = await renderVariant(source, sourceSize, spec, contentType);
    if (variant) {
      rendered.push(variant);
    }
  }
  return rendered;
};

/** Close a decoded image if it holds resources. */
export const releaseImage = (source: Drawable): void => {
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    source.close();
  }
};

/** Run the WebP probe against a real canvas. */
export const supportsWebpEncoding = (): Promise<boolean> =>
  probeWebpEncoding(probeWithCanvas());
