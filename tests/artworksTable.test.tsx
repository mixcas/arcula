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
import type { Artwork } from "@/types";

vi.mock("@/services/artworkService", () => ({
  artworkService: { softDeleteArtworks: vi.fn() },
}));

// React 19 requires this flag for act() outside a browser environment.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The failure test below drives the component's real error path, and
// `artworkService.softDeleteArtworks` reports a rejected write with
// `console.error`. Left unstubbed that lands on stderr during `test:rules`,
// which is the gate in front of `deploy:rules` — so a *passing* run prints a
// red stack trace and the deploy output trains everyone to ignore the one
// line that matters. Captured instead of leaked; that test asserts on it.
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

// mantine-datatable measures its scroll viewport on mount to drive column
// widths, and jsdom implements no ResizeObserver. The stub satisfies the
// observation and reports a zero-size viewport, which is all the layout needs
// for these assertions.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ResizeObserverStub;

// eslint-disable-next-line @typescript-eslint/unbound-method
const softDeleteMock = vi.mocked(artworkService.softDeleteArtworks);

const artwork = (overrides: Partial<Artwork> & { id: string }): Artwork => ({
  userId: "user-1",
  title: "Untitled",
  artistName: "Unknown",
  documents: [],
  photos: [],
  collectionId: "collection-1",
  isPublic: true,
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
            collectionParam="my-collection-collection-1"
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
    const artworks = Array.from({ length: 12 }, (_, i) =>
      artwork({ id: `w${i}`, title: `Art ${String(i + 1).padStart(2, "0")}` }),
    );
    renderTable({ artworks });

    // Default page size is 10, so the first page holds 10 of the 12.
    expect(visibleTitles()).toHaveLength(10);
    expect(visibleTitles()).not.toContain("Art 11");
    expect(screen.getByText("12 artworks")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "2" }));
    await waitFor(() => expect(visibleTitles()).toEqual(["Art 11", "Art 12"]));
  });

  it("marks a private artwork in its title cell", () => {
    renderTable({
      artworks: [artwork({ id: "a", title: "Art 1", isPublic: false })],
    });
    expect(screen.getByText("Private")).toBeTruthy();
  });

  it("soft-deletes one artwork after confirmation and refetches", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    renderTable({
      artworks: [artwork({ id: "a", title: "Art 1" })],
      onDeleted,
    });

    // The button is disabled on purpose: there is no public page for a single
    // artwork yet. Asserted so it is not mistaken for a styling accident.
    expect(screen.getByRole("button", { name: "View" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    // Nothing is written until the dialog is confirmed.
    expect(softDeleteMock).not.toHaveBeenCalled();
    const scope = within(await dialogEl());
    expect(scope.getByText(/soft delete/i)).toBeTruthy();

    await user.click(scope.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(softDeleteMock).toHaveBeenCalledWith(["a"]));
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
      expect(softDeleteMock).toHaveBeenCalledWith(["a", "b"]),
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

  it("shows an empty state instead of an empty table", () => {
    renderTable({ artworks: [] });
    expect(
      screen.getByText("No artworks in this collection yet."),
    ).toBeTruthy();
  });
});
