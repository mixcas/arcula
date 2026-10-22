// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import * as rtl from "@testing-library/react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PublicArtworkPage from "@/components/collection/PublicArtworkPage";
import { ApiRequestError } from "@/services/api";
import type { Artwork, Collection } from "@arcula/shared";

// React 19 requires this flag for act() outside a browser environment.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom implements no matchMedia; the skin resolves its breakpoint through it.
// Answering `false` for everything would put the test on the mobile layout,
// which is a valid branch but not the one these cases are about.
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

// embla needs real rects, which jsdom has none of. The artwork view's own
// decisions — which states it can reach, and that it renders one section — are
// asserted here; the slideshow inside is covered in tests/basicxSkin.test.tsx.
// The factory is async and imports its helper rather than closing over it:
// `vi.mock` is hoisted above the imports, so a top-level binding from this file
// would not be initialised yet when the factory runs.
vi.mock("@mantine/carousel", async () => {
  const { carouselMock } = await import("./helpers/carouselMock");
  return carouselMock();
});

const getCollection = vi.fn<() => Promise<Collection | null>>();
const getArtwork = vi.fn<() => Promise<Artwork | null>>();
const getCollectionArtworks = vi.fn<() => Promise<Artwork[]>>();
const unlockCollection = vi.fn<() => Promise<void>>();

vi.mock("@/services/collectionService", () => ({
  collectionService: {
    getCollection: (...args: unknown[]) =>
      (getCollection as unknown as (...a: unknown[]) => unknown)(...args),
    unlockCollection: (...args: unknown[]) =>
      (unlockCollection as unknown as (...a: unknown[]) => unknown)(...args),
  },
}));

vi.mock("@/services/artworkService", () => ({
  artworkService: {
    getArtwork: (...args: unknown[]) =>
      (getArtwork as unknown as (...a: unknown[]) => unknown)(...args),
    getCollectionArtworks: (...args: unknown[]) =>
      (getCollectionArtworks as unknown as (...a: unknown[]) => unknown)(
        ...args,
      ),
  },
}));

/**
 * An opaque, hyphen-free id.
 *
 * Not `"collection-1"`: `parseId` treats everything after the *last* hyphen as
 * the document id, so a hyphenated id would be cut down to `"1"` — and the
 * artwork's own `collectionId` would no longer match the parsed one, failing
 * the parent check and rendering "not available". Real ids are 20
 * alphanumeric characters, and a test should use something that cannot be
 * mistaken for a slug.
 */
const COLLECTION_ID = "AAAAAAAAAAAAAAAAAAAA";

const collection = (overrides: Partial<Collection> = {}): Collection => ({
  id: COLLECTION_ID,
  name: "Flores Solares",
  userId: "owner-1",
  isPublic: true,
  ...overrides,
});

const photo = (id: string, order: number) => ({
  id,
  order,
  name: `${id}.jpg`,
  size: 1000,
  contentType: "image/jpeg",
  width: 3000,
  height: 2000,
  original: {
    url: `https://files.test/original/${id}.jpg`,
    size: 1000,
    contentType: "image/jpeg",
  },
  variants: [],
});

const ARTWORK_ID = "BBBBBBBBBBBBBBBBBBBB";

const artwork = (overrides: Partial<Artwork> = {}): Artwork => ({
  id: ARTWORK_ID,
  userId: "owner-1",
  collectionId: COLLECTION_ID,
  title: "Estudio en rojo",
  artistName: "María López",
  status: "published",
  documents: [],
  photos: [],
  ...overrides,
});

const renderPage = () =>
  rtl.render(
    <MantineProvider>
      <MemoryRouter
        initialEntries={[
          `/collection/flores-solares-${COLLECTION_ID}/artwork/estudio-en-rojo-${ARTWORK_ID}`,
        ]}
      >
        <Routes>
          <Route
            path="/collection/:collectionId/artwork/:artworkId"
            element={<PublicArtworkPage />}
          />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );

beforeEach(() => {
  getCollection.mockReset();
  getArtwork.mockReset();
  getCollectionArtworks.mockReset();
  unlockCollection.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("PublicArtworkPage — the reachable states", () => {
  it("renders the artwork's section in a published collection", async () => {
    getCollection.mockResolvedValue(collection());
    getArtwork.mockResolvedValue(artwork({ photos: [{ ...photo("p1", 0) }] }));
    renderPage();
    // The section carries the artwork's title, so finding it proves the whole
    // path: both reads resolved, the parent matched, and the skin rendered.
    await waitFor(() => expect(getArtwork).toHaveBeenCalled());
    // `section` carries an implicit `region` role only when it has an accessible
    // name, so this is asserting the name is wired up as well as that a section
    // rendered — which is the whole of the artwork view's job.
    await waitFor(() =>
      expect(screen.getByRole("region")).toHaveAttribute(
        "aria-label",
        "Estudio en rojo",
      ),
    );
    // The footer is two lines now: the title and the artist, not a joined
    // string. Both being present is what proves the skin rendered the whole
    // path rather than the loading or private state.
    expect(screen.getByText("Estudio en rojo")).toBeVisible();
    expect(screen.getByText("María López")).toBeVisible();
  });

  it("says the collection is private when the collection read is denied", async () => {
    getCollection.mockRejectedValue(
      new ApiRequestError(403, "forbidden", "denied"),
    );
    renderPage();
    // The collection read is the gate, so its answer is the one that shows —
    // even though the visitor asked about an artwork.
    expect(
      await screen.findByText("This collection is private."),
    ).toBeVisible();
    // A private collection's artworks are never requested, so a private
    // collection's contents cannot leak through this page.
    expect(getArtwork).not.toHaveBeenCalled();
  });

  it("says the artwork is not available when the artwork read returns nothing", async () => {
    getCollection.mockResolvedValue(collection());
    getArtwork.mockResolvedValue(null);
    renderPage();
    // Not "this collection is private": the collection is public, and the
    // artwork is the thing that cannot be shown. The API answers 404 for a
    // private, soft-deleted and an absent work alike — saying which was
    // refused would be a disclosure — and the service folds that 404 to null.
    expect(
      await screen.findByText("This artwork is not available."),
    ).toBeVisible();
  });

  it("is not found for a public artwork in a different collection", async () => {
    getCollection.mockResolvedValue(collection());
    // The API serves a public artwork by id whatever its parent, so nothing
    // server-side stops this. The page's own check is the whole guard.
    getArtwork.mockResolvedValue(
      artwork({ collectionId: "some-other-collection" }),
    );
    renderPage();
    expect(
      await screen.findByText("This artwork is not available."),
    ).toBeVisible();
  });

  it("reports a transport failure as an error, not as a missing artwork", async () => {
    getCollection.mockResolvedValue(collection());
    getArtwork.mockRejectedValue(new ApiRequestError(500, "internal", "down"));
    renderPage();
    // The distinction from the case above is the point: reporting "this
    // artwork is not available" for a failure that is not a 404 is a claim the
    // app cannot support, and it costs the visitor a retry that would have
    // worked.
    expect(await screen.findByText(/Failed to load/)).toBeVisible();
  });

  it("offers a way back to the index, which the homepage does not", async () => {
    getCollection.mockResolvedValue(collection());
    getArtwork.mockResolvedValue(artwork());
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Estudio en rojo" }),
      ).toBeVisible(),
    );
    // It appears only here: on the homepage the collection title is already the
    // way back, and two links to the same place would be noise.
    expect(screen.getByRole("link", { name: "Index" })).toHaveAttribute(
      "href",
      `/collection/flores-solares-${COLLECTION_ID}`,
    );
  });

  it("never requests the collection's whole list", async () => {
    getCollection.mockResolvedValue(collection());
    getArtwork.mockResolvedValue(artwork());
    renderPage();
    await waitFor(() => expect(getArtwork).toHaveBeenCalled());
    // Only the single work: that saves a round trip, and nothing on this view
    // needs a neighbour — the page offers a link back to the collection and
    // nothing else.
    expect(getCollectionArtworks).not.toHaveBeenCalled();
  });
});

describe("PublicArtworkPage — a protected collection", () => {
  /** The challenge: a Public collection with a password, and no grant held. */
  const passwordRequired = (): ApiRequestError =>
    new ApiRequestError(
      403,
      "password-required",
      "This collection is protected",
      undefined,
      { collectionName: "Flores Solares" },
    );

  it("asks for the password rather than saying the artwork is gone", async () => {
    // A work's own link is not a way around the collection's lock (ADR-0005):
    // the collection read is the gate on this page too, so its challenge is
    // what the visitor gets.
    getCollection.mockRejectedValue(passwordRequired());
    renderPage();
    expect(await screen.findByText("Flores Solares")).toBeVisible();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeVisible();
    expect(getArtwork).not.toHaveBeenCalled();
  });

  it("re-runs the ordinary load on success, collection first and artwork after", async () => {
    getCollection.mockRejectedValueOnce(passwordRequired());
    getCollection.mockResolvedValue(collection());
    getArtwork.mockResolvedValue(artwork());
    unlockCollection.mockResolvedValue(undefined);
    renderPage();

    await userEvent.type(
      await screen.findByLabelText("Password"),
      "open-sesame",
    );
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Estudio en rojo" }),
      ).toBeVisible(),
    );
    expect(unlockCollection).toHaveBeenCalledWith(COLLECTION_ID, "open-sesame");
    expect(getCollection.mock.invocationCallOrder[1]).toBeLessThan(
      getArtwork.mock.invocationCallOrder[0],
    );
  });
});
