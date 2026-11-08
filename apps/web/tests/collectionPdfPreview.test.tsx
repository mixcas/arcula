// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import CollectionPdfPage from "@/components/pdf/CollectionPdfPage";
import type { Artwork, Collection } from "@arcula/shared";

/**
 * The preview's height, as the browser receives it.
 *
 * jsdom does no layout, so nothing here measures the frame — but the bug this
 * guards was not a layout bug. Mantine's `h` style prop parses its value and
 * rewrites every number as a length, and it did so to this one: the `2 *` in
 * `calc(100dvh - 60px - 2 * var(--app-shell-padding))` arrived as
 * `calc(2px …) * var(…)`, so the whole `max()` was invalid, the wrapper had no
 * height at all, and the document sat in the iframe's own 150 px default. The
 * source reads correctly either way; only the emitted style tells the two
 * apart. That is why the height travels through `style` and why this file
 * reads the attribute instead of the source.
 *
 * Nothing else about the page is asserted here: what each state says is
 * `pdfBarView`'s suite, and the export pipeline has its own.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The two layout queries. Answering `true` only for the empty query is what
// Chrome does, and neither clause matches, so this runs the desktop branch.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: query === "",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

// A blob URL is not a jsdom concept: the page mints one for the finished file.
Object.assign(URL, {
  createObjectURL: vi.fn(() => "blob:collection-pdf"),
  revokeObjectURL: vi.fn(),
});

const COLLECTION_ID = "AAAAAAAAAAAAAAAAAAAA";

const collection: Collection = {
  id: COLLECTION_ID,
  name: "Flores Solares",
  userId: "owner-1",
  isPublic: true,
};

vi.mock("@/services/collectionService", () => ({
  collectionService: {
    getCollection: () => Promise.resolve(collection),
  },
}));

vi.mock("@/services/artworkService", () => ({
  artworkService: {
    getCollectionArtworks: () => Promise.resolve<Artwork[]>([]),
  },
}));

// The renderer is a separate chunk the page only pulls in for a real export;
// this file is about the frame it ends up in, so the run answers at once.
vi.mock("@/components/pdf/exportCollection", () => ({
  exportCollection: () =>
    Promise.resolve({ blob: new Blob(["pdf"]), pages: 1 }),
}));

afterEach(cleanup);

describe("CollectionPdfPage's preview", () => {
  it("gives the frame the viewport's height, as written", async () => {
    render(
      <MantineProvider>
        <MemoryRouter initialEntries={[`/collection/${COLLECTION_ID}/pdf`]}>
          <Routes>
            <Route
              path="/collection/:collectionId/pdf"
              element={<CollectionPdfPage />}
            />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    const frame = await screen.findByTitle("Collection PDF", undefined, {
      timeout: 5000,
    });
    const emitted = frame.parentElement?.getAttribute("style") ?? "";

    // The whole expression, in one `height` — and nothing Mantine rewrote on
    // the way (a `--mantine-scale` factor is the fingerprint of the parser
    // having taken the value).
    expect(emitted).toContain(
      "height: max(360px, calc(100dvh - 60px - 2 * var(--app-shell-padding)))",
    );
    expect(emitted).not.toContain("--mantine-scale");
    // And the frame is the element that fills it, rather than sizing itself.
    expect(frame).toHaveStyle({ flex: "1", minHeight: "0px" });
  });
});
