/**
 * PROTOTYPE — the Collection PDF's page plan.
 *
 * Throwaway code on `prototype/pdf-export` (#129). It answers "what pages does
 * this collection become?" so the renderer can be mechanical. If the map's
 * recommendation survives, this function (and its tests in the real
 * implementation) is the part worth keeping.
 *
 * The rules are the charted ones: published and live only, Artist A–Z then
 * Title A–Z (one collator, id as the tie-break), up to three photos per work,
 * one photo per page, and the works without photos followed by a 2×3 grid.
 */

import { sortPhotos, type Artwork, type ArtworkPhoto } from "@arcula/shared";

/** At most three photos per Artwork, in stored order. */
export const PHOTOS_PER_ARTWORK = 3;

/** Six no-photo works per grid page (2 columns × 3 rows). */
export const GRID_BLOCK_COUNT = 6;

export type PdfPlanPage =
  | { kind: "photo"; artwork: Artwork; photo: ArtworkPhoto }
  | { kind: "grid"; artworks: Artwork[] }
  | { kind: "empty" };

/** One collator for the whole document; the id keeps equal names stable. */
const collator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

export const compareArtworks = (a: Artwork, b: Artwork): number =>
  collator.compare(a.artistName, b.artistName) ||
  collator.compare(a.title, b.title) ||
  collator.compare(a.id, b.id);

/** A draft is in the collection but not in its export; a deleted work is in
 *  neither. `status` absent reads as published, as everywhere else. */
export const isExportableArtwork = (artwork: Artwork): boolean =>
  (artwork.status ?? "published") === "published" && !artwork.deletedAt;

/** The pages of one collection, in reading order. */
export function buildPdfPlan(artworks: Artwork[]): PdfPlanPage[] {
  const live = artworks.filter(isExportableArtwork).sort(compareArtworks);
  const withPhotos = live.filter(
    (artwork) => sortPhotos(artwork.photos).length > 0,
  );
  const withoutPhotos = live.filter(
    (artwork) => sortPhotos(artwork.photos).length === 0,
  );

  const pages: PdfPlanPage[] = [];

  for (const artwork of withPhotos) {
    for (const photo of sortPhotos(artwork.photos).slice(
      0,
      PHOTOS_PER_ARTWORK,
    )) {
      pages.push({ kind: "photo", artwork, photo });
    }
  }

  for (let index = 0; index < withoutPhotos.length; index += GRID_BLOCK_COUNT) {
    pages.push({
      kind: "grid",
      artworks: withoutPhotos.slice(index, index + GRID_BLOCK_COUNT),
    });
  }

  // The grilled decision: an empty collection exports a header-only PDF.
  return pages.length > 0 ? pages : [{ kind: "empty" }];
}
