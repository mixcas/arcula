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
 * Its right-hand side is the file that exists, never a state that asks the
 * reader to do something: `idle`, `cancelled` and `failed` keep their copy and
 * their buttons in the body, where the message that explains them is. A
 * finished file is reported on a desktop only: on a
 * phone the card under the bar is the one action surface, so the summary and
 * the two buttons travel together there rather than being offered twice.
 *
 * The rules live here rather than in the page so they are testable without a
 * session, a service or a renderer; the bar renders a view and owns no state.
 */

import { collectionSlug } from "@arcula/shared";

import type { PublicState } from "@/components/collection/usePublicCollection";
import { collectionPdfFileName } from "./collectionPdfPreflight";

/** The bar's title until a read names the Collection, and its subtitle after. */
export const COLLECTION_PDF = "Collection PDF";

/** The one fact the bar needs from a read that succeeded. */
export interface PdfBarCollection {
  id: string;
  name: string;
}

/**
 * The export facts the bar reports.
 *
 * The page owns the run — its key, its abort controller, its blob URL — and
 * this is the face of it the bar reads. The page's own run adds the key to
 * these variants rather than spelling the union a second time.
 */
export type PdfBarRun =
  | { status: "idle" }
  | { status: "preparing"; done: number; total: number }
  | { status: "rendering" }
  | { status: "cancelled" }
  | { status: "failed" }
  | { status: "done"; url: string; pages: number; size: number };

/** What the bar shows on the right. */
export type PdfBarDetail =
  | { kind: "none" }
  | {
      kind: "file";
      /** `17 pages · 3.00 MB`, the same line the phone's card prints. */
      summary: string;
      url: string;
      /** The exported file's own name, carried by **Download**. */
      fileName: string;
    };

export interface PdfBarView {
  /** The page's one top-level heading. */
  title: string;
  /** **Collection PDF**, beside a real name and nowhere else. */
  subtitle: string | null;
  /** The Collection's canonical page, only when there is one to link. */
  href: string | null;
  /** The finished file, where the bar is the surface that offers it. */
  detail: PdfBarDetail;
}

const NO_DETAIL: PdfBarDetail = { kind: "none" };

/**
 * Bytes as the bar and the phone's card print them.
 *
 * One wording and one rounding for both surfaces: megabytes to two decimals,
 * and anything smaller rounded up to a whole kilobyte, so a document is never
 * "0 kB".
 */
const formatBytes = (bytes: number): string =>
  bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(2)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} kB`;

/** The finished file's line: what it holds and how big it is. */
export const pdfFileSummary = (pages: number, size: number): string =>
  `${pages} pages · ${formatBytes(size)}`;

/**
 * The bar's title, subtitle, link and detail for a load state, a run and a
 * layout.
 *
 * `PublicState<T>` is covariant in `T`, so the page's own state (a Collection
 * and its artworks) is accepted by the narrower `PdfBarCollection` here.
 */
export const pdfBarView = (
  state: PublicState<{ collection: PdfBarCollection }>,
  run: PdfBarRun,
  mobile: boolean,
): PdfBarView => {
  if (state.status === "ready") {
    const { name, id } = state.value.collection;
    // A run is only reported by a read that succeeded: a reload, an unlock or
    // a restart drops the previous file's buttons along with the state that
    // owned them. A phone keeps its actions in the card under the bar.
    const detail: PdfBarDetail =
      !mobile && run.status === "done"
        ? {
            kind: "file",
            summary: pdfFileSummary(run.pages, run.size),
            url: run.url,
            fileName: collectionPdfFileName(name),
          }
        : NO_DETAIL;
    return {
      title: name,
      subtitle: COLLECTION_PDF,
      href: `/collection/${collectionSlug(name, id)}`,
      detail,
    };
  }

  // The refusal an oddly worded answer carries no name in is still `locked`;
  // the bar then keeps the fallback title rather than an empty heading.
  if (state.status === "locked" && state.collectionName) {
    return {
      title: state.collectionName,
      subtitle: COLLECTION_PDF,
      href: null,
      detail: NO_DETAIL,
    };
  }

  return {
    title: COLLECTION_PDF,
    subtitle: null,
    href: null,
    detail: NO_DETAIL,
  };
};
