// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import CollectionPdfBar from "@/components/pdf/CollectionPdfBar";
import { pdfBarView } from "@/components/pdf/pdfBarView";
import type { PdfBarView } from "@/components/pdf/pdfBarView";
import type { PublicState } from "@/components/collection/usePublicCollection";

/**
 * The bar's document structure, which no screenshot settles: the name is the
 * bar's one `h1`, it is an anchor only when a read gave it a page, each
 * report the bar carries appears exactly once, and the work in flight is
 * reported here rather than in the body — with the one Cancel that can stop
 * it. What the bar says in each state is `pdfBarView`'s own suite.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Mantine resolves its colour scheme through `matchMedia`, which jsdom has no
// implementation of. Answering `true` only for the empty query is what Chrome
// does.
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

afterEach(cleanup);

type BarState = PublicState<{ collection: { id: string; name: string } }>;

const ready: BarState = {
  status: "ready",
  value: { collection: { id: "collection-1", name: "Flores Solares" } },
};

const at = (view: PdfBarView, onCancel: () => void = () => undefined) =>
  render(
    <MantineProvider>
      <MemoryRouter>
        <CollectionPdfBar view={view} onCancel={onCancel} />
      </MemoryRouter>
    </MantineProvider>,
  );

describe("CollectionPdfBar", () => {
  it("renders a named Collection as its one h1, linked to its page", () => {
    const view = pdfBarView(ready, { status: "idle" }, false);
    at(view);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: view.title }),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: view.title });
    expect(link.getAttribute("href")).toBe(view.href);
    // No file, no actions: the body is where a state that asks for something
    // puts its buttons.
    expect(screen.queryByRole("link", { name: /Download/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open PDF" })).toBeNull();
  });

  it("puts the finished file's summary and both actions in the bar", () => {
    at(
      pdfBarView(
        ready,
        {
          status: "done",
          url: "blob:https://arcula.art/1c6f",
          pages: 17,
          size: 3 * 1048576,
        },
        false,
      ),
    );

    const download = screen.getAllByRole("link", { name: /Download/ });
    expect(download).toHaveLength(1);
    expect(download[0].getAttribute("href")).toBe(
      "blob:https://arcula.art/1c6f",
    );
    expect(download[0].getAttribute("download")).toBe("flores-solares.pdf");

    expect(screen.getAllByRole("button", { name: "Open PDF" })).toHaveLength(1);
    expect(screen.getAllByText("17 pages · 3.00 MB")).toHaveLength(1);
  });

  it("puts the photos being prepared, their line and a Cancel in the bar", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    at(
      pdfBarView(ready, { status: "preparing", done: 3, total: 12 }, false),
      onCancel,
    );

    // The line along the bar's edge, beside the label that counts the same
    // photos.
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("offers nothing to stop while the renderer runs", () => {
    // The renderer is atomic: a Cancel here would abandon half a document.
    at(pdfBarView(ready, { status: "rendering" }, false));

    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("states a nameless page without a link", () => {
    // A locked, private, missing or invalid Collection is either unnamed or
    // has no page to go to; a dead anchor would look live and go nowhere.
    const view = pdfBarView({ status: "notFound" }, { status: "idle" }, false);
    at(view);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: view.title }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
