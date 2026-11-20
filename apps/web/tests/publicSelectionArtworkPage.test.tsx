// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import * as rtl from "@testing-library/react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PublicSelectionArtworkPage from "@/components/catalogue/PublicSelectionArtworkPage";
import { ApiRequestError } from "@/services/api";
import type { Artwork, SelectionPublicRead } from "@arcula/shared";

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

vi.mock("@mantine/carousel", async () => {
  const { carouselMock } = await import("./helpers/carouselMock");
  return carouselMock();
});

const getPublicSelection = vi.fn<() => Promise<SelectionPublicRead | null>>();
const getArtwork = vi.fn<() => Promise<Artwork | null>>();
const unlockSelection = vi.fn<() => Promise<void>>();

vi.mock("@/services/selectionService", () => ({
  selectionService: {
    getPublicSelection: (...args: unknown[]) =>
      (getPublicSelection as unknown as (...a: unknown[]) => unknown)(...args),
    getArtwork: (...args: unknown[]) =>
      (getArtwork as unknown as (...a: unknown[]) => unknown)(...args),
    unlockSelection: (...args: unknown[]) =>
      (unlockSelection as unknown as (...a: unknown[]) => unknown)(...args),
  },
}));

/** Opaque, hyphen-free ids: `parseId` cuts at the last hyphen. */
const SELECTION_ID = "SSSSSSSSSSSSSSSSSSSS";
const ARTWORK_ID = "AAAAAAAAAAAAAAAAAAAA";

const selectionRead = (
  overrides: Partial<SelectionPublicRead> = {},
): SelectionPublicRead => ({
  selection: {
    id: SELECTION_ID,
    name: "Winter shortlist",
    description: "Twelve works for the fair.",
    isPublic: true,
  },
  catalogueName: "Flores Solares",
  kind: "collection",
  skin: "basicx",
  skinOptions: { transitionSeconds: 0.5 },
  ...overrides,
});

const artwork = (overrides: Partial<Artwork> = {}): Artwork => ({
  id: ARTWORK_ID,
  userId: "UUUUUUUUUUUUUUUUUUUU",
  catalogueId: "CCCCCCCCCCCCCCCCCCCC",
  title: "Bright Field",
  artistName: "C. Cas",
  // A Draft is still readable here: that is the whole point of the Selection's
  // address, and the page must not add a client-side status gate.
  status: "draft",
  photos: [],
  documents: [],
  ...overrides,
});

const AddressProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="address">{location.pathname}</div>;
};

const selectionPath = `/selection/winter-shortlist-${SELECTION_ID}`;
const canonicalPath = `${selectionPath}/artwork/bright-field-${ARTWORK_ID}`;

const renderPage = (
  entry = `/selection/${SELECTION_ID}/artwork/${ARTWORK_ID}`,
) =>
  rtl.render(
    <MantineProvider>
      <MemoryRouter initialEntries={[entry]}>
        <AddressProbe />
        <Routes>
          <Route
            path="/selection/:selectionId/artwork/:artworkId"
            element={<PublicSelectionArtworkPage />}
          />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );

beforeEach(() => {
  getPublicSelection.mockReset();
  getArtwork.mockReset();
  unlockSelection.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("PublicSelectionArtworkPage — the work", () => {
  it("renders one work in the Selection's skin, under the Selection's address", async () => {
    getPublicSelection.mockResolvedValue(selectionRead());
    getArtwork.mockResolvedValue(artwork());
    renderPage();

    // The credit line, the subject and the work all reach the skin.
    expect(await screen.findByText("Flores Solares")).toBeVisible();
    expect(screen.getByText("Winter shortlist")).toBeVisible();
    expect(screen.getByRole("main")).toHaveAttribute("aria-label", "Selection");
    const sections = await screen.findAllByRole("region");
    expect(sections.map((s) => s.getAttribute("aria-label"))).toEqual([
      "Bright Field",
    ]);
    // One work, not the list: the page never fetches the works read.
    expect(getArtwork).toHaveBeenCalledWith(SELECTION_ID, ARTWORK_ID);
  });

  it("canonicalises both address segments in place", async () => {
    getPublicSelection.mockResolvedValue(selectionRead());
    getArtwork.mockResolvedValue(artwork());
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("address").textContent).toBe(canonicalPath),
    );
  });

  it("links only under the Selection's address, never the Catalogue's", async () => {
    getPublicSelection.mockResolvedValue(selectionRead());
    getArtwork.mockResolvedValue(artwork());
    renderPage();

    await screen.findByText("Flores Solares");
    const links = await screen.findAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    // No link points at the Catalogue's page or artwork address; the app's
    // brand link is not a document address and is left out of this.
    const hrefs = links
      .map((link) => link.getAttribute("href") ?? "")
      .filter((href) => !href.startsWith("http"));
    expect(hrefs.some((href) => href.startsWith("/selection/"))).toBe(true);
    for (const href of hrefs) {
      expect(href).not.toMatch(/^\/catalogue/);
    }
    expect(screen.getByText("Flores Solares").closest("a")).toBeNull();
  });

  it("never badges the Draft or prints availability", async () => {
    getPublicSelection.mockResolvedValue(selectionRead());
    getArtwork.mockResolvedValue(artwork({ availability: "available" }));
    renderPage();

    await screen.findByText("Bright Field");
    expect(screen.queryByText(/^draft$/i)).toBeNull();
    expect(screen.queryByText(/for sale|sold|available/i)).toBeNull();
  });
});

describe("PublicSelectionArtworkPage — one not-found", () => {
  it("is not-found for a work the Selection does not curate", async () => {
    getPublicSelection.mockResolvedValue(selectionRead());
    getArtwork.mockResolvedValue(null);
    renderPage();

    expect(
      await screen.findByText("This artwork is not available."),
    ).toBeVisible();
    expect(screen.queryByRole("main")).toBeNull();
  });

  it("is the same not-found for a private or deleted Selection, and reads no work", async () => {
    // The API folds a private Selection and a stamped one into one 404, and the
    // service folds that to null. The page must not try the work read: the
    // Selection's denial happens before the second round trip.
    getPublicSelection.mockResolvedValue(null);
    getArtwork.mockResolvedValue(artwork());
    renderPage();

    expect(
      await screen.findByText("This artwork is not available."),
    ).toBeVisible();
    expect(getArtwork).not.toHaveBeenCalled();
  });

  it("reports a transport failure as an error", async () => {
    getPublicSelection.mockRejectedValue(new TypeError("fetch failed"));
    renderPage();

    expect(
      await screen.findByText(/Could not load this artwork/),
    ).toBeVisible();
  });
});

describe("PublicSelectionArtworkPage — a protected Selection", () => {
  const passwordRequired = (): ApiRequestError =>
    new ApiRequestError(
      403,
      "password-required",
      "This selection is protected",
      undefined,
      { selectionName: "Winter shortlist" },
    );

  it("shows the shared lock screen and reads nothing behind it", async () => {
    getPublicSelection.mockRejectedValue(passwordRequired());
    getArtwork.mockResolvedValue(artwork());
    renderPage();

    expect(
      await screen.findByText("This selection is protected"),
    ).toBeVisible();
    expect(screen.getByText("Winter shortlist")).toBeVisible();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeVisible();
    expect(getArtwork).not.toHaveBeenCalled();
  });

  it("unlocks the Selection and re-runs the same load", async () => {
    getPublicSelection
      .mockRejectedValueOnce(passwordRequired())
      .mockResolvedValue(selectionRead());
    getArtwork.mockResolvedValue(artwork());
    unlockSelection.mockResolvedValue(undefined);
    renderPage();

    await userEvent.type(
      await screen.findByLabelText("Password"),
      "open-sesame",
    );
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await screen.findByText("Bright Field");
    expect(unlockSelection).toHaveBeenCalledWith(SELECTION_ID, "open-sesame");
    expect(getArtwork).toHaveBeenCalledWith(SELECTION_ID, ARTWORK_ID);
  });
});
