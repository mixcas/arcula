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
 * Its right-hand side is the export's report, under one rule: **the bar
 * reports work in flight and the file that exists; the body carries the
 * message and the call to action.** So `preparing` counts the photos it is
 * converting and offers the one thing that can stop them, `rendering` names
 * the one step that cannot be interrupted, and a finished file is reported
 * with its summary and buttons on a desktop only — on a phone the card under
 * the bar is the one action surface, so the summary and the two buttons travel
 * together there rather than being offered twice. Every state that asks the
 * reader to do something — `idle`, `cancelled`, `failed` — reports nothing
 * here, because the message that explains it and the button that answers it
 * are the body's.
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
      kind: "progress";
      /** `Preparing photos 3 of 12`, and no count when nothing was scheduled. */
      label: string;
      /** The fraction prepared, 0–100: the line along the bar's edge. */
      value: number;
    }
  | {
      kind: "rendering";
      /** `Building PDF…`. There is nothing beside it: no line, no Cancel. */
      label: string;
    }
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
  /** The work in flight or the finished file, where the bar is their surface. */
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
 * The photos being converted: what the bar calls them and how far they are.
 *
 * The fraction is the one number the label and the line both print, so a run
 * with nothing scheduled answers zero rather than dividing by it — NaN on the
 * line — and drops the count instead of reporting `0 of 0`. The page sends
 * such a run straight to `rendering`, since an export with no photos has no
 * progress to make, so this is the guard behind the bar rather than a frame a
 * reader reaches.
 */
const preparingDetail = (done: number, total: number): PdfBarDetail =>
  total === 0
    ? { kind: "progress", label: "Preparing photos…", value: 0 }
    : {
        kind: "progress",
        label: `Preparing photos ${done} of ${total}`,
        value: (done / total) * 100,
      };

/**
 * The export's report: the work in flight as it runs, the file once it exists,
 * and nothing for the states whose copy and buttons are the body's.
 */
const runDetail = (
  run: PdfBarRun,
  mobile: boolean,
  collectionName: string,
): PdfBarDetail => {
  switch (run.status) {
    case "preparing":
      return preparingDetail(run.done, run.total);
    // The renderer is atomic: there is nothing to cancel that would not leave
    // a half-built document, and no fraction to put on a line.
    case "rendering":
      return { kind: "rendering", label: "Building PDF…" };
    case "done":
      // A phone keeps its actions — and the summary that travels with them —
      // in the card under the bar.
      return mobile
        ? NO_DETAIL
        : {
            kind: "file",
            summary: pdfFileSummary(run.pages, run.size),
            url: run.url,
            fileName: collectionPdfFileName(collectionName),
          };
    case "idle":
    case "cancelled":
    case "failed":
      return NO_DETAIL;
  }
};

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
    // a failure drops whatever the previous run was reporting — progress or a
    // file — along with the state that owned it.
    return {
      title: name,
      subtitle: COLLECTION_PDF,
      href: `/collection/${collectionSlug(name, id)}`,
      detail: runDetail(run, mobile, name),
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
