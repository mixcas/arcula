/**
 * The Collection PDF's export run.
 *
 * The document is generated in the browser: build the page plan, convert its
 * photos, register the fallback families for the characters the document
 * draws, then render once with `pdf().toBlob()`. There is no server-side
 * generation and no stored file.
 *
 * Converted photos live only until the render resolves. The document holds the
 * JPEGs themselves — the renderer takes a `Blob` — so nothing here has to be
 * revoked: once `toBlob()` answers, the document and every photo in it are
 * unreachable. A cancel or a lost access ends the run before the render, and
 * the same is true of the half-converted photos.
 */

import { createElement } from "react";
import { pdf } from "@react-pdf/renderer";

import type { Artwork, Collection } from "@arcula/shared";

import { recheckCollectionAccess } from "./collectionPdfAccess";
import { buildCollectionPdfPlan } from "./collectionPdfPlan";
import { collectionPdfTexts } from "./collectionPdfPreflight";
import { CollectionPdf } from "./collectionPdfDocument";
import { loadFallbackFamilies } from "./fallbackFonts";
import {
  preparePhotos,
  scheduledPhotos,
  throwIfAborted,
} from "./photoPipeline";

export interface CollectionPdfResult {
  blob: Blob;
  pages: number;
}

export interface ExportOptions {
  /** Aborted by a cancel, an unmount or a superseded export. */
  signal?: AbortSignal;
  /** Progress over distinct scheduled photos; `0 of total` first. */
  onProgress?: (done: number, total: number) => void;
  /** The photos are ready and the renderer is about to run; cancel is too late. */
  onRendering?: () => void;
}

/**
 * Render the Collection and answer the file.
 *
 * Throws `CollectionPdfAccessError` when a refused photo turns out to mean the
 * reader's access is gone, and `AbortError` when the run was cancelled; the
 * viewer maps the first to its locked/private/notFound state and ignores the
 * second.
 */
export async function exportCollection(
  collection: Collection,
  artworks: Artwork[],
  options: ExportOptions = {},
): Promise<CollectionPdfResult> {
  const pages = buildCollectionPdfPlan(artworks);

  const photoSources = await preparePhotos(scheduledPhotos(pages), {
    signal: options.signal,
    recheckAccess: () => recheckCollectionAccess(collection.id),
    onProgress: options.onProgress,
  });

  // The photos are the slow half; a run cancelled while they were converting
  // must not go on to spend a whole render on a document nobody wants.
  throwIfAborted(options.signal);

  const fallbackFamilies = await loadFallbackFamilies(
    collectionPdfTexts(collection.name, artworks),
    options.signal,
  );
  throwIfAborted(options.signal);

  // Preflight is over. The renderer is atomic, so from here a cancel has no
  // meaning and the viewer disables it.
  options.onRendering?.();

  const document = createElement(CollectionPdf, {
    collection,
    pages,
    fallbackFamilies,
    photoSources,
  }) as Parameters<typeof pdf>[0];
  const blob = await pdf(document).toBlob();

  return { blob, pages: pages.length };
}
