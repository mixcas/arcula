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
import ArtworksTable from "@/components/manage/collection/ArtworksTable";
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

const renderTable = (props: {
  artworks: Artwork[];
  onDeleted?: () => Promise<void> | void;
}) =>
  render(
    <MantineProvider>
      <ModalsProvider>
        <Notifications />
        <MemoryRouter>
          <ArtworksTable
            artworks={props.artworks}
            collectionParam="my-collection-collection1"
            onDeleted={props.onDeleted ?? vi.fn()}
          />
        </MemoryRouter>
      </ModalsProvider>
    </MantineProvider>,
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

// The confirm dialog element. Scoping queries to it is what disambiguates the
// dialog's own "Delete" button from the per-row ones; the last one wins because
// the dialog is mounted last.
const dialogEl = async () => {
  const found = await screen.findAllByRole("dialog");
  return found[found.length - 1];
};

describe("ArtworksTable", () => {
  // Testing Library's automatic cleanup only registers itself when a global
  // `afterEach` exists, and this project runs vitest without globals. Without
  // this, every render stays in the document and the next test's queries match
  // rows and dialogs from the previous one.
  afterEach(cleanup);

  beforeEach(() => {
    softDeleteMock.mockReset();
    softDeleteMock.mockResolvedValue(undefined);
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
    renderTable({ artworks });
    expect(visibleTitles()).toEqual(["Art 1", "art 2", "Art 10"]);
  });

  it("re-sorts the whole dataset when another column is clicked", async () => {
    const user = userEvent.setup();
    renderTable({
      artworks: [
        artwork({ id: "a", title: "Art 1", artistName: "Braque" }),
        artwork({ id: "b", title: "Art 2", artistName: "abbey" }),
        artwork({ id: "c", title: "Art 3", artistName: "Caillebotte" }),
      ],
    });

    await user.click(screen.getByText("Artist Name"));

    // Artist order, not the title order the table started in.
    await waitFor(() =>
      expect(visibleTitles()).toEqual(["Art 2", "Art 1", "Art 3"]),
    );
  });

  it("slices the sorted set into pages, counting the whole set", async () => {
    const user = userEvent.setup();
    // 30 rows against a 25-row page: the fixture has to be larger than the
    // page for pagination to be observable at all, and 25 is the default now.
    const artworks = Array.from({ length: 30 }, (_, i) =>
      artwork({ id: `w${i}`, title: `Art ${String(i + 1).padStart(2, "0")}` }),
    );
    renderTable({ artworks });

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

  it("defaults to 25 per page", () => {
    renderTable({ artworks: [artwork({ id: "a", title: "Art 1" })] });

    // The size selector renders its own value as a button, so this asserts the
    // default *and* that 25 is offered. The two are coupled through
    // `RECORDS_PER_PAGE_OPTIONS[0]`, so a reordering would silently change the
    // page size every collection opens at.
    expect(screen.getByRole("button", { name: "25" })).toBeTruthy();
    // 10 is gone on purpose: a 10-row page reads as empty next to a 50-row one,
    // and the options only exist in the dropdown. Rather than fight Mantine's
    // portalled Select to enumerate them, the pagination test above pins the
    // *effect* of the default (25 of 30 on the first page) and this pins the
    // label; together they fail if the array is reordered or 10 is re-added.
  });

  it("marks a draft artwork in its title cell, and leaves a published one unmarked", () => {
    renderTable({
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
    renderTable({
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
    renderTable({
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
    renderTable({
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
    renderTable({
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
    renderTable({
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
});
