/**
 * PROTOTYPE — the export orchestration.
 *
 * Throwaway code on `prototype/pdf-export` (#129). Preflight the photos
 * (fetch, convert, bounded concurrency, cancellable), then render the document
 * once with `pdf().toBlob()` and hand the blob back. Progress and cancel live
 * in the preflight because the renderer exposes neither.
 */

import { pdf } from "@react-pdf/renderer";

import type { ArtworkPhoto, Collection } from "@arcula/shared";
import {
  CollectionPdf,
  PHOTO_BOX,
  pdfTexts,
  type PdfTypography,
} from "./CollectionPdf";
import { loadFallbackFont } from "./fallbackFont";
import {
  convertPhotoToJpeg,
  ExportAbortedError,
  PhotoUnavailableError,
  type PixelBox,
} from "./photoToJpeg";
import type { PdfPlanPage } from "./plan";
import { collectionService } from "@/services/collectionService";
import { ApiRequestError } from "@/services/api";

export type ImageSource = "xlarge" | "original";

export interface ExportOptions {
  source: ImageSource;
  /** Pixels per inch of the printed photo box. */
  dpi: 150 | 200 | 300;
  typography: PdfTypography;
  jpegQuality: number;
}

export interface ExportProgress {
  phase: "preparing" | "rendering";
  done: number;
  total: number;
}

export interface ExportStats {
  pages: number;
  photoPages: number;
  gridPages: number;
  photos: number;
  photosConverted: number;
  photosFailed: number;
  sourceBytes: number;
  convertedBytes: number;
  pdfBytes: number;
  targetBox: PixelBox;
  prefetchMs: number;
  fetchMs: number;
  decodeMs: number;
  encodeMs: number;
  renderMs: number;
  /** Fetching the fallback-font subset, when the text needed one. */
  fallbackMs: number;
  /** Distinct non-ASCII characters the fallback covered; 0 when none. */
  fallbackCharacters: number;
  /** Bytes of the fallback font the browser fetched. */
  fallbackBytes: number;
  totalMs: number;
  peakHeapMb: number | null;
}

export interface ExportResult {
  blob: Blob;
  stats: ExportStats;
}

/** The media proxy says no, and the collection read says why: a 404 for a
 *  protected collection the visitor no longer holds a grant for is the
 *  exhausted-grant re-lock from the grill, not a broken photo. */
export class GrantExpiredError extends Error {
  constructor() {
    super("The collection needs to be unlocked again");
    this.name = "GrantExpiredError";
  }
}

const CONCURRENCY = 4;

const TARGET_BOX = (dpi: number): PixelBox => ({
  width: Math.round((PHOTO_BOX.width / 72) * dpi),
  height: Math.round((PHOTO_BOX.height / 72) * dpi),
});

const uniquePhotos = (pages: PdfPlanPage[]): ArtworkPhoto[] => {
  const seen = new Set<string>();
  const photos: ArtworkPhoto[] = [];
  for (const page of pages) {
    if (page.kind !== "photo") {
      continue;
    }
    if (!seen.has(page.photo.id)) {
      seen.add(page.photo.id);
      photos.push(page.photo);
    }
  }
  return photos;
};

const photoUrlFor = (
  photo: ArtworkPhoto,
  source: ImageSource,
): string | null => {
  if (source === "original") {
    return photo.original?.url ?? null;
  }
  const variant = photo.variants?.find((entry) => entry.key === "xlarge");
  return variant?.url ?? photo.original?.url ?? null;
};

/** Does the collection still read? A protected collection whose grant expired
 *  refuses with 403 `password-required`; anything else is still readable. */
const grantStillWorks = async (collectionId: string): Promise<boolean> => {
  try {
    await collectionService.getCollection(collectionId);
    return true;
  } catch (error) {
    return !(
      error instanceof ApiRequestError &&
      error.status === 403 &&
      error.code === "password-required"
    );
  }
};

interface MemoryPerformance extends Performance {
  memory?: { usedJSHeapSize: number };
}

const heapMb = (): number | null => {
  const memory = (performance as MemoryPerformance).memory;
  return memory ? Math.round(memory.usedJSHeapSize / 1048576) : null;
};

export async function exportCollection(
  collection: Collection,
  pages: PdfPlanPage[],
  options: ExportOptions,
  signal: AbortSignal,
  onProgress: (progress: ExportProgress) => void,
): Promise<ExportResult> {
  const started = performance.now();
  const box = TARGET_BOX(options.dpi);
  const photos = uniquePhotos(pages);
  const images = new Map<string, Blob | null>();
  onProgress({ phase: "preparing", done: 0, total: photos.length });

  let peakHeap = heapMb();
  const sample = () => {
    const value = heapMb();
    if (value !== null && (peakHeap === null || value > peakHeap)) {
      peakHeap = value;
    }
  };
  const sampler = setInterval(sample, 100);

  let sourceBytes = 0;
  let convertedBytes = 0;
  let fetchMs = 0;
  let decodeMs = 0;
  let encodeMs = 0;
  let converted = 0;
  let failed = 0;
  let done = 0;

  const prefetchStarted = performance.now();
  try {
    let cursor = 0;

    const work = async (): Promise<void> => {
      for (;;) {
        if (signal.aborted) {
          throw new ExportAbortedError();
        }
        const index = cursor;
        cursor += 1;
        const photo = photos[index];
        if (!photo) {
          return;
        }

        const url = photoUrlFor(photo, options.source);
        if (!url) {
          images.set(photo.id, null);
          failed += 1;
          done += 1;
          onProgress({ phase: "preparing", done, total: photos.length });
          continue;
        }

        try {
          const result = await convertPhotoToJpeg(
            url,
            box,
            signal,
            options.jpegQuality,
          );
          images.set(photo.id, result.blob);
          sourceBytes += result.sourceBytes;
          convertedBytes += result.blob.size;
          fetchMs += result.fetchMs;
          decodeMs += result.decodeMs;
          encodeMs += result.encodeMs;
          converted += 1;
        } catch (error) {
          if (error instanceof ExportAbortedError || signal.aborted) {
            throw new ExportAbortedError();
          }
          if (error instanceof PhotoUnavailableError) {
            // Before treating a refusal as one broken image, ask the
            // collection read whether the visitor still has access. An
            // expired grant is a re-lock, not thirty placeholders.
            if (error.status === 404 || error.status === 403) {
              const stillReads = await grantStillWorks(collection.id);
              if (!stillReads) {
                throw new GrantExpiredError();
              }
            }
            images.set(photo.id, null);
            failed += 1;
          } else {
            images.set(photo.id, null);
            failed += 1;
          }
        }
        done += 1;
        sample();
        onProgress({ phase: "preparing", done, total: photos.length });
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(CONCURRENCY, Math.max(1, photos.length)) },
        () => work(),
      ),
    );
  } finally {
    clearInterval(sampler);
  }

  const prefetchMs = Math.round(performance.now() - prefetchStarted);

  if (signal.aborted) {
    throw new ExportAbortedError();
  }

  // The renderer embeds its fonts, so the browser's own fallback never runs.
  // Fetch the subset before rendering, not after: a family registered mid-run
  // is only used by the next render.
  const fallbackStarted = performance.now();
  const fallback = await loadFallbackFont(pdfTexts(collection, pages), signal);
  const fallbackMs = Math.round(performance.now() - fallbackStarted);

  if (signal.aborted) {
    throw new ExportAbortedError();
  }

  onProgress({ phase: "rendering", done: photos.length, total: photos.length });
  const renderStarted = performance.now();
  const blob = await pdf(
    <CollectionPdf
      collection={collection}
      pages={pages}
      images={images}
      typography={options.typography}
      fallbackFamily={fallback?.family}
    />,
  ).toBlob();
  const renderMs = Math.round(performance.now() - renderStarted);

  if (signal.aborted) {
    throw new ExportAbortedError();
  }

  const photoPages = pages.filter((page) => page.kind === "photo").length;
  const gridPages = pages.filter((page) => page.kind === "grid").length;

  return {
    blob,
    stats: {
      pages: pages.length,
      photoPages,
      gridPages,
      photos: photos.length,
      photosConverted: converted,
      photosFailed: failed,
      sourceBytes,
      convertedBytes,
      pdfBytes: blob.size,
      targetBox: box,
      prefetchMs,
      fetchMs: Math.round(fetchMs),
      decodeMs: Math.round(decodeMs),
      encodeMs: Math.round(encodeMs),
      renderMs,
      fallbackMs,
      fallbackCharacters: fallback?.characters ?? 0,
      fallbackBytes: fallback?.bytes ?? 0,
      totalMs: Math.round(performance.now() - started),
      peakHeapMb: peakHeap,
    },
  };
}
