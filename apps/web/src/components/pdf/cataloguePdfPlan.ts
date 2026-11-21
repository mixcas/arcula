/**
 * The Catalogue PDF's page plan, as pure data.
 *
 * The document's structure has no library underneath it, so this is the part
 * the renderer must not re-decide: which works are in the export, the one order
 * they appear in, which page each becomes, and the single empty page for a
 * catalogue with nothing to print. See `docs/specs/pdf-export.md`.
 */

import { sortPhotos, type Artwork, type ArtworkPhoto } from "@arcula/shared";

/** At most three photos per Artwork, in stored order. */
const PHOTOS_PER_ARTWORK = 3;

/** Six no-photo works per grid page (2 columns × 3 rows). */
const GRID_BLOCK_COUNT = 6;

export type CataloguePdfPage =
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
const compareArtworks = (a: Artwork, b: Artwork): number =>
  collator.compare(a.artistName, b.artistName) ||
  collator.compare(a.title, b.title) ||
  idOrder(a.id, b.id);

/**
 * The pages of one work list in reading order.
 *
 * Every work with photos contributes up to three photo pages in the order it
 * was handed, and the works without photos are collected into grid pages of six
 * — but a photo work flushes the grid run before it, and the run in progress is
 * flushed before the next photo work. Both kinds therefore keep the order they
 * were handed, and a partial grid is never deferred past a photo page. A work
 * belongs to exactly one of those groups. Nothing in the list yields one empty
 * page rather than an empty document.
 *
 * The list is taken as given: each caller decides its own membership and order
 * (the Catalogue's published, sorted works; a Selection's live works in the
 * curator's order), so this is the one page-building rule both exports share.
 */
export function buildWorkListPdfPages(works: Artwork[]): CataloguePdfPage[] {
  const pages: CataloguePdfPage[] = [];
  let gridRun: Artwork[] = [];

  const flushGridRun = (): void => {
    for (let index = 0; index < gridRun.length; index += GRID_BLOCK_COUNT) {
      pages.push({
        kind: "grid",
        artworks: gridRun.slice(index, index + GRID_BLOCK_COUNT),
      });
    }
    gridRun = [];
  };

  for (const artwork of works) {
    const photos = sortPhotos(artwork.photos).slice(0, PHOTOS_PER_ARTWORK);
    if (photos.length === 0) {
      gridRun.push(artwork);
      continue;
    }
    flushGridRun();
    for (const photo of photos) {
      pages.push({ kind: "photo", artwork, photo });
    }
  }

  flushGridRun();

  return pages.length > 0 ? pages : [{ kind: "empty" }];
}

/**
 * The pages of one Catalogue in reading order.
 *
 * Every exportable work with photos contributes up to three photo pages in the
 * one sorted order, and the works without photos become grid pages of six in
 * that same order. A work belongs to exactly one of those groups. Nothing
 * exportable yields one empty page rather than an empty document.
 */
export function buildCataloguePdfPlan(artworks: Artwork[]): CataloguePdfPage[] {
  return buildWorkListPdfPages(
    artworks.filter(isExportableArtwork).sort(compareArtworks),
  );
}

/**
 * The plan's photo pages — what the viewer counts for the large-export warning.
 * Grid and empty pages do not cost image memory; progress counts the distinct
 * photos those pages schedule.
 */
export const photoPageCount = (pages: CataloguePdfPage[]): number =>
  pages.filter((page) => page.kind === "photo").length;
