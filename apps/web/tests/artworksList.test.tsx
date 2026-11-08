// @vitest-environment jsdom
import React from "react";
// Registers the DOM matchers (`toBeDisabled`, …) with vitest's expect.
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
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ArtworksList from "@/components/manage/collection/ArtworksList";
import { artworkService } from "@/services/artworkService";
import type { Artwork } from "@arcula/shared";

vi.mock("@/services/artworkService", () => ({
  artworkService: { softDeleteArtworks: vi.fn() },
}));

// React 19 requires this flag for act() outside a browser environment.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The failure test below drives the component's real error path, and
// `artworkService.softDeleteArtworks` reports a rejected write with
// `console.error`. Left unstubbed that lands on stderr during the web suite —
// so a *passing* run prints a red stack trace and trains everyone to ignore
// the one line that matters. Captured instead of leaked; that test asserts on
// it.
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

// mantine-datatable measures its scroll viewport on mount to drive column
// widths, and jsdom implements no ResizeObserver. Stubbed in tests/setup.ts,
// which runs before this file's module graph, so both the table and Mantine's
// own SegmentedControl indicator find one.

// eslint-disable-next-line @typescript-eslint/unbound-method
const softDeleteMock = vi.mocked(artworkService.softDeleteArtworks);

const artwork = (overrides: Partial<Artwork> & { id: string }): Artwork => ({
  userId: "user-1",
  title: "Untitled",
  artistName: "Unknown",
  documents: [],
  photos: [],
  collectionId: "collection1",
  status: "published",
  deletedAt: null,
  ...overrides,
});

const renderList = (props: ListProps) => render(<ListTree {...props} />);

interface ListProps {
  artworks: Artwork[];
  onDeleted?: () => Promise<void> | void;
  /** The committed Collection search; "" or absent means no search. */
  searchQuery?: string;
  /** A list read is in flight, with the previous rows still on screen. */
  fetching?: boolean;
  /** False until the first list read has answered, success or failure. */
  listSettled?: boolean;
  /** The list read failed; the previous rows stay when there are any. */
  searchError?: string | null;
  onRetry?: () => void;
  onClearSearch?: () => void;
}

const ListTree: React.FC<ListProps> = ({
  artworks,
  onDeleted,
  searchQuery,
  fetching,
  listSettled,
  searchError,
  onRetry,
  onClearSearch,
}) => (
  <MantineProvider>
    <ModalsProvider>
      <Notifications />
      <MemoryRouter>
        <ArtworksList
          artworks={artworks}
          collectionParam="my-collection-collection1"
          onDeleted={onDeleted ?? vi.fn()}
          searchQuery={searchQuery}
          fetching={fetching}
          listSettled={listSettled}
          searchError={searchError}
          onRetry={onRetry}
          onClearSearch={onClearSearch}
        />
      </MemoryRouter>
    </ModalsProvider>
  </MantineProvider>
);

// Row order as rendered, one label per row. The datatable renders records
// verbatim, so this is the only way to see what the caller-side sort/pagination
// actually produced. Case-insensitive because a fixture title is lowercase on
// purpose.
const visibleTitles = (): string[] =>
  screen
    .getAllByRole("row")
    .slice(1) // drop the header row
    .map((row) => row.textContent?.match(/art \d+/i)?.[0] ?? "");

// Card order as rendered: the Grid's list items, each named by its title.
const cardTitles = (): string[] =>
  screen
    .getAllByRole("listitem")
    .map((item) => item.textContent?.match(/art \d+/i)?.[0] ?? "");

// The confirm dialog element. Scoping queries to it is what disambiguates the
// dialog's own "Delete" button from the per-row ones; the last one wins because
// the dialog is mounted last.
const dialogEl = async () => {
  const found = await screen.findAllByRole("dialog");
  return found[found.length - 1];
};

describe("ArtworksList", () => {
  // Testing Library's automatic cleanup only registers itself when a global
  // `afterEach` exists, and this project runs vitest without globals. Without
  // this, every render stays in the document and the next test's queries match
  // rows and dialogs from the previous one.
  afterEach(cleanup);

  beforeEach(() => {
    softDeleteMock.mockReset();
    softDeleteMock.mockResolvedValue(undefined);
    // The list reads its remembered view and sort from browser storage on
    // mount, so a test that does not say what is stored must start from
    // nothing — otherwise a previous test's Grid choice leaks into this one.
    localStorage.clear();
    // jsdom has no matchMedia, which MantineProvider reads when resolving the
    // default color scheme on mount.
    //
    // The `matches` answer matters more than it looks: mantine-datatable
    // resolves each column's `visibleMediaQuery` through Mantine's
    // useMediaQuery, and for a column without one it calls
    // `window.matchMedia("")` in an effect, replacing its optimistic `true`
    // with the stub's answer. Chrome answers an empty query with
    // `matches: true` (verified against Chrome via matchMedia("")), so a stub
    // that answers false for everything — the usual Mantine snippet — makes
    // every column disappear and leaves a table with only its selection
    // column. Mirror the browser.
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

  it("sorts by title, case- and number-insensitively, and paginates the whole set", () => {
    // Deliberately unsorted input, with "art 2" before "Art 10" so a plain
    // lexicographic sort would put 10 first, and mixed case to prove the
    // collation is not byte order.
    const artworks = [
      artwork({ id: "c", title: "Art 10" }),
      artwork({ id: "a", title: "art 2" }),
      artwork({ id: "b", title: "Art 1" }),
    ];
    renderList({ artworks });
    expect(visibleTitles()).toEqual(["Art 1", "art 2", "Art 10"]);
  });

  it("re-sorts the whole dataset when another column is clicked", async () => {
    const user = userEvent.setup();
    // Two pages of rows, so the offset a header click must clear is real: a
    // reorder that left the page where it was would land on a slice of the new
    // order rather than its first page.
    const artworks = Array.from({ length: 30 }, (_, i) =>
      artwork({
        id: `w${String(i).padStart(2, "0")}`,
        title: `Art ${String(i + 1).padStart(2, "0")}`,
        // Reversed, so artist order is the exact inverse of title order.
        artistName: `Artist ${String(30 - i).padStart(2, "0")}`,
      }),
    );
    renderList({ artworks });

    await user.click(screen.getByRole("button", { name: "2" }));
    await waitFor(() => expect(visibleTitles()[0]).toBe("Art 26"));

    await user.click(screen.getByText("Artist Name"));

    // Artist order from its first page: not the title order the table started
    // in, and not page 2 of it.
    await waitFor(() =>
      expect(visibleTitles().slice(0, 3)).toEqual([
        "Art 30",
        "Art 29",
        "Art 28",
      ]),
    );
  });

  it("slices the sorted set into pages, counting the whole set", async () => {
    const user = userEvent.setup();
    // 30 rows against a 25-row page: the fixture has to be larger than the
    // page for pagination to be observable at all, and 25 is the default now.
    const artworks = Array.from({ length: 30 }, (_, i) =>
      artwork({ id: `w${i}`, title: `Art ${String(i + 1).padStart(2, "0")}` }),
    );
    renderList({ artworks });

    // The first page holds 25 of the 30, and the count is over the whole set.
    expect(visibleTitles()).toHaveLength(25);
    expect(visibleTitles()).not.toContain("Art 26");
    expect(screen.getByText("30 artworks")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "2" }));
    await waitFor(() =>
      expect(visibleTitles()).toEqual([
        "Art 26",
        "Art 27",
        "Art 28",
        "Art 29",
        "Art 30",
      ]),
    );
  });

  it("marks a draft artwork in its title cell, and leaves a published one unmarked", () => {
    renderList({
      artworks: [
        artwork({ id: "a", title: "Art 1", status: "draft" }),
        artwork({ id: "b", title: "Art 2", status: "published" }),
      ],
    });
    const rows = screen.getAllByRole("row").slice(1);
    // One badge for the one draft, next to its own title rather than the
    // other row's — the mark is an attribute of a work, not a table legend.
    expect(within(rows[0]).getByText("Draft")).toBeTruthy();
    expect(within(rows[1]).queryByText("Draft")).toBeNull();
  });

  it("shows the first photo as a small square thumbnail, and nothing without one", () => {
    renderList({
      artworks: [
        artwork({
          id: "a",
          title: "Art 1",
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
        artwork({ id: "b", title: "Art 2" }),
      ],
    });

    const [withPhoto, withoutPhoto] = screen.getAllByRole("row").slice(1);
    const thumbnail = withPhoto.querySelector("img");
    // The primary photo's small square variant, which is what makes a row
    // recognisable before its title is read.
    expect(thumbnail?.getAttribute("src")).toBe("/api/v1/media?key=thumb");
    // Decorative: the title in the next cell already names the work. Lazy:
    // a fifty-row page must not fetch fifty images on mount.
    expect(thumbnail?.getAttribute("alt")).toBe("");
    expect(thumbnail?.getAttribute("loading")).toBe("lazy");
    expect(withoutPhoto.querySelector("img")).toBeNull();
  });

  it("soft-deletes one artwork after confirmation and refetches", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    renderList({
      artworks: [artwork({ id: "a", title: "Art 1" })],
      onDeleted,
    });

    // View is the public page for this one artwork. Asserted for its href
    // rather than merely that it is enabled: the link is the only thing in this
    // table that leaves the app, so a wrong path here is silent — the button
    // still looks right and only the destination is wrong.
    // The collection param is reused verbatim in the public URL, the same way
    // the Edit link reuses it — it is the "{slug}-{id}" segment the manage route
    // already carries, and the public route parses the id back out of it.
    const view = screen.getByRole("link", { name: "View" });
    expect(view.getAttribute("href")).toBe(
      "/collection/my-collection-collection1/artwork/art-1-a",
    );
    // A new tab, so the owner can check the public page without losing their
    // place in this one. `noopener` is asserted because it is not optional:
    // without it the opened page gets a handle on this window.
    expect(view.getAttribute("target")).toBe("_blank");
    expect(view.getAttribute("rel")).toBe("noopener noreferrer");

    await user.click(screen.getByRole("button", { name: "Delete" }));

    // Nothing is written until the dialog is confirmed.
    expect(softDeleteMock).not.toHaveBeenCalled();
    const scope = within(await dialogEl());
    expect(scope.getByText(/soft delete/i)).toBeTruthy();

    await user.click(scope.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(softDeleteMock).toHaveBeenCalledWith("collection1", ["a"]),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    // The dialog closes on success and the toast confirms it.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(/artwork was removed/)).toBeTruthy();
  });

  it("cancelling the dialog deletes nothing and keeps the selection", async () => {
    const user = userEvent.setup();
    renderList({
      artworks: [
        artwork({ id: "a", title: "Art 1" }),
        artwork({ id: "b", title: "Art 2" }),
      ],
    });

    // [0] is the header's "select all"; the rest are the rows.
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[1]);
    expect(screen.getByText(/1 selected/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    const scope = within(await dialogEl());
    await user.click(scope.getByRole("button", { name: "Cancel" }));

    expect(softDeleteMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(/1 selected/)).toBeTruthy();
  });

  it("soft-deletes every selected row in one call", async () => {
    const user = userEvent.setup();
    renderList({
      artworks: [
        artwork({ id: "a", title: "Art 1" }),
        artwork({ id: "b", title: "Art 2" }),
        artwork({ id: "c", title: "Art 3" }),
      ],
    });

    // [0] is the header's "select all"; the rest are the rows.
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[1]);
    await user.click(checkboxes[2]);
    expect(screen.getByText(/2 selected/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    const scope = within(await dialogEl());
    await user.click(scope.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(softDeleteMock).toHaveBeenCalledWith("collection1", ["a", "b"]),
    );
    // The selection is cleared once the write lands, so a second batch delete
    // cannot silently reuse stale ids.
    await waitFor(() => expect(screen.queryByText(/selected/)).toBeNull());
  });

  it("keeps the dialog open and explains itself when the delete fails", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    softDeleteMock.mockRejectedValue(new Error("offline"));
    renderList({
      artworks: [artwork({ id: "a", title: "Art 1" })],
      onDeleted,
    });

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const scope = within(await dialogEl());
    await user.click(scope.getByRole("button", { name: "Delete" }));

    // Still open, with the reason in place of the confirmation copy, and the
    // button live again so the user can retry.
    expect(await scope.findByText(/Nothing was deleted/)).toBeTruthy();
    expect(scope.getByRole("button", { name: "Delete" })).toBeEnabled();
    expect(onDeleted).not.toHaveBeenCalled();
    // "Explains itself" is only half a claim if the reason never reaches the
    // console; the dialog copy is the part a user can see.
    expect(consoleError).toHaveBeenCalledWith(
      "Error deleting artworks:",
      expect.objectContaining({ message: "offline" }),
    );
  });

  it("counts a search's matches and leaves the plain count alone", () => {
    const { rerender } = renderList({
      artworks: [artwork({ id: "a", title: "Art 1" })],
      searchQuery: "art",
    });
    // Singular, because "Found 1 artworks" is how this reads when it is wrong.
    expect(screen.getByText("Found 1 artwork")).toBeTruthy();

    rerender(
      <ListTree
        artworks={[
          artwork({ id: "a", title: "Art 1" }),
          artwork({ id: "b", title: "Art 2" }),
        ]}
        searchQuery="art"
      />,
    );
    expect(screen.getByText("Found 2 artworks")).toBeTruthy();

    // No query: the collection's own count, which the page keeps today.
    rerender(
      <ListTree
        artworks={[
          artwork({ id: "a", title: "Art 1" }),
          artwork({ id: "b", title: "Art 2" }),
        ]}
      />,
    );
    expect(screen.getByText("2 artworks")).toBeTruthy();
  });

  it("shows the no-results panel instead of the empty-collection copy under a search", async () => {
    const user = userEvent.setup();
    const onClearSearch = vi.fn();
    renderList({
      artworks: [],
      searchQuery: "picasso",
      fetching: false,
      onClearSearch,
    });

    // The quoted search term is the state under test; Clear search is a live
    // action, not a caption.
    expect(screen.getByText("No artworks match “picasso”.")).toBeTruthy();
    // A completed search that matched nothing is not an empty collection.
    expect(
      screen.queryByText("No artworks in this collection yet."),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });

  it("keeps the empty-collection copy when no search is active", () => {
    renderList({ artworks: [] });

    expect(
      screen.getByText("No artworks in this collection yet."),
    ).toBeTruthy();
    expect(screen.queryByText(/No artworks match/)).toBeNull();
  });

  it("shows a searching state rather than a completed answer on the first search", () => {
    renderList({ artworks: [], searchQuery: "picasso", fetching: true });

    // Neither answer is known yet, so neither published state may appear.
    expect(screen.queryByText(/No artworks match/)).toBeNull();
    expect(
      screen.queryByText("No artworks in this collection yet."),
    ).toBeNull();
    expect(screen.getByText("Searching…")).toBeTruthy();
  });

  it("keeps the previous rows visible while a new search is in flight", () => {
    renderList({
      artworks: [artwork({ id: "a", title: "Art 1" })],
      searchQuery: "art",
      fetching: true,
    });

    expect(screen.getByText("Art 1")).toBeTruthy();
    // And the read is visibly still running: dropping the `fetching` wiring
    // would leave the old rows looking like this search's answer.
    expect(screen.getByText("Updating results…")).toBeTruthy();
  });

  it("does not answer a search before the first list read settles", () => {
    renderList({
      artworks: [],
      searchQuery: "picasso",
      listSettled: false,
    });

    // Neither published answer is known yet, with no request even in flight.
    expect(screen.queryByText(/No artworks match/)).toBeNull();
    expect(
      screen.queryByText("No artworks in this collection yet."),
    ).toBeNull();
    expect(screen.getByText("Searching…")).toBeTruthy();
  });

  it("returns to page 1 when the query changes", async () => {
    const user = userEvent.setup();
    const artworks = Array.from({ length: 30 }, (_, i) =>
      artwork({ id: `w${i}`, title: `Art ${String(i + 1).padStart(2, "0")}` }),
    );
    const { rerender } = renderList({ artworks });

    await user.click(screen.getByRole("button", { name: "2" }));
    await waitFor(() => expect(visibleTitles()[0]).toBe("Art 26"));

    rerender(<ListTree artworks={artworks} searchQuery="art" />);

    await waitFor(() => expect(visibleTitles()[0]).toBe("Art 01"));
    expect(visibleTitles()).not.toContain("Art 26");
  });

  it("clears the row selection when the query changes", async () => {
    const user = userEvent.setup();
    const artworks = [
      artwork({ id: "a", title: "Art 1" }),
      artwork({ id: "b", title: "Art 2" }),
    ];
    const { rerender } = renderList({ artworks });

    // [0] is the header's "select all"; the rest are the rows.
    await user.click(screen.getAllByRole("checkbox")[1]);
    expect(screen.getByText(/1 selected/)).toBeTruthy();

    rerender(<ListTree artworks={artworks} searchQuery="art" />);

    // Acting on rows the new result set does not show is what this prevents.
    await waitFor(() => expect(screen.queryByText(/selected/)).toBeNull());
    expect(
      screen.queryByRole("button", { name: "Delete selected" }),
    ).toBeNull();
  });

  it("starts at page 1 with no selection when a query returns to an earlier value", async () => {
    const user = userEvent.setup();
    const artworks = Array.from({ length: 30 }, (_, i) =>
      artwork({ id: `w${i}`, title: `Art ${String(i + 1).padStart(2, "0")}` }),
    );
    const { rerender } = renderList({ artworks });

    await user.click(screen.getByRole("button", { name: "2" }));
    await waitFor(() => expect(visibleTitles()[0]).toBe("Art 26"));
    // [0] is the header's "select all"; the rest are the rows.
    await user.click(screen.getAllByRole("checkbox")[1]);
    expect(screen.getByText(/1 selected/)).toBeTruthy();

    rerender(<ListTree artworks={artworks} searchQuery="art" />);
    await waitFor(() => expect(visibleTitles()[0]).toBe("Art 01"));

    // Back to the first query: a new query transition, not a return to the
    // page and selection it had under that value.
    rerender(<ListTree artworks={artworks} />);
    await waitFor(() => expect(visibleTitles()[0]).toBe("Art 01"));
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it("keeps the chosen sort when the query changes", async () => {
    const user = userEvent.setup();
    const artworks = [
      artwork({ id: "a", title: "Art 1", artistName: "Braque" }),
      artwork({ id: "b", title: "Art 2", artistName: "abbey" }),
      artwork({ id: "c", title: "Art 3", artistName: "Caillebotte" }),
    ];
    const { rerender } = renderList({ artworks });

    await user.click(screen.getByText("Artist Name"));
    await waitFor(() =>
      expect(visibleTitles()).toEqual(["Art 2", "Art 1", "Art 3"]),
    );

    rerender(<ListTree artworks={artworks} searchQuery="art" />);

    // Searching must not reorder the rows being read; a reset would put these
    // back in title order.
    await waitFor(() =>
      expect(visibleTitles()).toEqual(["Art 2", "Art 1", "Art 3"]),
    );
  });

  it("keeps the previous rows and offers Retry when the search fails", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderList({
      artworks: [artwork({ id: "a", title: "Art 1" })],
      searchQuery: "art",
      searchError: "Failed to search artworks",
      onRetry,
    });

    expect(screen.getByText("Art 1")).toBeTruthy();
    expect(screen.getByText("Failed to search artworks")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("replaces the table with the failure when there are no previous rows", () => {
    renderList({
      artworks: [],
      searchQuery: "art",
      searchError: "Failed to search artworks",
      onRetry: vi.fn(),
    });

    expect(screen.getByText("Failed to search artworks")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    // No table answers, and no state is invented in its place.
    expect(screen.queryByRole("table")).toBeNull();
    expect(
      screen.queryByText("No artworks in this collection yet."),
    ).toBeNull();
    expect(screen.queryByText(/No artworks match/)).toBeNull();
  });

  describe("the Grid view", () => {
    // Puts the list in the Grid as a returning visitor would find it, so a
    // test is about the state that follows and not about toggling first.
    const startInGrid = () =>
      localStorage.setItem(
        "arcula.userSettings",
        JSON.stringify({
          version: 1,
          artworksView: "grid",
          artworksSort: "title-asc",
        }),
      );

    // The Grid segment of the icon-only toggle, by the name its tooltip and
    // aria-label share.
    const gridSegment = () => screen.getByRole("radio", { name: "Grid" });
    const tableSegment = () => screen.getByRole("radio", { name: "Table" });

    it("toggles to cards and remembers the choice", async () => {
      const user = userEvent.setup();
      const artworks = [
        artwork({ id: "a", title: "Art 1", artistName: "Braque" }),
        artwork({ id: "b", title: "Art 2", artistName: "Abbey" }),
      ];
      renderList({ artworks });

      // Table is the default: a stored plan of "grid" is what this test
      // changes, not what it starts from.
      expect(screen.getByRole("table")).toBeTruthy();
      expect(tableSegment()).toBeChecked();

      await user.click(gridSegment());

      // The cards carry the work's identity, in sorted order.
      await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
      expect(cardTitles()).toEqual(["Art 1", "Art 2"]);
      expect(gridSegment()).toBeChecked();

      // Remembered for the next visit and the next collection: the one key
      // holds the view, and the sort it did not touch keeps its value.
      expect(
        JSON.parse(localStorage.getItem("arcula.userSettings") ?? "null"),
      ).toEqual({
        version: 1,
        artworksView: "grid",
        artworksSort: "title-asc",
      });
    });

    it("starts in the remembered view", () => {
      startInGrid();
      renderList({ artworks: [artwork({ id: "a", title: "Art 1" })] });

      expect(gridSegment()).toBeChecked();
      expect(screen.queryByRole("table")).toBeNull();
      expect(cardTitles()).toEqual(["Art 1"]);
    });

    it("falls back to the table when the stored settings are corrupt", () => {
      localStorage.setItem("arcula.userSettings", "{not json");
      renderList({ artworks: [artwork({ id: "a", title: "Art 1" })] });

      expect(screen.getByRole("table")).toBeTruthy();
      expect(tableSegment()).toBeChecked();
    });

    it("keeps the page and the selection when the view is toggled", async () => {
      const user = userEvent.setup();
      const artworks = Array.from({ length: 30 }, (_, i) =>
        artwork({
          id: `w${i}`,
          title: `Art ${String(i + 1).padStart(2, "0")}`,
        }),
      );
      renderList({ artworks });

      // [0] is the header's "select all"; the rest are the rows.
      await user.click(screen.getAllByRole("checkbox")[1]);
      await user.click(screen.getByRole("button", { name: "2" }));
      await waitFor(() => expect(visibleTitles()[0]).toBe("Art 26"));

      await user.click(gridSegment());

      // The same selection and the same page slice — a toggle is a change of
      // presentation only.
      await waitFor(() => expect(cardTitles()).toHaveLength(5));
      expect(cardTitles()[0]).toBe("Art 26");
      expect(screen.getByText(/1 selected/)).toBeTruthy();
    });

    it("dims the cards rather than emptying them while a read is in flight", async () => {
      startInGrid();
      const { rerender } = renderList({
        artworks: [artwork({ id: "a", title: "Art 1" })],
      });

      expect(screen.getByRole("list").getAttribute("aria-busy")).toBeNull();

      rerender(
        <ListTree
          artworks={[artwork({ id: "a", title: "Art 1" })]}
          searchQuery="art"
          fetching
        />,
      );

      await waitFor(() =>
        expect(screen.getByRole("list").getAttribute("aria-busy")).toBe("true"),
      );
      expect(cardTitles()).toEqual(["Art 1"]);
    });

    it("pages the cards under the grid at the page size", async () => {
      const user = userEvent.setup();
      startInGrid();
      // 30 works is two pages of the default 25; the second holds the rest.
      const artworks = Array.from({ length: 30 }, (_, i) =>
        artwork({
          id: `w${i}`,
          title: `Art ${String(i + 1).padStart(2, "0")}`,
        }),
      );
      renderList({ artworks });

      expect(cardTitles()).toHaveLength(25);

      await user.click(screen.getByRole("button", { name: "2" }));

      await waitFor(() =>
        expect(cardTitles()).toEqual([
          "Art 26",
          "Art 27",
          "Art 28",
          "Art 29",
          "Art 30",
        ]),
      );
      // The Grid's pager is the same page state, not a second one: the count
      // stays over the whole set.
      expect(screen.getByText("30 artworks")).toBeTruthy();
      // And there is a way to page: the pager's next page is reachable from
      // the Grid exactly as from the Table.
      expect(screen.getByRole("button", { name: "2" })).toBeTruthy();
    });

    it("shows the collection's own empty state, not a pager", () => {
      startInGrid();
      renderList({ artworks: [] });

      expect(
        screen.getByText("No artworks in this collection yet."),
      ).toBeTruthy();
      expect(screen.queryByRole("list")).toBeNull();
      // No pager either: there is no page to move between.
      expect(screen.queryByRole("button", { name: "2" })).toBeNull();
    });

    it("offers the per-page control on an empty page", () => {
      startInGrid();
      // Nothing to page, so the pager is meaningless — but the page size is
      // still a choice the collector makes here, and hiding it on an empty
      // collection would leave the control unreachable exactly when a search
      // emptied the page.
      renderList({ artworks: [] });
      expect(
        screen.getByText("No artworks in this collection yet."),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: "2" })).toBeNull();

      // Exactly one, not one per view: the per-page control moved out of the
      // cards' footer and back in without being duplicated.
      expect(
        screen.getAllByRole("combobox", { name: "Artworks per page" }),
      ).toHaveLength(1);
    });

    it("keeps the failure above nothing as it does in the table", () => {
      startInGrid();
      const onRetry = vi.fn();
      renderList({
        artworks: [],
        searchQuery: "art",
        searchError: "Failed to search artworks",
        onRetry,
      });

      expect(screen.getByText("Failed to search artworks")).toBeTruthy();
      // The Grid is replaced, not rendered empty beneath the alert.
      expect(screen.queryByRole("list")).toBeNull();
      expect(screen.queryByText(/No artworks match/)).toBeNull();
    });

    // Mantine's Select is a readonly combobox whose options live in a portal,
    // outside `screen`'s base element: it is opened, the option is clicked by
    // its label, and the visible value is read back off the input.
    // jsdom computes no accessible name for the option rows, so they are found
    // by their visible text rather than by role and name, and `hidden` is
    // needed because the portal is the only thing that renders them. Mantine
    // keeps both dropdowns mounted and names neither list by its input, so the
    // portal holds the per-page Select's "25" and "50" too whatever is open;
    // the sort rows are the ones that are not page sizes.
    const PAGE_SIZES = ["25", "50"];
    const sortRows = () =>
      screen
        .queryAllByRole("option", { hidden: true })
        .filter((option) => !PAGE_SIZES.includes(option.textContent ?? ""));
    const options = (label: string) =>
      sortRows().filter((option) => option.textContent === label);
    const sortBox = () => screen.getByRole("combobox", { name: "Sort" });
    // The one row above the cards: the count, the delete button, the Grid's
    // controls and always the view toggle. Found by the toggle's group name,
    // which is the only one the toolbar is guaranteed to carry.
    const toolbarEl = () =>
      screen.getByRole("radiogroup", { name: "Artworks manage view" })
        .parentElement?.parentElement ?? document.body;
    const openSort = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(sortBox());
      await waitFor(() =>
        expect(sortBox().getAttribute("aria-expanded")).toBe("true"),
      );
    };
    // Every option the Sort select offers, walked in the order the menu lists
    // them, each with the card order choosing it produces. Reads the menu
    // rather than a copy list, then proves each row is wired to a sort.
    const sortChoices = async (user: ReturnType<typeof userEvent.setup>) => {
      await openSort(user);
      const labels = sortRows().map((option) => option.textContent ?? "");
      // Picking the current value changes nothing, so it would close the menu
      // without re-reporting; every option still has to be picked, so each is
      // picked and its order read before the next opens the menu again.
      const choices: { label: string; order: string[] }[] = [];
      for (const label of labels) {
        await user.click(options(label)[0]);
        await waitFor(() => expect(sortBox()).toHaveValue(label));
        choices.push({ label, order: cardTitles() });
        await openSort(user);
      }
      // The menu is left open by the walk; the caller's own opening closes it
      // rather than reopening what is already showing.
      return choices;
    };

    it("offers the four sorts and writes the one shared state", async () => {
      const user = userEvent.setup();
      startInGrid();
      // The default sort's card order is the same on every fixture, so the
      // order each option produces is the test.
      const artworks = [
        artwork({ id: "a", title: "Art 1", artistName: "Abbey" }),
        artwork({ id: "b", title: "Art 2", artistName: "Caillebotte" }),
        artwork({ id: "c", title: "Art 3", artistName: "Braque" }),
      ];
      renderList({ artworks });

      // The Grid shows the same Title A-Z order the Table was left in.
      expect(cardTitles()).toEqual(["Art 1", "Art 2", "Art 3"]);
      expect(sortBox()).toHaveValue("Title A-Z");

      // Every offered option, by the visible order it produces. This is the
      // proof that the four labels exist *and* each is wired to its own sort:
      // a label that was copy only, or two labels sharing one order, fails
      // here. Spelled here, not read off the component, so the expectation is
      // independent of the labels' own list.
      expect(await sortChoices(user)).toEqual([
        { label: "Title A-Z", order: ["Art 1", "Art 2", "Art 3"] },
        { label: "Title Z-A", order: ["Art 3", "Art 2", "Art 1"] },
        { label: "Artist Name A-Z", order: ["Art 1", "Art 3", "Art 2"] },
        { label: "Artist Name Z-A", order: ["Art 2", "Art 3", "Art 1"] },
      ]);

      // The select still holds the last choice, and the choice is written.
      await user.click(options("Artist Name Z-A")[0]);
      await waitFor(() =>
        expect(cardTitles()).toEqual(["Art 2", "Art 3", "Art 1"]),
      );
      expect(sortBox()).toHaveValue("Artist Name Z-A");
      // Written at the one point either control changes the sort, so the next
      // collection — and the Table, if the collector switches back — opens on
      // it too.
      expect(
        JSON.parse(localStorage.getItem("arcula.userSettings") ?? "null"),
      ).toEqual({
        version: 1,
        artworksView: "grid",
        artworksSort: "artist-desc",
      });
    });

    it("and the Table's headers are the same control", async () => {
      const user = userEvent.setup();
      const artworks = [
        artwork({ id: "a", title: "Art 1", artistName: "Braque" }),
        artwork({ id: "b", title: "Art 2", artistName: "Abbey" }),
        artwork({ id: "c", title: "Art 3", artistName: "Caillebotte" }),
      ];
      const { rerender } = renderList({ artworks });
      // The Table starts Title A-Z, so clicking Artist Name sorts ascending.
      await user.click(screen.getByText("Artist Name"));
      await waitFor(() =>
        expect(visibleTitles()).toEqual(["Art 2", "Art 1", "Art 3"]),
      );

      rerender(<ListTree artworks={artworks} />);
      await user.click(screen.getByRole("radio", { name: "Grid" }));

      // The Grid opens in the Table's order and says so in its select.
      await waitFor(() =>
        expect(cardTitles()).toEqual(["Art 2", "Art 1", "Art 3"]),
      );
      expect(sortBox()).toHaveValue("Artist Name A-Z");
    });

    it("opens on the remembered sort, and resets to Title A-Z when the store is corrupt", () => {
      localStorage.setItem(
        "arcula.userSettings",
        JSON.stringify({
          version: 1,
          artworksView: "grid",
          artworksSort: "artist-desc",
        }),
      );
      const artworks = [
        artwork({ id: "a", title: "Art 1", artistName: "Braque" }),
        artwork({ id: "b", title: "Art 2", artistName: "Abbey" }),
      ];
      const { unmount } = renderList({ artworks });

      expect(sortBox()).toHaveValue("Artist Name Z-A");
      expect(cardTitles()).toEqual(["Art 1", "Art 2"]);
      unmount();

      startInGrid();
      localStorage.setItem("arcula.userSettings", "{not json");
      // The parser fills what it cannot read from the defaults and keeps a
      // valid view, so this is a corrupt *sort* in a remembered Grid.
      localStorage.setItem(
        "arcula.userSettings",
        JSON.stringify({
          version: 1,
          artworksView: "grid",
          artworksSort: "nope",
        }),
      );
      renderList({ artworks });

      expect(sortBox()).toHaveValue("Title A-Z");
      expect(cardTitles()).toEqual(["Art 1", "Art 2"]);
    });

    it("returns to page 1 on a sort change, and keeps the sort across a search", async () => {
      const user = userEvent.setup();
      startInGrid();
      // Title and artist order are inverses, so page 1 of the artist sort is
      // page 3 of the title sort: landing there would not be page 1.
      const artworks = Array.from({ length: 60 }, (_, i) =>
        artwork({
          id: `w${String(i).padStart(2, "0")}`,
          title: `Art ${String(i + 1).padStart(2, "0")}`,
          artistName: `Artist ${String(60 - i).padStart(2, "0")}`,
        }),
      );
      const { rerender } = renderList({ artworks });

      await user.click(screen.getByRole("button", { name: "3" }));
      await waitFor(() => expect(cardTitles()[0]).toBe("Art 51"));

      await openSort(user);
      await user.click(options("Artist Name A-Z")[0]);
      await waitFor(() => expect(cardTitles()[0]).toBe("Art 60"));

      // A search is a fresh view of the same order: the sort survives it.
      rerender(<ListTree artworks={artworks} searchQuery="art" />);
      await waitFor(() => expect(cardTitles()[0]).toBe("Art 60"));
      expect(sortBox()).toHaveValue("Artist Name A-Z");

      // And a sort made while a search is in force is that sort, not a
      // fallback to the default: the query changes nothing about the choice.
      await openSort(user);
      await user.click(options("Title Z-A")[0]);
      await waitFor(() => expect(cardTitles()[0]).toBe("Art 60"));
      expect(sortBox()).toHaveValue("Title Z-A");
    });

    it("does not show a Sort select in the Table", () => {
      renderList({ artworks: [artwork({ id: "a", title: "Art 1" })] });

      expect(screen.getByRole("table")).toBeTruthy();
      expect(screen.queryByRole("combobox", { name: "Sort" })).toBeNull();
    });

    it("keeps the Sort select, Select all and the toggle above the cards in one toolbar", () => {
      startInGrid();
      renderList({ artworks: [artwork({ id: "a", title: "Art 1" })] });

      const toolbar = toolbarEl();
      expect(
        within(toolbar).getByRole("combobox", { name: "Sort" }),
      ).toBeTruthy();
      expect(
        within(toolbar).getByRole("button", { name: "Select all" }),
      ).toBeTruthy();
      expect(within(toolbar).getByRole("radio", { name: "Grid" })).toBeTruthy();
      // The per-page control stays under the cards, not in the toolbar.
      expect(
        within(toolbar).queryByRole("combobox", {
          name: "Artworks per page",
        }),
      ).toBeNull();
      expect(
        screen.getAllByRole("combobox", { name: "Artworks per page" }).at(-1),
      ).toBeTruthy();
    });

    describe("Select all", () => {
      // More than two pages at the default 25: page 1 is "Art 01"…"Art 25",
      // page 2 "Art 26"…"Art 50", and page 3 holds the last ten.
      const threePages = () =>
        Array.from({ length: 60 }, (_, i) =>
          artwork({
            id: `w${String(i).padStart(2, "0")}`,
            title: `Art ${String(i + 1).padStart(2, "0")}`,
          }),
        );
      const selectAll = () =>
        screen.getByRole("button", { name: "Select all" });
      const clearSelection = () =>
        screen.getByRole("button", { name: "Clear selection" });
      // Which cards are ticked, by the artwork each is named after — the only
      // view of the shared selection a card gives.
      const checkedNames = () =>
        screen
          .getAllByRole("checkbox")
          .filter((box) => (box as HTMLInputElement).checked)
          .map((box) => box.getAttribute("aria-label"));

      it("selects the page it is on, not the collection", async () => {
        const user = userEvent.setup();
        startInGrid();
        renderList({ artworks: threePages() });

        await user.click(selectAll());

        // Twenty-five cards on screen, twenty-five selected: the next page is
        // not armed.
        expect(screen.getByText(/25 selected/)).toBeTruthy();
        expect(checkedNames()).toHaveLength(25);
        // The same click, once the page is covered, is the way back.
        expect(clearSelection()).toBeTruthy();

        await user.click(clearSelection());

        expect(screen.queryByText(/selected/)).toBeNull();
        expect(checkedNames()).toHaveLength(0);
        expect(selectAll()).toBeTruthy();
      });

      it("keeps an earlier page's picks when it clears the current one", async () => {
        const user = userEvent.setup();
        startInGrid();
        renderList({ artworks: threePages() });

        // Page 1: tick one card by hand, then select the rest of the page.
        await user.click(
          screen.getByRole("checkbox", { name: "Select Art 01" }),
        );
        expect(screen.getByText(/1 selected/)).toBeTruthy();
        await user.click(selectAll());
        expect(screen.getByText(/25 selected/)).toBeTruthy();
        expect(clearSelection()).toBeTruthy();

        await user.click(screen.getByRole("button", { name: "2" }));
        await waitFor(() => expect(cardTitles()[0]).toBe("Art 26"));

        // Page 2 is untouched by page 1's button, so it starts empty.
        expect(selectAll()).toBeTruthy();
        await user.click(selectAll());
        expect(screen.getByText(/50 selected/)).toBeTruthy();

        // Back on page 1, Clear selection takes page 1's twenty-five and
        // leaves page 2's twenty-five picked.
        await user.click(screen.getByRole("button", { name: "1" }));
        await waitFor(() => expect(cardTitles()[0]).toBe("Art 01"));
        await user.click(clearSelection());

        expect(screen.getByText(/25 selected/)).toBeTruthy();
      });

      it("arms Delete selected with every page's picks and clears them on success", async () => {
        const user = userEvent.setup();
        startInGrid();
        renderList({ artworks: threePages() });

        await user.click(selectAll());
        await user.click(screen.getByRole("button", { name: "2" }));
        await waitFor(() => expect(cardTitles()[0]).toBe("Art 26"));
        await user.click(selectAll());
        expect(screen.getByText(/50 selected/)).toBeTruthy();

        await user.click(
          screen.getByRole("button", { name: "Delete selected" }),
        );
        const scope = within(await dialogEl());
        // The dialog names the whole selection, not the page in view.
        expect(scope.getByText(/50 artworks/)).toBeTruthy();
        await user.click(scope.getByRole("button", { name: "Delete" }));

        await waitFor(() =>
          expect(softDeleteMock).toHaveBeenCalledWith(
            "collection1",
            Array.from(
              { length: 50 },
              (_, i) => `w${String(i).padStart(2, "0")}`,
            ),
          ),
        );
        // Done: nothing stays picked on any page.
        await waitFor(() => expect(screen.queryByText(/selected/)).toBeNull());
        expect(checkedNames()).toHaveLength(0);
      });

      it("shares its picks with the Table's header checkbox in both directions", async () => {
        const user = userEvent.setup();
        startInGrid();
        renderList({ artworks: threePages() });

        await user.click(selectAll());
        expect(screen.getByText(/25 selected/)).toBeTruthy();

        // Table: the header checkbox reflects the Grid's page — it is the same
        // selection, not a second one.
        await user.click(screen.getByRole("radio", { name: "Table" }));
        const header = screen.getAllByRole("checkbox")[0];
        await waitFor(() => expect(header).toBeChecked());
        expect(screen.getByText(/25 selected/)).toBeTruthy();

        // And the header's clear is the Grid's too.
        await user.click(header);
        await waitFor(() => expect(screen.queryByText(/selected/)).toBeNull());

        // Back in Grid, Select all is offered again.
        await user.click(screen.getByRole("radio", { name: "Grid" }));
        expect(selectAll()).toBeTruthy();
      });

      it("is Grid-only — the Table's header checkbox is its own Select all", () => {
        renderList({ artworks: threePages() });

        expect(screen.getByRole("table")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Select all" })).toBeNull();
        expect(
          screen.queryByRole("button", { name: "Clear selection" }),
        ).toBeNull();
      });
    });

    it("keeps the earlier cards under a failure, as the table does", () => {
      startInGrid();
      renderList({
        artworks: [artwork({ id: "a", title: "Art 1" })],
        searchQuery: "art",
        searchError: "Failed to search artworks",
        onRetry: vi.fn(),
      });

      // The alert says the read failed; the cards it could not replace stay,
      // so a transient failure does not blank a collection being browsed.
      expect(screen.getByText("Failed to search artworks")).toBeTruthy();
      expect(cardTitles()).toEqual(["Art 1"]);
    });
  });
});
