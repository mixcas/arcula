/**
 * The Collection PDF's export run.
 *
 * The document is generated in the browser: build the page plan, register the
 * fallback families for the characters the document draws, then render once
 * with `pdf().toBlob()`. There is no server-side generation and no stored file.
 *
 * The photo pipeline is a later ticket; the plan still decides which photo
 * pages exist, and each one draws its print box with the placeholder.
 */

import { createElement } from "react";
import { pdf } from "@react-pdf/renderer";

import type { Artwork, Collection } from "@arcula/shared";

import { buildCollectionPdfPlan } from "./collectionPdfPlan";
import { collectionPdfTexts } from "./collectionPdfPreflight";
import { CollectionPdf } from "./collectionPdfDocument";
import { loadFallbackFamilies } from "./fallbackFonts";

export interface CollectionPdfResult {
  blob: Blob;
  pages: number;
}

export async function exportCollection(
  collection: Collection,
  artworks: Artwork[],
): Promise<CollectionPdfResult> {
  const pages = buildCollectionPdfPlan(artworks);
  const fallbackFamilies = await loadFallbackFamilies(
    collectionPdfTexts(collection.name, artworks),
  );

  const document = createElement(CollectionPdf, {
    collection,
    pages,
    fallbackFamilies,
  }) as Parameters<typeof pdf>[0];
  const blob = await pdf(document).toBlob();

  return { blob, pages: pages.length };
}
