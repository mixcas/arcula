/**
 * The Selection PDF's export adapter.
 *
 * It is not a second exporter: `exportWorkList` owns the photo pipeline, the
 * abort semantics and the renderer. This resolves the Selection's four facts
 * and hands them over — its own name as the title, the source Catalogue's
 * printed field set, a plan in the curator's order with Drafts kept, and the
 * Selection's own access recheck. The works read supplies the photos verbatim,
 * including the `selection` scope that admits a Draft's bytes.
 */

import type { Artwork, SelectionPublicRead } from "@arcula/shared";

import { artworkPdfFields, pdfTexts } from "./cataloguePdfPreflight";
import {
  exportWorkList,
  type CataloguePdfResult,
  type ExportOptions,
} from "./exportCatalogue";
import { recheckSelectionAccess } from "./selectionPdfAccess";
import { buildSelectionPdfPlan } from "./selectionPdfPlan";

/**
 * Render the Selection and answer the file.
 *
 * `pages` is the curator's order; a Draft is printed, a deleted work is not.
 * The fields are the source Catalogue's, carried on the public Selection read,
 * so a visitor's export matches the member's.
 */
export async function exportSelection(
  selectionRead: SelectionPublicRead,
  works: Artwork[],
  options: ExportOptions = {},
): Promise<CataloguePdfResult> {
  const { selection } = selectionRead;
  const pages = buildSelectionPdfPlan(works);
  const fields = artworkPdfFields(
    selectionRead.kind,
    selectionRead.artworkFields,
  );

  return exportWorkList(
    {
      title: selection.name,
      fields,
      pages,
      texts: pdfTexts(selection.name, pages, fields),
      recheckAccess: () => recheckSelectionAccess(selection.id),
    },
    options,
  );
}
