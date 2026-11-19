// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import * as rtl from "@testing-library/react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PublicCataloguePage from "@/components/catalogue/PublicCataloguePage";
import { ApiRequestError } from "@/services/api";
import type { Artwork, Catalogue } from "@arcula/shared";

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

const getCatalogue = vi.fn<() => Promise<Catalogue | null>>();
const getCatalogueArtworks = vi.fn<() => Promise<Artwork[]>>();
const unlockCatalogue = vi.fn<() => Promise<void>>();

vi.mock("@/services/catalogueService", () => ({
  catalogueService: {
    getCatalogue: (...args: unknown[]) =>
      (getCatalogue as unknown as (...a: unknown[]) => unknown)(...args),
    unlockCatalogue: (...args: unknown[]) =>
      (unlockCatalogue as unknown as (...a: unknown[]) => unknown)(...args),
  },
}));

vi.mock("@/services/artworkService", () => ({
  artworkService: {
    getCatalogueArtworks: (...args: unknown[]) =>
      (getCatalogueArtworks as unknown as (...a: unknown[]) => unknown)(
        ...args,
      ),
    getArtwork: vi.fn(),
  },
}));

/**
 * Opaque, hyphen-free ids, not `"catalogue-1"`.
 *
 * `parseId` treats everything after the *last* hyphen as the id, so a
 * hyphenated id would be cut to `"1"` and the page would look up a catalogue
 * that does not exist — a failure that reads as a bug in the page rather than in
 * the test. Real ids are 20 alphanumeric characters.
 */
const CATALOGUE_ID = "AAAAAAAAAAAAAAAAAAAA";

const catalogue = (overrides: Partial<Catalogue> = {}): Catalogue => ({
  id: CATALOGUE_ID,
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
  catalogueId: CATALOGUE_ID,
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
        initialEntries={[`/catalogue/flores-solares-${CATALOGUE_ID}`]}
      >
        <Routes>
          <Route
            path="/catalogue/:catalogueId"
            element={<PublicCataloguePage />}
          />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );

beforeEach(() => {
  getCatalogue.mockReset();
  getCatalogueArtworks.mockReset();
  unlockCatalogue.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("PublicCataloguePage — the reachable states", () => {
  it("renders a section per public artwork", async () => {
    getCatalogue.mockResolvedValue(catalogue());
    getCatalogueArtworks.mockResolvedValue([
      artwork("a1", "Bodegón"),
      artwork("a2", "Estudio"),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getAllByRole("region")).toHaveLength(2));
  });

  it("orders the artworks by title, as the page has always done", async () => {
    // Sorted client-side: the list route answers in no particular order, and a
    // public page should read the same on every visit.
    getCatalogue.mockResolvedValue(catalogue());
    getCatalogueArtworks.mockResolvedValue([
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

  it("says the catalogue is private when the read is denied", async () => {
    getCatalogue.mockRejectedValue(
      new ApiRequestError(403, "forbidden", "denied"),
    );
    renderPage();
    expect(await screen.findByText("This catalogue is private.")).toBeVisible();
    // The sequencing that matters: a private catalogue's artworks are never
    // requested, so its contents cannot leak through the public page.
    expect(getCatalogueArtworks).not.toHaveBeenCalled();
  });

  it("says the catalogue is private for a private catalogue the caller CAN read", async () => {
    // The owner previewing their own private catalogue lands here, and is told
    // the truth rather than "not available" for a document that plainly exists.
    getCatalogue.mockResolvedValue(catalogue({ isPublic: false }));
    renderPage();
    expect(await screen.findByText("This catalogue is private.")).toBeVisible();
    expect(getCatalogueArtworks).not.toHaveBeenCalled();
  });

  it("says not available for a catalogue that does not exist", async () => {
    getCatalogue.mockResolvedValue(null);
    renderPage();
    expect(
      await screen.findByText("This catalogue is not available."),
    ).toBeVisible();
  });

  it("reports a transport failure as an error", async () => {
    getCatalogue.mockRejectedValue(new TypeError("fetch failed"));
    renderPage();
    expect(await screen.findByText(/Could not load/)).toBeVisible();
  });

  it("says so plainly when the catalogue has no artworks", async () => {
    getCatalogue.mockResolvedValue(catalogue());
    // The shape of "every work in it is a draft": the visitor's list is
    // filtered server-side (a draft is absent from it), so the page is handed
    // nothing and must speak about the catalogue's contents rather than about
    // a visibility the works no longer carry.
    getCatalogueArtworks.mockResolvedValue([]);
    renderPage();
    // Deliberately *not* the skin: a skin with an empty stage and a title in the
    // nav reads as a loading failure rather than as an empty catalogue.
    expect(
      await screen.findByText("This catalogue has no artworks yet."),
    ).toBeVisible();
    expect(
      screen.queryByText(/No public artworks in this catalogue/),
    ).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("presents the catalogue's name and description as the skin's subject", async () => {
    // The skin no longer reads the Catalogue document, so these two facts
    // reach it only if this page puts them in the subject. A page that passed
    // only the document would render a nameless stage and no introduction.
    getCatalogue.mockResolvedValue(
      catalogue({ description: "A handful of sunscapes." }),
    );
    getCatalogueArtworks.mockResolvedValue([artwork("a1", "Bodegón")]);
    renderPage();
    await waitFor(() => expect(screen.getAllByRole("region")).toHaveLength(1));
    expect(
      screen.getByRole("link", { name: "Flores Solares" }),
    ).toHaveAttribute("href", `/catalogue/flores-solares-${CATALOGUE_ID}`);
    expect(screen.getByText("A handful of sunscapes.")).toBeVisible();
  });

  it("offers the attribution link in the skin's nav, and no login link", async () => {
    getCatalogue.mockResolvedValue(catalogue());
    getCatalogueArtworks.mockResolvedValue([artwork("a1", "Bodegón")]);
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
    getCatalogue.mockResolvedValue(catalogue());
    getCatalogueArtworks.mockResolvedValue([
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
      `/catalogue/flores-solares-${CATALOGUE_ID}/artwork/bodeg-n-a1`,
    );
  });
});

describe("PublicCataloguePage — a protected catalogue", () => {
  /** The challenge: a Public catalogue with a password, and no grant held. */
  const passwordRequired = (): ApiRequestError =>
    new ApiRequestError(
      403,
      "password-required",
      "This catalogue is protected",
      undefined,
      { catalogueName: "Flores Solares" },
    );

  it("shows the lock screen naming the catalogue, and reads nothing behind it", async () => {
    getCatalogue.mockRejectedValue(passwordRequired());
    renderPage();
    // The name is the point of the challenge: the reader is told what they
    // are unlocking, and the works are not requested until they are in.
    expect(await screen.findByText("Flores Solares")).toBeVisible();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeVisible();
    expect(getCatalogueArtworks).not.toHaveBeenCalled();
  });

  it("re-runs the ordinary load on success, the catalogue first and the list after", async () => {
    getCatalogue.mockRejectedValueOnce(passwordRequired());
    getCatalogue.mockResolvedValue(catalogue());
    getCatalogueArtworks.mockResolvedValue([artwork("a1", "Bodegón")]);
    unlockCatalogue.mockResolvedValue(undefined);
    renderPage();

    await userEvent.type(
      await screen.findByLabelText("Password"),
      "open-sesame",
    );
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() => expect(screen.getAllByRole("region")).toHaveLength(1));
    expect(unlockCatalogue).toHaveBeenCalledWith(CATALOGUE_ID, "open-sesame");
    // One path to ready: the lock screen asks the page to re-run the load a
    // visitor's page runs — so the catalogue read is still the first of the
    // two, and the list is asked only once that read has answered.
    expect(getCatalogue.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(getCatalogue.mock.invocationCallOrder[1]).toBeLessThan(
      getCatalogueArtworks.mock.invocationCallOrder[0],
    );
  });

  it("says the password is wrong, and stays on the lock screen", async () => {
    getCatalogue.mockRejectedValue(passwordRequired());
    unlockCatalogue.mockRejectedValue(
      new ApiRequestError(403, "invalid-password", "That is not the password"),
    );
    renderPage();

    await userEvent.type(await screen.findByLabelText("Password"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(
      await screen.findByText("That is not the password for this catalogue."),
    ).toBeVisible();
    // Still the lock screen: the prompt is still there to try again.
    expect(screen.getByRole("button", { name: "Unlock" })).toBeVisible();
    // A refused attempt is not a new load: nothing was re-read.
    expect(getCatalogue).toHaveBeenCalledTimes(1);
    expect(getCatalogueArtworks).not.toHaveBeenCalled();
  });

  it("keeps a spent window on the lock screen and does not re-read", async () => {
    getCatalogue.mockRejectedValue(passwordRequired());
    // The screen cannot word this one itself: the window is the server's
    // policy, and it states the window without counting down. What this page
    // owns is that the refusal is reported rather than swallowed, and that it
    // is not treated as an unlock.
    unlockCatalogue.mockRejectedValue(
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
    expect(getCatalogue).toHaveBeenCalledTimes(1);
  });
});
