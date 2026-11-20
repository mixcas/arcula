// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import * as rtl from "@testing-library/react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PublicSelectionPage from "@/components/catalogue/PublicSelectionPage";
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
const getWorks = vi.fn<() => Promise<Artwork[]>>();
const unlockSelection = vi.fn<() => Promise<void>>();

vi.mock("@/services/selectionService", () => ({
  selectionService: {
    getPublicSelection: (...args: unknown[]) =>
      (getPublicSelection as unknown as (...a: unknown[]) => unknown)(...args),
    getWorks: (...args: unknown[]) =>
      (getWorks as unknown as (...a: unknown[]) => unknown)(...args),
    unlockSelection: (...args: unknown[]) =>
      (unlockSelection as unknown as (...a: unknown[]) => unknown)(...args),
  },
}));

/**
 * Opaque, hyphen-free ids: `parseId` cuts at the last hyphen, so a hyphenated
 * id would be looked up as its own tail and the failure would read as a page
 * bug.
 */
const SELECTION_ID = "SSSSSSSSSSSSSSSSSSSS";

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
  skin: "basicx",
  skinOptions: { transitionSeconds: 0.5 },
  ...overrides,
});

/**
 * One work as the Selection read answers it. `status` is present because the
 * server's envelope carries it; the page must not turn it into a badge, and
 * `availability` is absent because a visitor's document never has one.
 */
const work = (
  id: string,
  title: string,
  status: "draft" | "published" = "published",
): Artwork => ({
  id,
  userId: "UUUUUUUUUUUUUUUUUUUU",
  catalogueId: "CCCCCCCCCCCCCCCCCCCC",
  title,
  artistName: "C. Cas",
  status,
  photos: [],
  documents: [],
});

const AddressProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="address">{location.pathname}</div>;
};

const canonicalPath = `/selection/winter-shortlist-${SELECTION_ID}`;

const renderPage = (entry = canonicalPath) =>
  rtl.render(
    <MantineProvider>
      <MemoryRouter initialEntries={[entry]}>
        <AddressProbe />
        <Routes>
          <Route
            path="/selection/:selectionId"
            element={<PublicSelectionPage />}
          />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );

beforeEach(() => {
  getPublicSelection.mockReset();
  getWorks.mockReset();
  unlockSelection.mockReset();
  // An empty Selection is the default: a test that cares about works says so.
  getWorks.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe("PublicSelectionPage — the states", () => {
  it("renders the Selection in the source Catalogue's skin, empty and named", async () => {
    getPublicSelection.mockResolvedValue(selectionRead());
    renderPage();

    // The subject reaches the skin: its own name and description, and the
    // source Catalogue's name as a credit. There are no works yet, and the page
    // says so in app chrome rather than leaving an unexplained empty stage.
    expect(await screen.findByText("Winter shortlist")).toBeVisible();
    expect(screen.getByText("Twelve works for the fair.")).toBeVisible();
    expect(screen.getByText("Flores Solares")).toBeVisible();
    expect(screen.getByText("This selection has no works yet.")).toBeVisible();
    expect(screen.getByRole("main")).toHaveAttribute("aria-label", "Selection");
  });

  it("never links the source Catalogue", async () => {
    getPublicSelection.mockResolvedValue(selectionRead());
    renderPage();

    await screen.findByText("Flores Solares");
    expect(screen.getByText("Flores Solares").closest("a")).toBeNull();
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/^\/catalogue/);
    }
  });

  it("says the Selection is private when the read is refused", async () => {
    getPublicSelection.mockRejectedValue(
      new ApiRequestError(403, "forbidden", "denied"),
    );
    renderPage();

    expect(await screen.findByText("This selection is private.")).toBeVisible();
    expect(screen.queryByRole("main")).toBeNull();
  });

  it("says it is not available when the Selection is hidden or deleted", async () => {
    // The API folds both to 404, and the service folds 404 to null: the visitor
    // is told the same thing either way, so no address confirms what is hidden.
    getPublicSelection.mockResolvedValue(null);
    renderPage();

    expect(
      await screen.findByText("This selection is not available."),
    ).toBeVisible();
  });

  it("reports a transport failure as an error", async () => {
    getPublicSelection.mockRejectedValue(new TypeError("fetch failed"));
    renderPage();

    expect(
      await screen.findByText(/Could not load this selection/),
    ).toBeVisible();
  });
});

describe("PublicSelectionPage — the works", () => {
  // Deliberately anti-title order, and a Draft first: the server's rule is
  // `position, artworkId`, so anything the page does to this list is a bug.
  const works = [
    work("WWWWWWWWWWWWWWWWWWW2", "Bravo", "draft"),
    work("WWWWWWWWWWWWWWWWWWW1", "Alpha", "published"),
  ];

  it("lists every work in the curator's order, Drafts included and unbadged", async () => {
    getPublicSelection.mockResolvedValue(selectionRead());
    getWorks.mockResolvedValue(works);
    renderPage();

    await screen.findByText("Winter shortlist");
    await waitFor(() =>
      expect(
        screen.getAllByRole("region").map((r) => r.getAttribute("aria-label")),
      ).toEqual(["Bravo", "Alpha"]),
    );

    // A visitor's page never badges a Draft…
    expect(screen.queryByText(/^draft$/i)).toBeNull();
    // …and never prints availability, which the visitor serializer omits.
    expect(screen.queryByText(/for sale|sold|available/i)).toBeNull();
    // The empty-stage sentence belongs to an empty Selection only.
    expect(screen.queryByText("This selection has no works yet.")).toBeNull();
  });

  it("puts every work link under the Selection's own address", async () => {
    getPublicSelection.mockResolvedValue(selectionRead());
    getWorks.mockResolvedValue(works);
    renderPage();

    await screen.findByText("Winter shortlist");
    const links = await screen.findAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    // A Selection page links its own works and nothing of the Catalogue's: the
    // app's brand link is not a document address and is left out of this.
    const hrefs = links
      .map((link) => link.getAttribute("href") ?? "")
      .filter((href) => !href.startsWith("http"));
    expect(hrefs.some((href) => href.startsWith("/selection/"))).toBe(true);
    for (const href of hrefs) {
      expect(href).not.toMatch(/^\/catalogue/);
    }
    expect(screen.getByText("Flores Solares").closest("a")).toBeNull();
  });
});

describe("PublicSelectionPage — the address", () => {
  it("rewrites a bare id address to the slugged one", async () => {
    getPublicSelection.mockResolvedValue(selectionRead());
    renderPage(`/selection/${SELECTION_ID}`);

    await waitFor(() =>
      expect(screen.getByTestId("address").textContent).toBe(canonicalPath),
    );
  });

  it("canonicalises a member's private preview too", async () => {
    // The gate is "the API returned a document", never `isPublic`: a member
    // previewing their own private Selection must still get the legible link.
    getPublicSelection.mockResolvedValue(
      selectionRead({
        selection: {
          id: SELECTION_ID,
          name: "Winter shortlist",
          isPublic: false,
        },
      }),
    );
    renderPage(`/selection/${SELECTION_ID}`);

    await waitFor(() =>
      expect(screen.getByTestId("address").textContent).toBe(canonicalPath),
    );
  });
});

describe("PublicSelectionPage — a protected Selection", () => {
  const passwordRequired = (): ApiRequestError =>
    new ApiRequestError(
      403,
      "password-required",
      "This selection is protected",
      undefined,
      { selectionName: "Winter shortlist" },
    );

  it("shows the lock screen naming the Selection, and reads nothing behind it", async () => {
    getPublicSelection.mockRejectedValue(passwordRequired());
    renderPage();

    expect(await screen.findByText("Winter shortlist")).toBeVisible();
    expect(screen.getByText("This selection is protected")).toBeVisible();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeVisible();
    expect(screen.queryByRole("main")).toBeNull();
  });

  it("attempts the Selection's own unlock and re-runs the read on success", async () => {
    getPublicSelection
      .mockRejectedValueOnce(passwordRequired())
      .mockResolvedValue(selectionRead());
    unlockSelection.mockResolvedValue(undefined);
    renderPage();

    await userEvent.type(
      await screen.findByLabelText("Password"),
      "open-sesame",
    );
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await screen.findByText("Twelve works for the fair.");
    expect(unlockSelection).toHaveBeenCalledWith(SELECTION_ID, "open-sesame");
    // One path to ready: the lock screen's success re-runs the ordinary read,
    // which is also the read a visitor's page runs.
    expect(getPublicSelection.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps a wrong password on the lock screen without a second read", async () => {
    getPublicSelection.mockRejectedValue(passwordRequired());
    unlockSelection.mockRejectedValue(
      new ApiRequestError(403, "invalid-password", "That is not the password"),
    );
    renderPage();

    await userEvent.type(await screen.findByLabelText("Password"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(
      await screen.findByText("That is not the password for this selection."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeVisible();
    expect(getPublicSelection).toHaveBeenCalledTimes(1);
  });
});
