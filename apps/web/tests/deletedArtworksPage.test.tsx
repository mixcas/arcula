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
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeletedArtworksPage from "@/components/manage/collection/DeletedArtworksPage";
import { artworkService } from "@/services/artworkService";
import type { Artwork } from "@arcula/shared";

vi.mock("@/services/artworkService", () => ({
  artworkService: {
    getDeletedArtworks: vi.fn(),
    restoreArtwork: vi.fn(),
    bulkRestoreArtworks: vi.fn(),
  },
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

const COLLECTION_PARAM = "deleted-view-collection1";

const deletedArtwork = (
  overrides: Partial<Artwork> & { id: string },
): Artwork => ({
  userId: "user-1",
  title: "Untitled",
  artistName: "Unknown",
  documents: [],
  photos: [],
  collectionId: "collection1",
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
        initialEntries={[`/manage/collection/${COLLECTION_PARAM}/deleted`]}
      >
        <Routes>
          <Route
            path="/manage/collection/:collectionId/deleted"
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

    const newestRow = within(
      rows().find((row) => row.textContent?.includes("Newest Out"))!,
    );
    expect(newestRow.getByText("N. Out")).toBeTruthy();
    // The thumbnail is the primary photo's small square variant.
    expect(newestRow.getByRole("img").getAttribute("src")).toBe(
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
      expect(restoreMock).toHaveBeenCalledWith("collection1", "a"),
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
      expect(bulkRestoreMock).toHaveBeenCalledWith("collection1", ["a", "c"]),
    );
    // The list is refetched, not spliced: the restored rows leave because the
    // server no longer returns them.
    await waitFor(() => expect(getDeletedMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("First Out")).toBeNull());
    expect(screen.queryByText("Third Out")).toBeNull();
    expect(screen.getByText("Second Out")).toBeTruthy();
  });

  it("offers a retry when the read fails, then shows the rows", async () => {
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
});
