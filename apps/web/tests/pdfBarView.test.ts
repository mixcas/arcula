import { describe, expect, it } from "vitest";

import { pdfBarView, type PdfBarRun } from "@/components/pdf/pdfBarView";
import type { PublicState } from "@/components/collection/usePublicCollection";
import type { Collection } from "@arcula/shared";

const collection = (overrides: Partial<Collection> = {}): Collection => ({
  id: "collection-1",
  name: "Flores Solares",
  userId: "owner-1",
  isPublic: true,
  ...overrides,
});

type BarState = PublicState<{ collection: Collection }>;

const ready: BarState = {
  status: "ready",
  value: { collection: collection() },
};

const idle: PdfBarRun = { status: "idle" };

const preparing: PdfBarRun = { status: "preparing", done: 3, total: 12 };

const done: PdfBarRun = {
  status: "done",
  url: "blob:https://arcula.art/1c6f",
  pages: 17,
  size: 3 * 1048576,
};

/**
 * The bar's rules, one per state: the Collection's name wherever a read
 * disclosed it, the fallback title where none did, a link only to a page that
 * exists, the work in flight while it runs, and the finished file's summary and
 * actions in the bar on a desktop alone (issues #146, #147, #148).
 */
describe("pdfBarView", () => {
  it("names the Collection and links its page when the read succeeded", () => {
    expect(pdfBarView(ready, idle, false)).toEqual({
      title: "Flores Solares",
      subtitle: "Collection PDF",
      href: "/collection/flores-solares-collection-1",
      detail: { kind: "none" },
    });
  });

  it("keeps the name a locked refusal disclosed, without a link", () => {
    // ADR-0005: the locked refusal carries the name so the prompt has context,
    // but nothing of the Collection itself was read — there is no page to link.
    expect(
      pdfBarView(
        { status: "locked", collectionName: "Flores Solares" },
        idle,
        false,
      ),
    ).toEqual({
      title: "Flores Solares",
      subtitle: "Collection PDF",
      href: null,
      detail: { kind: "none" },
    });
  });

  it("is `Collection PDF` alone when no read disclosed a name", () => {
    const nameless: BarState[] = [
      { status: "loading" },
      { status: "invalid" },
      { status: "notFound" },
      { status: "private" },
      { status: "error" },
      // A locked refusal the server worded without a usable name.
      { status: "locked" },
      { status: "locked", collectionName: "" },
    ];

    for (const state of nameless) {
      expect(pdfBarView(state, idle, false)).toEqual({
        title: "Collection PDF",
        subtitle: null,
        href: null,
        detail: { kind: "none" },
      });
    }
  });

  it("reports the photos being prepared as a label and its fraction", () => {
    expect(pdfBarView(ready, preparing, false).detail).toEqual({
      kind: "progress",
      label: "Preparing photos 3 of 12",
      value: 25,
    });
  });

  it("reports no count and a zero line when nothing was scheduled", () => {
    // The page sends an export with no photos straight to `rendering`, so this
    // is the guard behind the bar rather than a frame a reader reaches: a
    // `0 of 0` would report work that does not exist, and dividing by the
    // empty total would put NaN on the line.
    expect(
      pdfBarView(ready, { status: "preparing", done: 0, total: 0 }, false)
        .detail,
    ).toEqual({ kind: "progress", label: "Preparing photos…", value: 0 });
  });

  it("names the renderer, which has nothing to stop", () => {
    expect(pdfBarView(ready, { status: "rendering" }, false).detail).toEqual({
      kind: "rendering",
      label: "Building PDF…",
    });
  });

  it("keeps the work in flight on a phone, where only the file moves", () => {
    // The card under the bar is the phone's surface for the finished file. A
    // running export has no card: the bar is the whole story there.
    expect(pdfBarView(ready, preparing, true).detail).toEqual(
      pdfBarView(ready, preparing, false).detail,
    );
    expect(pdfBarView(ready, { status: "rendering" }, true).detail).toEqual(
      pdfBarView(ready, { status: "rendering" }, false).detail,
    );
  });

  it("reports the finished file on a desktop, named for download", () => {
    expect(pdfBarView(ready, done, false)).toEqual({
      title: "Flores Solares",
      subtitle: "Collection PDF",
      href: "/collection/flores-solares-collection-1",
      detail: {
        kind: "file",
        summary: "17 pages · 3.00 MB",
        url: "blob:https://arcula.art/1c6f",
        fileName: "flores-solares.pdf",
      },
    });
  });

  it("leaves the finished file out of the bar on a phone", () => {
    // The card under the bar is the phone's one action surface; a second copy
    // in the bar would be the same two buttons twice on one screen.
    expect(pdfBarView(ready, done, true).detail).toEqual({ kind: "none" });
  });

  it("drops the file once the Collection is re-read", () => {
    // A reload, an unlock or a restart leaves the previous file's buttons out
    // of the bar: an export that no longer exists cannot be downloaded from it.
    for (const state of [
      { status: "loading" },
      { status: "error" },
      { status: "locked", collectionName: "Flores Solares" },
      { status: "notFound" },
    ] as BarState[]) {
      expect(pdfBarView(state, done, false).detail).toEqual({ kind: "none" });
    }
  });

  it("reports nothing for the states whose copy and buttons are the body's", () => {
    const body: PdfBarRun[] = [
      { status: "idle" },
      { status: "cancelled" },
      { status: "failed" },
    ];

    for (const run of body) {
      expect(pdfBarView(ready, run, false).detail).toEqual({ kind: "none" });
    }
  });

  it("prints the size in the one wording and rounding the card shares", () => {
    const summaryFor = (size: number): string => {
      const view = pdfBarView(ready, { ...done, size }, false);
      return view.detail.kind === "file" ? view.detail.summary : "";
    };

    // Bytes round up to at least one kB, megabytes keep two decimals.
    expect(summaryFor(400)).toBe("17 pages · 1 kB");
    expect(summaryFor(2_500_000)).toBe("17 pages · 2.38 MB");
  });
});
