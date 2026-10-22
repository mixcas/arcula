// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import * as rtl from "@testing-library/react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PublicCollectionPage from "@/components/collection/PublicCollectionPage";
import { ApiRequestError } from "@/services/api";
import type { Artwork, Collection } from "@arcula/shared";

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
    getCollectionArtworks: (...args: unknown[]) =>
      (getCollectionArtworks as unknown as (...a: unknown[]) => unknown)(
        ...args,
      ),
    getArtwork: vi.fn(),
  },
}));

/**
 * Opaque, hyphen-free ids, not `"collection-1"`.
 *
 * `parseId` treats everything after the *last* hyphen as the id, so a
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

const artwork = (
  id: string,
  title: string,
  status: Artwork["status"] = "published",
): Artwork => ({
  id,
  userId: "owner-1",
  collectionId: COLLECTION_ID,
  title,
  artistName: "María López",
  status,
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
  getCollectionArtworks.mockReset();
  unlockCollection.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("PublicCollectionPage — the reachable states", () => {
  it("renders a section per public artwork", async () => {
    getCollection.mockResolvedValue(collection());
    getCollectionArtworks.mockResolvedValue([
      artwork("a1", "Bodegón"),
      artwork("a2", "Estudio"),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getAllByRole("region")).toHaveLength(2));
  });

  it("orders the artworks by title, as the page has always done", async () => {
    // Sorted client-side: the list route answers in no particular order, and a
    // public page should read the same on every visit.
    getCollection.mockResolvedValue(collection());
    getCollectionArtworks.mockResolvedValue([
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
      new ApiRequestError(403, "forbidden", "denied"),
    );
    renderPage();
    expect(
      await screen.findByText("This collection is private."),
    ).toBeVisible();
    // The sequencing that matters: a private collection's artworks are never
    // requested, so its contents cannot leak through the public page.
    expect(getCollectionArtworks).not.toHaveBeenCalled();
  });

  it("says the collection is private for a private collection the caller CAN read", async () => {
    // The owner previewing their own private collection lands here, and is told
    // the truth rather than "not available" for a document that plainly exists.
    getCollection.mockResolvedValue(collection({ isPublic: false }));
    renderPage();
    expect(
      await screen.findByText("This collection is private."),
    ).toBeVisible();
    expect(getCollectionArtworks).not.toHaveBeenCalled();
  });

  it("says not available for a collection that does not exist", async () => {
    getCollection.mockResolvedValue(null);
    renderPage();
    expect(
      await screen.findByText("This collection is not available."),
    ).toBeVisible();
  });

  it("reports a transport failure as an error", async () => {
    getCollection.mockRejectedValue(new TypeError("fetch failed"));
    renderPage();
    expect(await screen.findByText(/Failed to load/)).toBeVisible();
  });

  it("says so plainly when the collection has no artworks", async () => {
    getCollection.mockResolvedValue(collection());
    // The shape of "every work in it is a draft": the visitor's list is
    // filtered server-side (a draft is absent from it), so the page is handed
    // nothing and must speak about the collection's contents rather than about
    // a visibility the works no longer carry.
    getCollectionArtworks.mockResolvedValue([]);
    renderPage();
    // Deliberately *not* the skin: a skin with an empty stage and a title in the
    // nav reads as a loading failure rather than as an empty collection.
    expect(
      await screen.findByText("This collection has no artworks yet."),
    ).toBeVisible();
    expect(
      screen.queryByText(/No public artworks in this collection/),
    ).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("offers the attribution link in the skin's nav, and no login link", async () => {
    getCollection.mockResolvedValue(collection());
    getCollectionArtworks.mockResolvedValue([artwork("a1", "Bodegón")]);
    renderPage();
    await waitFor(() => expect(screen.getAllByRole("region")).toHaveLength(1));
    // The nav's right slot holds the attribution link. The owner-only link that
    // would replace it is not built — see the TODO in `BasicxChrome` — so this
    // is what an anonymous visitor sees, and the absence of a login link is
    // asserted.
    const credit = screen.getByRole("link", { name: "Powered by Arcula" });
    expect(credit).toHaveAttribute("href", "https://arcula.art");
    expect(credit).toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("link", { name: /manage|login/i })).toBeNull();
  });

  it("links each footer's title to that artwork's public view", async () => {
    getCollection.mockResolvedValue(collection());
    getCollectionArtworks.mockResolvedValue([
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

describe("PublicCollectionPage — a protected collection", () => {
  /** The challenge: a Public collection with a password, and no grant held. */
  const passwordRequired = (): ApiRequestError =>
    new ApiRequestError(
      403,
      "password-required",
      "This collection is protected",
      undefined,
      { collectionName: "Flores Solares" },
    );

  it("shows the lock screen naming the collection, and reads nothing behind it", async () => {
    getCollection.mockRejectedValue(passwordRequired());
    renderPage();
    // The name is the point of the challenge: the reader is told what they
    // are unlocking, and the works are not requested until they are in.
    expect(await screen.findByText("Flores Solares")).toBeVisible();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeVisible();
    expect(getCollectionArtworks).not.toHaveBeenCalled();
  });

  it("re-runs the ordinary load on success, the collection first and the list after", async () => {
    getCollection.mockRejectedValueOnce(passwordRequired());
    getCollection.mockResolvedValue(collection());
    getCollectionArtworks.mockResolvedValue([artwork("a1", "Bodegón")]);
    unlockCollection.mockResolvedValue(undefined);
    renderPage();

    await userEvent.type(
      await screen.findByLabelText("Password"),
      "open-sesame",
    );
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() => expect(screen.getAllByRole("region")).toHaveLength(1));
    expect(unlockCollection).toHaveBeenCalledWith(COLLECTION_ID, "open-sesame");
    // One path to ready: the lock screen asks the page to re-run the load a
    // visitor's page runs — so the collection read is still the first of the
    // two, and the list is asked only once that read has answered.
    expect(getCollection.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(getCollection.mock.invocationCallOrder[1]).toBeLessThan(
      getCollectionArtworks.mock.invocationCallOrder[0],
    );
  });

  it("says the password is wrong, and stays on the lock screen", async () => {
    getCollection.mockRejectedValue(passwordRequired());
    unlockCollection.mockRejectedValue(
      new ApiRequestError(403, "invalid-password", "That is not the password"),
    );
    renderPage();

    await userEvent.type(await screen.findByLabelText("Password"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(
      await screen.findByText("That is not the password for this collection."),
    ).toBeVisible();
    // Still the lock screen: the prompt is still there to try again.
    expect(screen.getByRole("button", { name: "Unlock" })).toBeVisible();
    // A refused attempt is not a new load: nothing was re-read.
    expect(getCollection).toHaveBeenCalledTimes(1);
    expect(getCollectionArtworks).not.toHaveBeenCalled();
  });

  it("says the window is spent, in the server's words, and stays on the lock screen", async () => {
    getCollection.mockRejectedValue(passwordRequired());
    // The screen cannot word this one itself: the window is the server's
    // policy, and it states the window without counting down.
    unlockCollection.mockRejectedValue(
      new ApiRequestError(
        429,
        "too-many-attempts",
        "Too many failed attempts. Try again once this 10-minute window has passed.",
      ),
    );
    renderPage();

    await userEvent.type(await screen.findByLabelText("Password"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(
      await screen.findByText(/this 10-minute window has passed/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeVisible();
    expect(getCollection).toHaveBeenCalledTimes(1);
  });
});
