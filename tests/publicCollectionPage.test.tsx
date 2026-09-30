// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import * as rtl from "@testing-library/react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { FirebaseError } from "firebase/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PublicCollectionPage from "@/components/collection/PublicCollectionPage";
import type { Artwork, Collection } from "@/types";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: query === "" || query === "(min-width: 36em)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

// The factory is async and imports its helper rather than closing over it:
// `vi.mock` is hoisted above the imports, so a top-level binding from this file
// would not be initialised yet when the factory runs.
vi.mock("@mantine/carousel", async () => {
  const { carouselMock } = await import("./helpers/carouselMock");
  return carouselMock();
});

const getCollection = vi.fn<() => Promise<Collection | null>>();
const getPublicCollectionArtworks = vi.fn<() => Promise<Artwork[]>>();

vi.mock("@/services/collectionService", () => ({
  collectionService: {
    getCollection: (...args: unknown[]) =>
      (getCollection as unknown as (...a: unknown[]) => unknown)(...args),
  },
}));

vi.mock("@/services/artworkService", () => ({
  artworkService: {
    getPublicCollectionArtworks: (...args: unknown[]) =>
      (getPublicCollectionArtworks as unknown as (...a: unknown[]) => unknown)(
        ...args,
      ),
    getArtwork: vi.fn(),
  },
}));

/**
 * Firestore-style ids, not `"collection-1"`.
 *
 * `parseId` treats everything after the *last* hyphen as the document id, so a
 * hyphenated id would be cut to `"1"` and the page would look up a collection
 * that does not exist — a failure that reads as a bug in the page rather than in
 * the test. Real ids are 20 alphanumeric characters.
 */
const COLLECTION_ID = "AAAAAAAAAAAAAAAAAAAA";

const collection = (overrides: Partial<Collection> = {}): Collection => ({
  id: COLLECTION_ID,
  name: "Flores Solares",
  userId: "owner-1",
  isPublic: true,
  ...overrides,
});

const artwork = (id: string, title: string): Artwork => ({
  id,
  userId: "owner-1",
  collectionId: COLLECTION_ID,
  title,
  artistName: "María López",
  isPublic: true,
  documents: [],
  photos: [],
});

const renderPage = () =>
  rtl.render(
    <MantineProvider>
      <MemoryRouter
        initialEntries={[`/collection/flores-solares-${COLLECTION_ID}`]}
      >
        <Routes>
          <Route
            path="/collection/:collectionId"
            element={<PublicCollectionPage />}
          />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );

beforeEach(() => {
  getCollection.mockReset();
  getPublicCollectionArtworks.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("PublicCollectionPage — the reachable states", () => {
  it("renders a section per public artwork", async () => {
    getCollection.mockResolvedValue(collection());
    getPublicCollectionArtworks.mockResolvedValue([
      artwork("a1", "Bodegón"),
      artwork("a2", "Estudio"),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getAllByRole("region")).toHaveLength(2));
  });

  it("orders the artworks by title, as the page has always done", async () => {
    // Sorted client-side rather than with `orderBy`, and the reason belongs
    // beside the query: the service already carries two `where()` constraints
    // and a third would need another composite index deployed first.
    getCollection.mockResolvedValue(collection());
    getPublicCollectionArtworks.mockResolvedValue([
      artwork("a1", "Zeta"),
      artwork("a2", "Alpha"),
    ]);
    renderPage();
    await waitFor(() => {
      const labels = screen
        .getAllByRole("region")
        .map((section) => section.getAttribute("aria-label"));
      expect(labels).toEqual(["Alpha", "Zeta"]);
    });
  });

  it("says the collection is private when the read is denied", async () => {
    getCollection.mockRejectedValue(
      new FirebaseError("permission-denied", "denied"),
    );
    renderPage();
    expect(
      await screen.findByText("This collection is private."),
    ).toBeVisible();
    // The sequencing that matters: a private collection's artworks are never
    // requested, so its contents cannot leak through the public page.
    expect(getPublicCollectionArtworks).not.toHaveBeenCalled();
  });

  it("says the collection is private for a private collection the caller CAN read", async () => {
    // The owner previewing their own private collection lands here, and is told
    // the truth rather than "not available" for a document that plainly exists.
    getCollection.mockResolvedValue(collection({ isPublic: false }));
    renderPage();
    expect(
      await screen.findByText("This collection is private."),
    ).toBeVisible();
    expect(getPublicCollectionArtworks).not.toHaveBeenCalled();
  });

  it("says not available for a collection that does not exist", async () => {
    getCollection.mockResolvedValue(null);
    renderPage();
    expect(
      await screen.findByText("This collection is not available."),
    ).toBeVisible();
  });

  it("reports a transport failure as an error", async () => {
    getCollection.mockRejectedValue(new FirebaseError("unavailable", "down"));
    renderPage();
    expect(await screen.findByText(/Failed to load/)).toBeVisible();
  });

  it("says so plainly when there are no public artworks", async () => {
    getCollection.mockResolvedValue(collection());
    getPublicCollectionArtworks.mockResolvedValue([]);
    renderPage();
    // Deliberately *not* the skin: a skin with an empty stage and a title in the
    // nav reads as a loading failure rather than as an empty collection.
    expect(
      await screen.findByText("No public artworks in this collection yet."),
    ).toBeVisible();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("offers the attribution link in the skin's nav, and no login link", async () => {
    getCollection.mockResolvedValue(collection());
    getPublicCollectionArtworks.mockResolvedValue([artwork("a1", "Bodegón")]);
    renderPage();
    await waitFor(() => expect(screen.getAllByRole("region")).toHaveLength(1));
    // The nav's right slot holds the attribution link. The owner-only link that
    // would replace it is not built — see the TODO in `BasicxChrome` — so this
    // is what an anonymous visitor sees, and the absence of a login link is
    // asserted because one used to be here.
    const credit = screen.getByRole("link", { name: "Powered by Arcula" });
    expect(credit).toHaveAttribute("href", "https://arcula.art");
    expect(credit).toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("link", { name: /manage|login/i })).toBeNull();
  });

  it("links each footer's title to that artwork's public view", async () => {
    getCollection.mockResolvedValue(collection());
    getPublicCollectionArtworks.mockResolvedValue([
      artwork("a1", "Bodegón"),
      artwork("a2", "Estudio"),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getAllByRole("region")).toHaveLength(2));
    // The first section is active before anything is scrolled, so its title is
    // the one linked. The href is built by the shell's `artworkSlug`, which
    // urlizes the title — so the accent is transliterated and this is the
    // canonical path the page would rewrite to anyway.
    expect(screen.getByRole("link", { name: "Bodegón" })).toHaveAttribute(
      "href",
      `/collection/flores-solares-${COLLECTION_ID}/artwork/bodeg-n-a1`,
    );
  });
});
