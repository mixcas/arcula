// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeletedArtworksPage from "@/components/manage/catalogue/DeletedArtworksPage";
import { artworkService } from "@/services/artworkService";
import { catalogueService } from "@/services/catalogueService";
import { ApiRequestError } from "@/services/api";
import type { Artwork, Catalogue, CatalogueKind } from "@arcula/shared";

vi.mock("@/services/artworkService", () => ({
  artworkService: {
    getDeletedArtworks: vi.fn(),
    restoreArtwork: vi.fn(),
    bulkRestoreArtworks: vi.fn(),
  },
}));

vi.mock("@/services/catalogueService", () => ({
  catalogueService: { getCatalogue: vi.fn() },
}));

// React 19 requires this flag for act() outside a browser environment.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

// eslint-disable-next-line @typescript-eslint/unbound-method
const getDeletedMock = vi.mocked(artworkService.getDeletedArtworks);
// eslint-disable-next-line @typescript-eslint/unbound-method
const restoreMock = vi.mocked(artworkService.restoreArtwork);
// eslint-disable-next-line @typescript-eslint/unbound-method
const bulkRestoreMock = vi.mocked(artworkService.bulkRestoreArtworks);
// eslint-disable-next-line @typescript-eslint/unbound-method
const getCatalogueMock = vi.mocked(catalogueService.getCatalogue);

/** The catalogue the page reads for the fields that decide the badge. */
const catalogue = (
  kind: CatalogueKind,
  overrides: Partial<Catalogue> = {},
): Catalogue => ({
  id: "catalogue1",
  name: "Catalogue",
  kind,
  userId: "user-1",
  isPublic: true,
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 1, nanoseconds: 0 },
  ...overrides,
});

const CATALOGUE_PARAM = "deleted-view-catalogue1";
const OTHER_CATALOGUE_PARAM = "deleted-view-catalogue2";

/**
 * The page plus a trigger that changes only the route's catalogue id. The
 * page instance stays mounted across the switch, which is where a selection
 * can outlive the list it was made on.
 */
const SwitchingPage: React.FC = () => {
  const navigate = useNavigate();
  return (
    <>
      <button
        onClick={() => {
          void navigate(`/manage/catalogue/${OTHER_CATALOGUE_PARAM}/deleted`);
        }}
      >
        Switch catalogue
      </button>
      <DeletedArtworksPage />
    </>
  );
};

const deletedArtwork = (
  overrides: Partial<Artwork> & { id: string },
): Artwork => ({
  userId: "user-1",
  title: "Untitled",
  artistName: "Unknown",
  documents: [],
  photos: [],
  catalogueId: "catalogue1",
  status: "published",
  deletedAt: { seconds: 1767225600, nanoseconds: 0 },
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 2, nanoseconds: 0 },
  ...overrides,
});

const renderPage = () =>
  render(
    <MantineProvider>
      <Notifications />
      <MemoryRouter
        initialEntries={[`/manage/catalogue/${CATALOGUE_PARAM}/deleted`]}
      >
        <Routes>
          <Route
            path="/manage/catalogue/:catalogueId/deleted"
            element={<DeletedArtworksPage />}
          />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );

const rows = (): HTMLElement[] => screen.getAllByRole("row").slice(1);

describe("DeletedArtworksPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    getDeletedMock.mockReset();
    restoreMock.mockReset();
    bulkRestoreMock.mockReset();
    getCatalogueMock.mockReset();
    getCatalogueMock.mockResolvedValue(catalogue("collection"));
    consoleError.mockClear();
    // `matches: query === ""` mirrors Chrome: mantine-datatable resolves each
    // column through `matchMedia("")`, and a stub answering false for
    // everything makes every column vanish.
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("shows each deleted work's thumbnail, title, artist, draft mark and deletion time", async () => {
    getDeletedMock.mockResolvedValue([
      deletedArtwork({
        id: "a",
        title: "Newest Out",
        artistName: "N. Out",
        photos: [
          {
            id: "p1",
            order: 0,
            name: "red.jpg",
            size: 100,
            contentType: "image/jpeg",
            width: 10,
            height: 10,
            original: {
              url: "/api/v1/media?key=original",
              size: 100,
              contentType: "image/jpeg",
            },
            variants: [
              {
                key: "square_sm",
                url: "/api/v1/media?key=thumb",
                width: 10,
                height: 10,
                size: 10,
                contentType: "image/jpeg",
              },
            ],
          },
        ],
      }),
      deletedArtwork({ id: "b", title: "Old Draft", status: "draft" }),
    ]);
    renderPage();

    await screen.findByText("Newest Out");

    const newestRowElement = rows().find((row) =>
      row.textContent?.includes("Newest Out"),
    )!;
    const newestRow = within(newestRowElement);
    expect(newestRow.getByText("N. Out")).toBeTruthy();
    // The thumbnail is the primary photo's small square variant. It is
    // decorative (`alt=""`), so it has no `img` role to query by; read the
    // element directly.
    expect(newestRowElement.querySelector("img")?.getAttribute("src")).toBe(
      "/api/v1/media?key=thumb",
    );
    // The relative label is the reading; `<time>` carries the exact instant
    // for the hover and for assistive technology.
    expect(
      newestRow
        .getByText((_, element) => element?.tagName === "TIME")
        .getAttribute("datetime"),
    ).toBe("2026-01-01T00:00:00.000Z");
    expect(newestRow.queryByText("Draft")).toBeNull();

    const draftRow = within(
      rows().find((row) => row.textContent?.includes("Old Draft"))!,
    );
    expect(draftRow.getByText("Draft")).toBeTruthy();
  });

  it("badges a deleted work's market state when the catalogue records it", async () => {
    // The Deleted view is a manage view: it shows the same availability badge
    // the live table does, and the Catalogue's configuration decides it. An
    // Inventory records the field by default.
    getCatalogueMock.mockResolvedValue(catalogue("inventory"));
    getDeletedMock.mockResolvedValue([
      deletedArtwork({ id: "a", title: "Sold Out", availability: "sold" }),
    ]);
    renderPage();

    const row = within(
      (await screen.findByText("Sold Out")).closest("tr") as HTMLElement,
    );
    expect(await row.findByText("Sold")).toBeTruthy();
  });

  it("badges it for a Collection that switched Availability on", async () => {
    // The flattening: the badge follows the configuration, so a Kind whose
    // default is off still shows the state it records.
    getCatalogueMock.mockResolvedValue(
      catalogue("collection", { artworkFields: { availability: true } }),
    );
    getDeletedMock.mockResolvedValue([
      deletedArtwork({ id: "a", title: "For Sale", availability: "reserved" }),
    ]);
    renderPage();

    const row = within(
      (await screen.findByText("For Sale")).closest("tr") as HTMLElement,
    );
    expect(await row.findByText("Reserved")).toBeTruthy();
  });

  it("shows no badge on a catalogue that does not record it", async () => {
    // A Collection records what is owned; a stored state must not be shown.
    getDeletedMock.mockResolvedValue([
      deletedArtwork({ id: "a", title: "Owned", availability: "sold" }),
    ]);
    renderPage();

    await screen.findByText("Owned");
    // The catalogue read has resolved by now: the fields settle before
    // anything could badge.
    await waitFor(() => expect(getCatalogueMock).toHaveBeenCalled());
    expect(screen.queryByText("Sold")).toBeNull();
  });

  it("shows no badge on a Portfolio, whose defaults leave Availability off", async () => {
    // The other direction of the same rule: a Kind whose default is off shows
    // no badge until the member switches the field on.
    getCatalogueMock.mockResolvedValue(catalogue("portfolio"));
    getDeletedMock.mockResolvedValue([
      deletedArtwork({ id: "a", title: "Hidden", availability: "sold" }),
    ]);
    renderPage();

    await screen.findByText("Hidden");
    await waitFor(() => expect(getCatalogueMock).toHaveBeenCalled());
    expect(screen.queryByText("Sold")).toBeNull();
  });

  it("restores one row through the single route and refetches the list", async () => {
    const user = userEvent.setup();
    getDeletedMock
      .mockResolvedValueOnce([
        deletedArtwork({ id: "a", title: "Bring Me Back" }),
        deletedArtwork({ id: "b", title: "Leave Me" }),
      ])
      .mockResolvedValueOnce([deletedArtwork({ id: "b", title: "Leave Me" })]);
    restoreMock.mockResolvedValue({ restored: true });
    renderPage();

    const row = within(
      (await screen.findByText("Bring Me Back")).closest("tr")!,
    );
    await user.click(row.getByRole("button", { name: "Restore" }));

    // No confirmation: the click is the write.
    await waitFor(() =>
      expect(restoreMock).toHaveBeenCalledWith("catalogue1", "a"),
    );
    // The list is refetched, not spliced: the restored row leaves because the
    // server no longer returns it.
    await waitFor(() => expect(getDeletedMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Bring Me Back")).toBeNull());
    expect(screen.getByText("Leave Me")).toBeTruthy();
  });

  it("restores the ticked rows in one call and refetches the list", async () => {
    const user = userEvent.setup();
    getDeletedMock
      .mockResolvedValueOnce([
        deletedArtwork({ id: "a", title: "First Out" }),
        deletedArtwork({ id: "b", title: "Second Out" }),
        deletedArtwork({ id: "c", title: "Third Out" }),
      ])
      .mockResolvedValueOnce([
        deletedArtwork({ id: "b", title: "Second Out" }),
      ]);
    bulkRestoreMock.mockResolvedValue({ restored: 2 });
    renderPage();

    await screen.findByText("First Out");
    // [0] is the header's "select all"; the rest are the rows.
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[1]);
    await user.click(checkboxes[3]);
    await user.click(screen.getByRole("button", { name: "Restore selected" }));

    // No confirmation: the click is the write, with exactly the ticked ids —
    // not the whole list and not the unticked row between them.
    await waitFor(() =>
      expect(bulkRestoreMock).toHaveBeenCalledWith("catalogue1", ["a", "c"]),
    );
    // The list is refetched, not spliced: the restored rows leave because the
    // server no longer returns them.
    await waitFor(() => expect(getDeletedMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("First Out")).toBeNull());
    expect(screen.queryByText("Third Out")).toBeNull();
    expect(screen.getByText("Second Out")).toBeTruthy();
  });

  it("drops a previous catalogue's ticks when the route switches", async () => {
    const user = userEvent.setup();
    getDeletedMock
      .mockResolvedValueOnce([
        deletedArtwork({ id: "a", title: "First Catalogue" }),
      ])
      .mockResolvedValueOnce([
        deletedArtwork({ id: "c", title: "Other Catalogue" }),
      ]);
    render(
      <MantineProvider>
        <MemoryRouter
          initialEntries={[`/manage/catalogue/${CATALOGUE_PARAM}/deleted`]}
        >
          <Routes>
            <Route
              path="/manage/catalogue/:catalogueId/deleted"
              element={<SwitchingPage />}
            />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    await screen.findByText("First Catalogue");
    await user.click(screen.getAllByRole("checkbox")[1]);
    expect(
      screen.getByRole("button", { name: "Restore selected" }),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Switch catalogue" }));
    await screen.findByText("Other Catalogue");

    // The first catalogue's tick is not in the new list, so the first load
    // prunes it: a bulk action here cannot carry a row from the old one.
    expect(
      screen.queryByRole("button", { name: "Restore selected" }),
    ).toBeNull();
  });

  it("offers a retry when the transport fails, then shows the rows", async () => {
    const user = userEvent.setup();
    getDeletedMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([
        deletedArtwork({ id: "a", title: "Back Again" }),
      ]);
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Back Again")).toBeTruthy();
    expect(getDeletedMock).toHaveBeenCalledTimes(2);
  });

  // A refusal is not a flaky connection: retrying cannot change it, so the
  // page must not offer a button that only repeats the same answer.
  it.each([403, 404])(
    "treats a %i answer as unavailable, without a retry",
    async (status) => {
      getDeletedMock.mockRejectedValue(
        new ApiRequestError(status, "refused", "Not available"),
      );
      const { container } = renderPage();
      const page = within(container);

      expect(await page.findByRole("alert")).toBeInTheDocument();
      expect(page.queryByRole("button", { name: "Retry" })).toBeNull();
      expect(getDeletedMock).toHaveBeenCalledTimes(1);
    },
  );

  it("does not claim a catalogue is empty when the route names none", async () => {
    // No `:catalogueId` param: nothing can be fetched, and the empty state's
    // "nothing has been deleted" would be a claim about a catalogue that was
    // never named.
    const { container } = render(
      <MantineProvider>
        <MemoryRouter initialEntries={["/deleted"]}>
          <DeletedArtworksPage />
        </MemoryRouter>
      </MantineProvider>,
    );
    const page = within(container);

    expect(await page.findByRole("alert")).toBeInTheDocument();
    expect(
      page.queryByText("Nothing has been deleted from this catalogue."),
    ).toBeNull();
    expect(getDeletedMock).not.toHaveBeenCalled();
  });

  it("refetches after zero restores without claiming none moved", async () => {
    const user = userEvent.setup();
    getDeletedMock
      .mockResolvedValueOnce([deletedArtwork({ id: "a", title: "Still Out" })])
      .mockResolvedValueOnce([]);
    bulkRestoreMock.mockResolvedValue({ restored: 0 });
    renderPage();

    await screen.findByText("Still Out");
    await user.click(screen.getAllByRole("checkbox")[1]);
    await user.click(screen.getByRole("button", { name: "Restore selected" }));

    // The server's count is zero because another tab already restored it: the
    // list still refetches, and the toast must not read "0 artworks are back".
    await waitFor(() => expect(getDeletedMock).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText("Nothing has been deleted from this catalogue."),
    ).toBeTruthy();
    expect(
      screen.queryByText("0 artworks are back in the catalogue."),
    ).toBeNull();
  });
});
