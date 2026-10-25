/**
 * The Collection PDF's page plan, as pure data.
 *
 * The document's structure has no library underneath it, so this is the part
 * the renderer must not re-decide: which works are in the export, the one order
 * they appear in, which page each becomes, and the single empty page for a
 * collection with nothing to print. See `docs/specs/pdf-export.md`.
 */

import { sortPhotos, type Artwork, type ArtworkPhoto } from "@arcula/shared";

/** At most three photos per Artwork, in stored order. */
export const PHOTOS_PER_ARTWORK = 3;

/** Six no-photo works per grid page (2 columns × 3 rows). */
export const GRID_BLOCK_COUNT = 6;

export type CollectionPdfPage =
  | { kind: "photo"; artwork: Artwork; photo: ArtworkPhoto }
  | { kind: "grid"; artworks: Artwork[] }
  | { kind: "empty" };

/** One collator for the whole document: case- and accent-insensitive, numeric. */
const collator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

/**
 * Published and live only. An absent `status` reads as `published`, and an
 * absent or `null` `deletedAt` reads as live — the model's rules everywhere.
 */
export const isExportableArtwork = (artwork: Artwork): boolean =>
  (artwork.status ?? "published") === "published" && !artwork.deletedAt;

/** A raw id comparison: ids are opaque, so only equality and order matter. */
const idOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Artist name, then title, with the id making an exact tie stable. */
export const compareArtworks = (a: Artwork, b: Artwork): number =>
  collator.compare(a.artistName, b.artistName) ||
  collator.compare(a.title, b.title) ||
  idOrder(a.id, b.id);

/**
 * The pages of one Collection in reading order.
 *
 * Every exportable work with photos contributes up to three photo pages in the
 * one sorted order; the works without photos follow, six per grid page. A work
 * belongs to exactly one of those groups. Nothing exportable yields one empty
 * page rather than an empty document.
 */
export function buildCollectionPdfPlan(
  artworks: Artwork[],
): CollectionPdfPage[] {
  const exportable = artworks.filter(isExportableArtwork).sort(compareArtworks);
  const pages: CollectionPdfPage[] = [];
  const gridArtworks: Artwork[] = [];

  for (const artwork of exportable) {
    const photos = sortPhotos(artwork.photos).slice(0, PHOTOS_PER_ARTWORK);
    if (photos.length === 0) {
      gridArtworks.push(artwork);
      continue;
    }
    for (const photo of photos) {
      pages.push({ kind: "photo", artwork, photo });
    }
  }

  for (let index = 0; index < gridArtworks.length; index += GRID_BLOCK_COUNT) {
    pages.push({
      kind: "grid",
      artworks: gridArtworks.slice(index, index + GRID_BLOCK_COUNT),
    });
  }

  return pages.length > 0 ? pages : [{ kind: "empty" }];
}

/**
 * The plan's photo pages — what the viewer counts for the large-export warning.
 * Grid and empty pages do not cost image memory; progress counts the distinct
 * photos those pages schedule.
 */
export const photoPageCount = (pages: CollectionPdfPage[]): number =>
  pages.filter((page) => page.kind === "photo").length;
