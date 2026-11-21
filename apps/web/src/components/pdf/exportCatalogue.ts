/**
 * The PDF export run.
 *
 * The document is generated in the browser: build the page plan, convert its
 * photos, register the fallback families for the characters the document
 * draws, then render once with `pdf().toBlob()`. There is no server-side
 * generation and no stored file.
 *
 * There is one run for both documents. A caller supplies the work-list-shaped
 * facts the renderer needs — a title, the printed field set, the page plan, the
 * strings those pages draw and the read that asks whether access is still
 * there — and `exportCatalogue` / `exportSelection` are the two adapters that
 * resolve them from their own document. The photo pipeline, the abort
 * semantics and the access error are therefore shared, not copied.
 *
 * Converted photos live only until the render resolves. The document holds the
 * JPEGs themselves — the renderer takes a `Blob` — so nothing here has to be
 * revoked: once `toBlob()` answers, the document and every photo in it are
 * unreachable. A cancel or a lost access ends the run before the render, and
 * the same is true of the half-converted photos.
 */

import { createElement } from "react";
import { pdf } from "@react-pdf/renderer";

import type { Artwork, Catalogue } from "@arcula/shared";

import type { AccessOutcome } from "./cataloguePdfAccess";
import { recheckCatalogueAccess } from "./cataloguePdfAccess";
import {
  buildCataloguePdfPlan,
  type CataloguePdfPage,
} from "./cataloguePdfPlan";
import {
  cataloguePdfFields,
  cataloguePdfTexts,
  type PrintedArtworkFields,
} from "./cataloguePdfPreflight";
import { CataloguePdf } from "./cataloguePdfDocument";
import { loadFallbackFamilies } from "./fallbackFonts";
import {
  preparePhotos,
  scheduledPhotos,
  throwIfAborted,
} from "./photoPipeline";

export interface CataloguePdfResult {
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

/** The facts the one document component needs, resolved by either adapter. */
interface WorkListPdfDocument {
  /** The name the document and every page header print. */
  title: string;
  /** The metadata the source Catalogue records, in the design's two columns. */
  fields: PrintedArtworkFields;
  /** Which works are in the export and which page each becomes. */
  pages: CataloguePdfPage[];
  /**
   * Every string the document draws, for the fallback font's character set.
   * It must be built from the same pages and title the renderer is handed, or
   * a glyph can print in a fallback face.
   */
  texts: string[];
  /**
   * Asked after a refused photo. Resolves `continue` when the object is truly
   * missing and a viewer state when the reader's access has changed.
   */
  recheckAccess: () => Promise<AccessOutcome>;
}

/**
 * Render one work-list document and answer the file.
 *
 * Throws `CataloguePdfAccessError` when a refused photo turns out to mean the
 * reader's access is gone, and `AbortError` when the run was cancelled; the
 * viewer maps the first to its locked/private/notFound state and ignores the
 * second.
 */
export async function exportWorkList(
  document: WorkListPdfDocument,
  options: ExportOptions = {},
): Promise<CataloguePdfResult> {
  const { title, fields, pages, texts, recheckAccess } = document;

  const photoSources = await preparePhotos(scheduledPhotos(pages), {
    signal: options.signal,
    recheckAccess,
    onProgress: options.onProgress,
  });

  // The photos are the slow half; a run cancelled while they were converting
  // must not go on to spend a whole render on a document nobody wants.
  throwIfAborted(options.signal);

  const fallbackFamilies = await loadFallbackFamilies(texts, options.signal);
  throwIfAborted(options.signal);

  // Preflight is over. The renderer is atomic, so from here a cancel has no
  // meaning and the viewer disables it.
  options.onRendering?.();

  const element = createElement(CataloguePdf, {
    title,
    pages,
    fields,
    fallbackFamilies,
    photoSources,
  }) as Parameters<typeof pdf>[0];
  const blob = await pdf(element).toBlob();

  return { blob, pages: pages.length };
}

/**
 * Render the Catalogue and answer the file.
 *
 * The Catalogue adapter: its plan filters to published, live works and sorts
 * them; its fields come from the same deviations both a member's read and a
 * visitor's carry, so the document and the fallback font's character set agree.
 */
export async function exportCatalogue(
  catalogue: Catalogue,
  artworks: Artwork[],
  options: ExportOptions = {},
): Promise<CataloguePdfResult> {
  const pages = buildCataloguePdfPlan(artworks);
  // Which metadata the record has is the Catalogue's decision, resolved from
  // the same deviations both a member's read and a visitor's carry.
  const fields = cataloguePdfFields(catalogue);

  return exportWorkList(
    {
      title: catalogue.name,
      fields,
      pages,
      texts: cataloguePdfTexts(catalogue.name, artworks, fields),
      recheckAccess: () => recheckCatalogueAccess(catalogue.id),
    },
    options,
  );
}
