/**
 * The two artwork addresses the manage views link to — the public page and the
 * edit page — built in one place.
 *
 * Both the Table's rows and the Grid's cards offer View and Edit on the same
 * work, and the two must land on the same address: the public page so an owner
 * can check what a visitor sees, and the edit page so saving returns to the
 * search being read. Building them here is what lets the row's and the card's
 * links be checked against one shape rather than kept in step by hand.
 *
 * Both read only their arguments: no settings, no location, no state.
 */

import { artworkSearchSuffix, artworkSlug } from "@arcula/shared";
import type { Artwork } from "@arcula/shared";

/** The `:catalogueId` / `:artworkId` param an artwork's links carry. */
const artworkParam = (catalogueParam: string, artwork: Artwork): string =>
  `/catalogue/${catalogueParam}/artwork/${artworkSlug(artwork.title, artwork.id)}`;

/**
 * The work's public page, in the catalogue's own skin. It deliberately does
 * not carry the search: View leaves the app for the visitor's view, and the
 * search belongs to the manage list.
 */
export const publicArtworkHref = (
  catalogueParam: string,
  artwork: Artwork,
): string => artworkParam(catalogueParam, artwork);

/**
 * The work's edit page under `/manage`, carrying the committed catalogue
 * search back so saving returns to the results being read. Built from `q`
 * alone (`artworkSearchSuffix`), so no other parameter follows the user back.
 */
export const manageArtworkEditHref = (
  catalogueParam: string,
  artwork: Artwork,
  searchQuery: string,
): string =>
  `/manage${artworkParam(catalogueParam, artwork)}${artworkSearchSuffix(
    searchQuery.trim(),
  )}`;
