/**
 * PROTOTYPE — prefetch one photo and convert it to a print-sized JPEG Blob.
 *
 * Throwaway code on `prototype/pdf-export` (#129). React-PDF decodes only
 * JPEG/PNG/SVG and silently drops anything it cannot read, so the app has to
 * own this step: fetch the bytes (same-origin, so the grant cookie rides
 * along), decode, downscale to the printed box, flatten onto white, and hand
 * the renderer a `Blob`.
 *
 * `source` is either the already-oriented `xlarge` WebP or the original
 * upload. `createImageBitmap` applies EXIF orientation by default in current
 * browsers, so an original with orientation 6 arrives upright; the prototype
 * uses that to compare the two sources rather than trusting either blindly.
 */

export interface PixelBox {
  width: number;
  height: number;
}

/** The scaled size for a source inside the printed box; never enlarges. */
export function fitInsideBox(
  source: { width: number; height: number },
  box: PixelBox,
): PixelBox {
  const scale = Math.min(
    1,
    box.width / source.width,
    box.height / source.height,
  );
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

export class PhotoUnavailableError extends Error {
  constructor(
    /** The HTTP status, or 0 when the fetch itself failed. */
    public readonly status: number,
    public readonly url: string,
  ) {
    super(
      status === 0
        ? "The photo request failed"
        : `The photo request answered ${status}`,
    );
    this.name = "PhotoUnavailableError";
  }
}

export class ExportAbortedError extends Error {
  constructor() {
    super("The export was cancelled");
    this.name = "ExportAbortedError";
  }
}

export interface ConvertedPhoto {
  blob: Blob;
  /** The JPEG's pixel size, after the print-box fit. */
  width: number;
  height: number;
  /** The downloaded bytes, before conversion. */
  sourceBytes: number;
  sourceType: string;
  sourceWidth: number;
  sourceHeight: number;
  /** Wall time for the fetch, the bitmap decode and the JPEG encode. */
  fetchMs: number;
  decodeMs: number;
  encodeMs: number;
}

const isAbort = (signal: AbortSignal) => signal.aborted;

/** Fetch, decode, downscale, flatten to white, encode JPEG. */
export async function convertPhotoToJpeg(
  url: string,
  box: PixelBox,
  signal: AbortSignal,
  quality = 0.9,
): Promise<ConvertedPhoto> {
  if (isAbort(signal)) {
    throw new ExportAbortedError();
  }

  const fetchStarted = performance.now();
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", signal });
  } catch {
    if (signal.aborted) {
      throw new ExportAbortedError();
    }
    throw new PhotoUnavailableError(0, url);
  }
  if (!res.ok) {
    throw new PhotoUnavailableError(res.status, url);
  }

  const source = await res.blob();
  const fetchMs = performance.now() - fetchStarted;
  if (isAbort(signal)) {
    throw new ExportAbortedError();
  }

  const decodeStarted = performance.now();
  let bitmap: ImageBitmap;
  try {
    // `imageOrientation: "from-image"` is the spec default; naming it makes
    // the EXIF comparison explicit rather than accidental.
    bitmap = await createImageBitmap(source, {
      imageOrientation: "from-image",
    });
  } catch {
    throw new PhotoUnavailableError(0, url);
  }
  const decodeMs = performance.now() - decodeStarted;

  try {
    const size = fitInsideBox(
      { width: bitmap.width, height: bitmap.height },
      box,
    );
    const encodeStarted = performance.now();
    const blob = await encodeJpeg(bitmap, size, quality);
    return {
      blob,
      width: size.width,
      height: size.height,
      sourceBytes: source.size,
      sourceType: source.type,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
      fetchMs,
      decodeMs,
      encodeMs: performance.now() - encodeStarted,
    };
  } finally {
    bitmap.close();
  }
}

/** OffscreenCanvas where it exists, a DOM canvas as the older-Safari path. */
async function encodeJpeg(
  bitmap: ImageBitmap,
  size: PixelBox,
  quality: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("The canvas has no 2d context");
    }
    paint(ctx, bitmap, size);
    return canvas.convertToBlob({ type: "image/jpeg", quality });
  }

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("The canvas has no 2d context");
  }
  paint(ctx, bitmap, size);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("The canvas could not encode a JPEG")),
      "image/jpeg",
      quality,
    );
  });
}

function paint(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  size: PixelBox,
): void {
  // JPEG has no alpha; without the white ground a transparent source turns
  // black in the PDF.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
}
