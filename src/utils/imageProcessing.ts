/**
 * Orchestrates image processing: a Web Worker where one is available, the main
 * thread where it is not.
 *
 * The worker is the expected path in every browser this app supports. The
 * fallback exists so an environment without `Worker`/`OffscreenCanvas` fails
 * slowly and legibly on the main thread rather than being an outright
 * unsupported platform.
 */

import { IMAGE_VARIANTS } from "./imageVariants";
import {
  EXTENSION_BY_TYPE,
  decodeImage,
  releaseImage,
  renderVariants,
  supportsWebpEncoding,
  type GeneratedVariant,
} from "./imageRender";
import type { ImageVariantSpec } from "./imageVariants";
import type {
  BatchItem,
  BatchResponse,
  ImageWorkerPayload,
  ImageWorkerRequest,
  ImageWorkerResponse,
} from "./imageWorker";

export type { GeneratedVariant } from "./imageRender";

/** Everything the form needs to know about one processed image. */
export interface ProcessedImage {
  /** The file as the user chose it — stored as the photo's `original`. */
  file: File;
  /** Generated variants; empty only if the source was already exact-sized. */
  variants: GeneratedVariant[];
  /** Source pixel dimensions, after EXIF rotation. */
  width: number;
  height: number;
  /**
   * Whether the variants were written as WebP.
   *
   * Per-image rather than a module-level constant so the form can state the
   * format it will actually store. A browser that cannot encode WebP gets
   * JPEG, correctly and silently — which is fine right up until someone opens
   * the Storage console months later and finds nothing but `.jpg`.
   */
  webp: boolean;
}

/**
 * The file extension for a generated variant, from the blob's own content type.
 *
 * Read back off the blob rather than from the requested type, because a browser
 * that cannot encode the requested format substitutes a different one instead
 * of failing — see `probeWebpEncoding`. Trusting the request is exactly how a
 * PNG ends up stored under a `.webp` name.
 */
export const extensionFor = (contentType: string): string =>
  EXTENSION_BY_TYPE[contentType] ?? "bin";

const workerAvailable = (): boolean =>
  typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";

interface Pending {
  resolve: (response: BatchResponse) => void;
  reject: (reason: Error) => void;
  onProgress?: (done: number, total: number) => void;
  /** Set for a probe request, which resolves a boolean instead. */
  probe?: (value: boolean) => void;
}

let worker: Worker | null = null;
const pending = new Map<number, Pending>();
let nextRequestId = 0;

const handleMessage = (event: MessageEvent<ImageWorkerResponse>): void => {
  const message = event.data;
  const entry = pending.get(message.id);
  if (!entry) {
    return;
  }

  if (message.kind === "progress") {
    entry.onProgress?.(message.done, message.total);
    return;
  }
  pending.delete(message.id);

  switch (message.kind) {
    case "result":
      entry.resolve({ items: message.items, webp: message.webp });
      break;
    case "probeResult":
      entry.probe?.(message.webp);
      break;
    case "error":
      entry.reject(new Error(message.message));
      break;
  }
};

const getWorker = (): Worker => {
  if (worker) {
    return worker;
  }
  // Vite resolves this to the built worker bundle. `type: "module"` because the
  // worker imports the shared rendering module.
  worker = new Worker(new URL("./imageWorker.ts", import.meta.url), {
    type: "module",
  });
  worker.addEventListener("message", handleMessage);
  worker.addEventListener("error", (event) => {
    // A worker-level error carries no request id, so every in-flight call is
    // failed rather than left hanging on a promise that will never settle.
    const failure = new Error(event.message || "Image processing failed.");
    for (const [, entry] of pending) {
      entry.reject(failure);
    }
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
};

const post = (
  message: ImageWorkerPayload,
  onProgress?: (done: number, total: number) => void,
  probe?: (value: boolean) => void,
): Promise<BatchResponse> =>
  new Promise((resolve, reject) => {
    const id = nextRequestId++;
    pending.set(id, { resolve, reject, onProgress, probe });
    const request: ImageWorkerRequest = { ...message, id };
    getWorker().postMessage(request);
  });

/** Whether variants will be WebP. Probed once and cached for the page's life. */
let webpSupport: Promise<boolean> | null = null;

/**
 * Ask for the WebP answer without processing anything.
 *
 * Only the main-thread fallback needs this: the worker path learns the format
 * from the batch response itself. It is kept because the fallback has to probe
 * too, and because it is the one place the answer can be had before any image
 * is touched.
 */
const resolveWebpSupport = (): Promise<boolean> => {
  if (!workerAvailable()) {
    return supportsWebpEncoding().catch(() => false);
  }
  webpSupport ??= new Promise<boolean>((resolve) => {
    const id = nextRequestId++;
    pending.set(id, {
      // A probe carries no image, so the response it resolves to is empty; the
      // boolean arrives through the dedicated `probe` callback.
      resolve: () => ({ items: [], webp: false }),
      // A worker that cannot answer is not a WebP worker. JPEG is the safe
      // answer, so a failed probe costs quality rather than failing uploads.
      reject: () => resolve(false),
      probe: (value) => resolve(value),
    });
    getWorker().postMessage({
      id,
      kind: "probe",
    } satisfies ImageWorkerRequest);
  });
  return webpSupport;
};

/**
 * The format variants will be written in, for the form to display.
 *
 * Falls back to the main-thread probe. It is a *second* encode on a page that
 * is about to encode several more, and it is only ever called to answer a
 * question for the user — the bytes that get uploaded take their format from
 * the worker, not from here.
 */
export const variantFormatIsWebp = (): Promise<boolean> => resolveWebpSupport();

/** Fallback path: decode and render on the main thread. */
const processOnMainThread = async (
  files: File[],
  specs: readonly ImageVariantSpec[],
  onProgress?: (done: number, total: number) => void,
): Promise<ProcessedImage[]> => {
  const webp = await resolveWebpSupport();
  const results: ProcessedImage[] = [];

  for (const [index, file] of files.entries()) {
    const source = await decodeImage(file);
    try {
      results.push({
        file,
        variants: await renderVariants(source, webp, specs),
        width: source.width,
        height: source.height,
        webp,
      });
    } finally {
      releaseImage(source);
    }
    onProgress?.(index + 1, files.length);
  }
  return results;
};

/**
 * Decode, resize and encode a set of images into their variants.
 *
 * Results come back in the input order, and progress is reported per file —
 * the granularity a user can actually see, since one file's four variants
 * encode in well under a second while ten files do not.
 */
export const processImages = async (
  files: File[],
  onProgress?: (done: number, total: number) => void,
  specs: readonly ImageVariantSpec[] = IMAGE_VARIANTS,
): Promise<ProcessedImage[]> => {
  if (files.length === 0) {
    return [];
  }

  if (!workerAvailable()) {
    return processOnMainThread(files, specs, onProgress);
  }

  const items: BatchItem[] = files.map((file) => ({
    blob: file,
    specs: [...specs],
  }));
  const { items: processed, webp } = await post(
    { kind: "batch", items },
    onProgress,
  );

  return files.map((file, index) => {
    const entry = processed[index];
    if (!entry) {
      throw new Error("Image processing failed.");
    }
    return {
      file,
      variants: entry.variants,
      width: entry.width,
      height: entry.height,
      // Straight from the worker rather than re-probed here: the probe already
      // ran over there, and a second opinion from a different canvas could
      // disagree with the one that actually produced these bytes.
      webp,
    };
  });
};

/** Tear the worker down. Called when the form unmounts with nothing in flight. */
export const disposeImageProcessor = (): void => {
  worker?.terminate();
  worker = null;
  pending.clear();
  webpSupport = null;
};
