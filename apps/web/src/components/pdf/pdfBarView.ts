/**
 * What the viewer's bar says, decided once and purely.
 *
 * The bar is present in every state the route can be in, and its left-hand
 * side is the same question in all of them: is there a Collection to name?
 * A `ready` read disclosed the name and its canonical page; a `locked`
 * refusal disclosed the name alone (ADR-0005), which is what the prompt is
 * about but nothing to link. Every other state — `loading`, `invalid`,
 * `notFound`, `private`, `error`, and a lock with no usable name — has no
 * Collection to name, so the bar carries the page's own title and no
 * subtitle.
 *
 * The rules live here rather than in the page so they are testable without a
 * session, a service or a renderer; the bar renders a view and owns no state.
 */

import { collectionSlug } from "@arcula/shared";

import type { PublicState } from "@/components/collection/usePublicCollection";

/** The bar's title until a read names the Collection, and its subtitle after. */
export const COLLECTION_PDF = "Collection PDF";

/** The one fact the bar needs from a read that succeeded. */
export interface PdfBarCollection {
  id: string;
  name: string;
}

export interface PdfBarView {
  /** The page's one top-level heading. */
  title: string;
  /** **Collection PDF**, beside a real name and nowhere else. */
  subtitle: string | null;
  /** The Collection's canonical page, only when there is one to link. */
  href: string | null;
}

/**
 * The bar's title, subtitle and link for any load state.
 *
 * `PublicState<T>` is covariant in `T`, so the page's own state (a Collection
 * and its artworks) is accepted by the narrower `PdfBarCollection` here.
 */
export const pdfBarView = (
  state: PublicState<{ collection: PdfBarCollection }>,
): PdfBarView => {
  if (state.status === "ready") {
    const { name, id } = state.value.collection;
    return {
      title: name,
      subtitle: COLLECTION_PDF,
      href: `/collection/${collectionSlug(name, id)}`,
    };
  }

  // The refusal an oddly worded answer carries no name in is still `locked`;
  // the bar then keeps the fallback title rather than an empty heading.
  if (state.status === "locked" && state.collectionName) {
    return {
      title: state.collectionName,
      subtitle: COLLECTION_PDF,
      href: null,
    };
  }

  return { title: COLLECTION_PDF, subtitle: null, href: null };
};
