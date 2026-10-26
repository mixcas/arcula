// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import CollectionPdfBar from "@/components/pdf/CollectionPdfBar";
import { pdfBarView } from "@/components/pdf/pdfBarView";

/**
 * The bar's document structure, which no screenshot settles: the name is the
 * bar's one `h1`, it is an anchor only when a read gave it a page, and the
 * finished file's actions appear exactly once — the assertion that catches a
 * bar rendering them unconditionally, which review and screenshots miss.
 * Everything else about the bar — its wording per state — is `pdfBarView`'s
 * own suite.
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

const at = (element: React.ReactElement) =>
  render(
    <MantineProvider>
      <MemoryRouter>{element}</MemoryRouter>
    </MantineProvider>,
  );

describe("CollectionPdfBar", () => {
  it("renders a named Collection as its one h1, linked to its page", () => {
    const view = pdfBarView(
      {
        status: "ready",
        value: {
          collection: { id: "collection-1", name: "Flores Solares" },
        },
      },
      { status: "idle" },
      false,
    );

    at(<CollectionPdfBar view={view} />);

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
    const view = pdfBarView(
      {
        status: "ready",
        value: { collection: { id: "collection-1", name: "Flores Solares" } },
      },
      {
        status: "done",
        url: "blob:https://arcula.art/1c6f",
        pages: 17,
        size: 3 * 1048576,
      },
      false,
    );
    at(<CollectionPdfBar view={view} />);

    const download = screen.getAllByRole("link", { name: /Download/ });
    expect(download).toHaveLength(1);
    expect(download[0].getAttribute("href")).toBe(
      "blob:https://arcula.art/1c6f",
    );
    expect(download[0].getAttribute("download")).toBe("flores-solares.pdf");

    expect(screen.getAllByRole("button", { name: "Open PDF" })).toHaveLength(1);
    expect(screen.getAllByText("17 pages · 3.00 MB")).toHaveLength(1);
  });

  it("states a nameless page without a link", () => {
    // A locked, private, missing or invalid Collection is either unnamed or
    // has no page to go to; a dead anchor would look live and go nowhere.
    const view = pdfBarView({ status: "notFound" }, { status: "idle" }, false);
    at(<CollectionPdfBar view={view} />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: view.title }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
