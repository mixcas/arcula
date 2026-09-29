/// <reference lib="webworker" />

/**
 * The image-processing Web Worker.
 *
 * Generating four variants for ten 12-megapixel photos is a few seconds of
 * solid CPU. On the main thread that is several seconds of frozen form — no
 * scroll, no drag, no repaint, and no way for the user to tell whether the
 * page has crashed. So the work happens here, off the main thread, and the
 * form stays responsive throughout.
 *
 * The heavy lifting is in `imageRender.ts`; this file is only the message
 * plumbing, which is exactly why that split exists.
 */

import {
  decodeImage,
  releaseImage,
  renderVariants,
  supportsWebpEncoding,
  type GeneratedVariant,
} from "./imageRender";
import type { ImageVariantSpec } from "./imageVariants";

export interface BatchItem {
  blob: Blob;
  specs?: ImageVariantSpec[];
}

/**
 * One processed image.
 *
 * `width`/`height` are the SOURCE dimensions, reported separately from the
 * variants on purpose. A variant cannot stand in for them: `square_lg` is a
 * crop, and the bounded variants are clamped by the never-upscale rule, so
 * neither tells you the size the camera actually produced. The form shows these
 * next to the filename.
 */
export interface ProcessedItem {
  variants: GeneratedVariant[];
  width: number;
  height: number;
}

export type ImageWorkerPayload =
  { kind: "probe" } | { kind: "batch"; items: BatchItem[] };

/** A payload plus its correlation id. */
export type ImageWorkerRequest = ImageWorkerPayload & { id: number };

export type ImageWorkerResponse =
  | ({ id: number; kind: "result" } & BatchResponse)
  | { id: number; kind: "probeResult"; webp: boolean }
  | { id: number; kind: "progress"; done: number; total: number }
  | { id: number; kind: "error"; message: string };

export interface BatchResponse {
  items: ProcessedItem[];
  /**
   * The format the variants were actually written in.
   *
   * Reported back rather than left for the page to re-derive, because in the
   * worker path the page has no way to know: the probe runs in here and never
   * touches the main thread. Without it the chosen format is invisible until
   * someone opens the Storage console and notices every object is `.jpg`.
   */
  webp: boolean;
}

const post = (message: ImageWorkerResponse): void => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
};

const run = async (request: ImageWorkerRequest): Promise<void> => {
  if (request.kind === "probe") {
    post({
      id: request.id,
      kind: "probeResult",
      webp: await supportsWebpEncoding(),
    });
    return;
  }

  // Probed once per worker rather than once per file: the answer cannot change
  // for the life of the page, and the probe costs an encode.
  const webp = await supportsWebpEncoding();
  const results: ProcessedItem[] = [];

  for (const [index, item] of request.items.entries()) {
    const source = await decodeImage(item.blob);
    try {
      results.push({
        variants: await renderVariants(source, webp, item.specs),
        width: source.width,
        height: source.height,
      });
    } finally {
      // An ImageBitmap holds a decoded copy of the source in memory. Ten of
      // them at 12 megapixels is roughly 360 MB if they are never released.
      releaseImage(source);
    }
    post({
      id: request.id,
      kind: "progress",
      done: index + 1,
      total: request.items.length,
    });
  }

  post({ id: request.id, kind: "result", items: results, webp });
};

self.addEventListener("message", (event: MessageEvent<ImageWorkerRequest>) => {
  const request = event.data;
  run(request).catch((error: unknown) => {
    post({
      id: request.id,
      kind: "error",
      message:
        error instanceof Error ? error.message : "Image processing failed.",
    });
  });
});
