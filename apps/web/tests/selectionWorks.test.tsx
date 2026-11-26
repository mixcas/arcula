// @vitest-environment jsdom
import React, { useState } from "react";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { Notifications, notifications } from "@mantine/notifications";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SelectionWorksList from "@/components/manage/catalogue/SelectionWorksList";
import { artworkService } from "@/services/artworkService";
import { selectionService } from "@/services/selectionService";
import type { Artwork } from "@arcula/shared";

/**
 * The Selection's ordered works list: the order it renders, the Draft badge,
 * the remove, the drag reorder and **Add artworks**.
 *
 * The harness hands the list a real `works` state and a re-read, exactly as the
 * manage page does, so a test sees the order after the write rather than the
 * optimistic picture a local splice would paint.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/selectionService", () => ({
  selectionService: {
    getWorks: vi.fn(),
    addWorks: vi.fn(),
    replaceWorks: vi.fn(),
  },
}));

vi.mock("@/services/artworkService", () => ({
  artworkService: { getCatalogueArtworks: vi.fn() },
}));

/* eslint-disable @typescript-eslint/unbound-method */
const getWorks = vi.mocked(selectionService.getWorks);
const addWorks = vi.mocked(selectionService.addWorks);
const replaceWorks = vi.mocked(selectionService.replaceWorks);
const getCatalogueArtworks = vi.mocked(artworkService.getCatalogueArtworks);
/* eslint-enable @typescript-eslint/unbound-method */

Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: query === "",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

const CATALOGUE_ID = "cccccccccccccccccccc";
const SELECTION_ID = "ssssssssssssssssssss";

const artwork = (overrides: Partial<Artwork> & { id: string }): Artwork => ({
  userId: "u1",
  title: `Work ${overrides.id}`,
  artistName: "Unknown",
  documents: [],
  photos: [],
  catalogueId: CATALOGUE_ID,
  status: "published",
  deletedAt: null,
  ...overrides,
});

const alpha = artwork({ id: "alpha", title: "Alpha", artistName: "Ana" });
const bravo = artwork({
  id: "bravo",
  title: "Bravo",
  artistName: "Bea",
  status: "draft",
});
const charlie = artwork({ id: "charlie", title: "Charlie" });

const Harness: React.FC<{ initial: Artwork[] }> = ({ initial }) => {
  const [works, setWorks] = useState(initial);
  return (
    <MantineProvider>
      <Notifications />
      <SelectionWorksList
        catalogueId={CATALOGUE_ID}
        selectionId={SELECTION_ID}
        works={works}
        onChanged={async () => {
          setWorks(await selectionService.getWorks(SELECTION_ID));
        }}
      />
    </MantineProvider>
  );
};

const renderList = (initial: Artwork[]) =>
  render(<Harness initial={initial} />);

const rowTitles = (): string[] =>
  screen
    .getAllByRole("listitem")
    .map((item) => item.textContent?.match(/Alpha|Bravo|Charlie/)?.[0] ?? "");

/**
 * One key as dnd-kit's keyboard sensor reads it.
 *
 * Activation attaches the sensor's document listener in a `setTimeout`, so the
 * move and the drop have to wait a task — `userEvent.keyboard` sends the whole
 * sequence in one tick and the move is lost before the listener exists.
 */
const pressKey = async (
  target: Element,
  key: string,
  code: string,
): Promise<void> => {
  fireEvent.keyDown(target, { key, code });
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  getWorks.mockReset();
  addWorks.mockReset();
  replaceWorks.mockReset();
  getCatalogueArtworks.mockReset();
});

afterEach(() => {
  cleanup();
  notifications.clean();
  vi.restoreAllMocks();
});

describe("SelectionWorksList", () => {
  it("renders the works in the curator's order and badges a Draft", async () => {
    renderList([bravo, alpha, charlie]);

    expect(await screen.findByText("Bravo")).toBeInTheDocument();
    // The order is the content: DOM order is the stored order, not sorted.
    expect(rowTitles()).toEqual(["Bravo", "Alpha", "Charlie"]);
    expect(screen.getByText("Draft")).toBeInTheDocument();
    // Each control names the work and its position: twelve image rows are
    // otherwise indistinguishable to a screen reader.
    expect(
      screen.getByRole("button", {
        name: "Reorder Bravo, position 1 of 3",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Alpha" }),
    ).toBeInTheDocument();
  });

  it("removes a row, states the whole list without it, and re-reads first", async () => {
    renderList([bravo, alpha, charlie]);
    replaceWorks.mockResolvedValue([bravo, charlie]);
    getWorks.mockResolvedValue([bravo, charlie]);

    await userEvent.click(screen.getByRole("button", { name: "Remove Alpha" }));

    await waitFor(() =>
      expect(replaceWorks).toHaveBeenCalledWith(CATALOGUE_ID, SELECTION_ID, [
        "bravo",
        "charlie",
      ]),
    );
    // The list is the server's answer: the re-read is what removes the row.
    expect(replaceWorks.mock.invocationCallOrder[0]).toBeLessThan(
      getWorks.mock.invocationCallOrder[0],
    );
    await waitFor(() => expect(rowTitles()).toEqual(["Bravo", "Charlie"]));
    expect(await screen.findByText("Removed")).toBeInTheDocument();
  });

  it("keeps the row and says nothing changed when the remove fails", async () => {
    renderList([alpha]);
    replaceWorks.mockRejectedValue(new Error("nope"));

    await userEvent.click(screen.getByRole("button", { name: "Remove Alpha" }));

    await waitFor(() => expect(replaceWorks).toHaveBeenCalled());
    expect(rowTitles()).toEqual(["Alpha"]);
    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    // A failed write is not a fresh read.
    expect(getWorks).not.toHaveBeenCalled();
  });

  it("reorders with the keyboard: the handle, space, an arrow, space", async () => {
    // jsdom does no layout, so every rect is zero and the keyboard sensor has
    // nothing to move against. Give each row a stacked rect.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const items = Array.from(document.querySelectorAll("li"));
        const item = this.closest("li") ?? this;
        const index = Math.max(0, items.indexOf(item as HTMLLIElement));
        const top = index * 100;
        return {
          top,
          bottom: top + 80,
          height: 80,
          left: 0,
          right: 600,
          width: 600,
          x: 0,
          y: top,
          toJSON: () => ({}),
        };
      },
    );
    renderList([alpha, bravo, charlie]);
    replaceWorks.mockResolvedValue([bravo, alpha, charlie]);
    getWorks.mockResolvedValue([bravo, alpha, charlie]);

    const handle = screen.getByRole("button", {
      name: "Reorder Alpha, position 1 of 3",
    });
    handle.focus();
    await pressKey(handle, " ", "Space");
    await pressKey(document, "ArrowDown", "ArrowDown");
    await pressKey(document, " ", "Space");

    await waitFor(() =>
      expect(replaceWorks).toHaveBeenCalledWith(CATALOGUE_ID, SELECTION_ID, [
        "bravo",
        "alpha",
        "charlie",
      ]),
    );
    await waitFor(() =>
      expect(rowTitles()).toEqual(["Bravo", "Alpha", "Charlie"]),
    );
  });

  it("offers the catalogue's live works minus the ones already curated", async () => {
    renderList([alpha]);
    getCatalogueArtworks.mockResolvedValue([alpha, bravo, charlie]);

    await userEvent.click(screen.getByRole("button", { name: "Add artworks" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("checkbox", { name: /Bravo/ }),
    ).toBeInTheDocument();
    // Alpha is already in the selection: offering it would be a write that
    // cannot change anything.
    expect(
      within(dialog).queryByRole("checkbox", { name: /Alpha/ }),
    ).not.toBeInTheDocument();
    expect(getCatalogueArtworks).toHaveBeenCalledWith(CATALOGUE_ID);
  });

  it("appends the chosen works in the order they were checked", async () => {
    renderList([alpha]);
    getCatalogueArtworks.mockResolvedValue([alpha, bravo, charlie]);
    addWorks.mockResolvedValue([alpha, charlie, bravo]);
    getWorks.mockResolvedValue([alpha, charlie, bravo]);

    await userEvent.click(screen.getByRole("button", { name: "Add artworks" }));
    const dialog = await screen.findByRole("dialog");
    // Checked out of catalogue order on purpose: Charlie is second in the
    // picker, Bravo third, and the append must follow the ticks.
    // The input itself is visually hidden by Mantine; the label is what a
    // person clicks, and it is the same control.
    await userEvent.click(within(dialog).getByText("Charlie"));
    await userEvent.click(within(dialog).getByText("Bravo"));
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add artworks" }),
    );

    await waitFor(() =>
      expect(addWorks).toHaveBeenCalledWith(CATALOGUE_ID, SELECTION_ID, [
        "charlie",
        "bravo",
      ]),
    );
    expect(addWorks.mock.invocationCallOrder[0]).toBeLessThan(
      getWorks.mock.invocationCallOrder[0],
    );
    await waitFor(() =>
      expect(rowTitles()).toEqual(["Alpha", "Charlie", "Bravo"]),
    );
    expect(await screen.findByText("Added")).toBeInTheDocument();
  });

  it("says the selection is empty and offers the way to fill it", async () => {
    renderList([]);
    expect(await screen.findByText("No artworks yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add artworks" }),
    ).toBeInTheDocument();
  });
});
