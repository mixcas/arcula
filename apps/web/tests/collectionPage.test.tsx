// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CollectionPage from "@/components/manage/CollectionPage";
import { collectionService } from "@/services/collectionService";
import { artworkService } from "@/services/artworkService";
import type { Collection } from "@arcula/shared";

/**
 * The collection page's nav bar: Add Artwork stays a button, and the two
 * page-level destinations it used to show beside it — Deleted and Settings —
 * live in one dots-vertical menu. The test is about where those controls
 * take you, not how Mantine draws them.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/collectionService", () => ({
  collectionService: { getCollection: vi.fn() },
}));

vi.mock("@/services/artworkService", () => ({
  artworkService: { getCollectionArtworks: vi.fn() },
}));

// Mantine resolves responsive props through `matchMedia`; jsdom has none.
// Answering `true` only for the empty query is what Chrome does.
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

const COLLECTION_ID = "cccccccccccccccccccc";
const COLLECTION_NAME = "Flores Solares";
// The address the page settles on once its canonical rewrite has run, so the
// destinations asserted below are the ones a reader sees in the address bar.
const COLLECTION_PARAM = "flores-solares-cccccccccccccccccccc";

const collection: Collection = {
  id: COLLECTION_ID,
  name: COLLECTION_NAME,
  userId: "u1",
  isPublic: true,
  role: "owner",
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 1, nanoseconds: 0 },
};

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

/* eslint-disable @typescript-eslint/unbound-method */
const renderPage = () => {
  vi.mocked(collectionService.getCollection).mockResolvedValue(collection);
  vi.mocked(artworkService.getCollectionArtworks).mockResolvedValue([]);
  /* eslint-enable @typescript-eslint/unbound-method */
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={[`/manage/collection/${COLLECTION_PARAM}`]}>
        <LocationProbe />
        <Routes>
          <Route
            path="/manage/collection/:collectionId"
            element={<CollectionPage />}
          />
          <Route
            path="/manage/collection/:collectionId/deleted"
            element={<div />}
          />
          <Route
            path="/manage/collection/:collectionId/settings"
            element={<div />}
          />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  cleanup();
});

describe("a collection's nav bar", () => {
  it("keeps Add Artwork a link and folds Deleted and Settings into one menu", async () => {
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /add artwork/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: /add artwork/i })).toHaveAttribute(
      "href",
      `/manage/collection/${COLLECTION_PARAM}/artwork/add`,
    );

    // The layout prefactor's whole point: the two page links no longer take
    // space in the bar until the menu is opened.
    expect(
      screen.queryByRole("link", { name: /^deleted$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^settings$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /collection actions/i }),
    ).toBeInTheDocument();
  });

  it.each([
    ["Deleted", "deleted"],
    ["Settings", "settings"],
  ])("opens %s from the menu at its existing address", async (name, path) => {
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /collection actions/i }),
      ).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /collection actions/i }),
    );
    await user.click(await screen.findByRole("menuitem", { name }));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        `/manage/collection/${COLLECTION_PARAM}/${path}`,
      ),
    );
  });

  it("opens the menu from the keyboard", async () => {
    renderPage();
    const trigger = await screen.findByRole("button", {
      name: /collection actions/i,
    });

    trigger.focus();
    const user = userEvent.setup();
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("menuitem", { name: "Deleted" }),
    ).toBeInTheDocument();
  });
});
