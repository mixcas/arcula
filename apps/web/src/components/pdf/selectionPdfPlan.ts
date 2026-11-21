/**
 * A Selection PDF's page plan, as pure data.
 *
 * The Selection is a second entry point over the Catalogue plan's page shapes,
 * never a second exporter: the read already decided membership and order, so
 * this only drops the works deleted in their Catalogue and hands the list to
 * the shared builder. Drafts stay — a Selection shows them on purpose — and
 * nothing is sorted, because `position` is the content.
 */

import type { Artwork } from "@arcula/shared";

import {
  buildWorkListPdfPages,
  type CataloguePdfPage,
} from "./cataloguePdfPlan";

/** A work deleted in its Catalogue leaves the Selection's export. */
const isLiveArtwork = (artwork: Artwork): boolean => !artwork.deletedAt;

/**
 * The pages of one Selection, in the curator's order.
 *
 * The order is the input's and is never re-decided: the works read already
 * sorts by `position`, then artwork id for a duplicated position. A Draft keeps
 * its place; only a deleted work is dropped. An empty Selection is one empty
 * page, as an empty Catalogue is.
 */
export function buildSelectionPdfPlan(works: Artwork[]): CataloguePdfPage[] {
  return buildWorkListPdfPages(works.filter(isLiveArtwork));
}
