// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CollectionPage from "@/components/manage/CollectionPage";
import { collectionService } from "@/services/collectionService";
import { artworkService } from "@/services/artworkService";
import type { Artwork, Collection } from "@arcula/shared";

/**
 * The collection page's nav bar and its Collection search.
 *
 * The search lives in the address as `?q=…` and is the source of truth: Enter
 * commits, the X clears, and the list read follows the committed query. The
 * tests assert what a reader sees and what the page asks the service for —
 * where those controls take you, not how Mantine draws them.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/collectionService", () => ({
  collectionService: { getCollection: vi.fn() },
}));

vi.mock("@/services/artworkService", () => ({
  artworkService: {
    getCollectionArtworks: vi.fn(),
    // ArtworksTable imports the same module; a missing key would turn its
    // delete path into a TypeError if a future test reaches it.
    softDeleteArtworks: vi.fn(),
  },
}));

// Mantine resolves responsive props through `matchMedia`; jsdom has none.
// Answering `true` only for the empty query is what Chrome does, and it is
// what keeps mantine-datatable's columns visible (see AGENTS.md).
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

// The page reports its own failures with `console.error`. Captured so a
// passing run stays quiet, the way the artworks-table suite does.
vi.spyOn(console, "error").mockImplementation(() => undefined);

const COLLECTION_ID = "cccccccccccccccccccc";
const COLLECTION_NAME = "Flores Solares";
// The address the page settles on once its canonical rewrite has run, so the
// destinations asserted below are the ones a reader sees in the address bar.
const COLLECTION_PARAM = "flores-solares-cccccccccccccccccccc";
const CANONICAL_PATH = `/manage/collection/${COLLECTION_PARAM}`;

const collection: Collection = {
  id: COLLECTION_ID,
  name: COLLECTION_NAME,
  userId: "u1",
  isPublic: true,
  role: "owner",
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 1, nanoseconds: 0 },
};

const artwork = (
  overrides: Partial<Artwork> & { id: string; title: string },
): Artwork => ({
  userId: "u1",
  artistName: "Picasso",
  documents: [],
  photos: [],
  collectionId: COLLECTION_ID,
  status: "published",
  ...overrides,
});

const picasso = artwork({ id: "a1", title: "Blue Nude" });
const dali = artwork({
  id: "a2",
  title: "La persistencia",
  artistName: "Dalí",
});

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
};

/**
 * A second navigation to the same route, carrying another query. It stands in
 * for Back/Forward (or a pasted address): the URL changes without the page's
 * own commit, which is the case the input has to mirror.
 */
const NavProbe: React.FC = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate("?q=otro")}>
      go to otro
    </button>
  );
};

const renderPage = (initialEntry: string = CANONICAL_PATH) =>
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <NavProbe />
        <Routes>
          <Route
            path="/manage/collection/:collectionId"
            element={<CollectionPage />}
          />
          <Route
            path="/manage/collection/:collectionId/deleted"
            element={<div />}
          />
          <Route
            path="/manage/collection/:collectionId/settings"
            element={<div />}
          />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );

/* eslint-disable @typescript-eslint/unbound-method */
const getCollection = vi.mocked(collectionService.getCollection);
const getCollectionArtworks = vi.mocked(artworkService.getCollectionArtworks);
/* eslint-enable @typescript-eslint/unbound-method */

const searchInput = () =>
  screen.getByRole("textbox", { name: /search this collection/i });

beforeEach(() => {
  vi.clearAllMocks();
  getCollection.mockResolvedValue(collection);
  getCollectionArtworks.mockResolvedValue([]);
});

afterEach(cleanup);

describe("a collection's nav bar", () => {
  it("keeps Add Artwork a link and folds Deleted and Settings into one menu", async () => {
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /add artwork/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: /add artwork/i })).toHaveAttribute(
      "href",
      `${CANONICAL_PATH}/artwork/add`,
    );

    // The layout prefactor's whole point: the two page links no longer take
    // space in the bar until the menu is opened.
    expect(
      screen.queryByRole("link", { name: /^deleted$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^settings$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /collection actions/i }),
    ).toBeInTheDocument();
  });

  it("puts the search input beside Add Artwork", async () => {
    renderPage();

    // The input is the member's way into the collection's works; Add Artwork
    // is the way to add one. Both are in the bar once the collection loads.
    expect(await screen.findByRole("textbox", { name: /search/i })).toBe(
      searchInput(),
    );
    expect(screen.getByRole("link", { name: /add artwork/i })).toBeVisible();
  });

  it.each([
    ["Deleted", "deleted"],
    ["Settings", "settings"],
  ])("opens %s from the menu at its existing address", async (name, path) => {
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /collection actions/i }),
      ).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /collection actions/i }),
    );
    await user.click(await screen.findByRole("menuitem", { name }));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        `${CANONICAL_PATH}/${path}`,
      ),
    );
  });

  it("opens the menu from the keyboard", async () => {
    renderPage();
    const trigger = await screen.findByRole("button", {
      name: /collection actions/i,
    });

    trigger.focus();
    const user = userEvent.setup();
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("menuitem", { name: "Deleted" }),
    ).toBeInTheDocument();
  });

  it("carries the active search into Edit and Add, and nowhere else", async () => {
    getCollectionArtworks.mockResolvedValue([picasso]);
    renderPage(`${CANONICAL_PATH}?q=picasso`);

    // The two member destinations that return to this list carry the query, so
    // Cancel on either page lands back on the same results.
    expect(await screen.findByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      `${CANONICAL_PATH}/artwork/blue-nude-a1?q=picasso`,
    );
    expect(screen.getByRole("link", { name: /add artwork/i })).toHaveAttribute(
      "href",
      `${CANONICAL_PATH}/artwork/add?q=picasso`,
    );

    // The public page and the PDF have no search of their own: a query there
    // would be a filter the visitor's page cannot show. "View" is both the
    // collection's address and the row's public work, in that order.
    const views = screen.getAllByRole("link", { name: "View" });
    expect(views[0]).toHaveAttribute("href", `/collection/${COLLECTION_PARAM}`);
    expect(views[1]).toHaveAttribute(
      "href",
      `/collection/${COLLECTION_PARAM}/artwork/blue-nude-a1`,
    );
    expect(screen.getByRole("link", { name: "PDF" })).toHaveAttribute(
      "href",
      `/collection/${COLLECTION_PARAM}/pdf`,
    );
  });

  it("leaves the search out of the Deleted and Settings destinations", async () => {
    getCollectionArtworks.mockResolvedValue([picasso]);
    renderPage(`${CANONICAL_PATH}?q=picasso`);

    // Keyboard, not a click: it is the same open path the nav test above
    // already exercises, and it does not depend on pointer timing.
    const trigger = await screen.findByRole("button", {
      name: /collection actions/i,
    });
    trigger.focus();
    const user = userEvent.setup();
    await user.keyboard("{Enter}");

    // Both items in one query: they render together, and reading them from a
    // single snapshot keeps a transition from closing the menu between reads.
    const hrefs = (await screen.findAllByRole("menuitem")).map((item) =>
      item.getAttribute("href"),
    );
    // Those pages do not search; carrying `q` would pretend they do. Back
    // still restores the results because the commit left a history entry.
    expect(hrefs).toEqual([
      `${CANONICAL_PATH}/deleted`,
      `${CANONICAL_PATH}/settings`,
    ]);
  });
});

describe("Collection search", () => {
  it("takes the committed query from the address and reads with it", async () => {
    getCollectionArtworks.mockResolvedValue([picasso]);
    renderPage(`${CANONICAL_PATH}?q=picasso`);

    // The input and the address agree on load, and the list read carries the
    // query rather than filtering the unfiltered list on the client.
    expect(await screen.findByRole("textbox")).toHaveValue("picasso");
    await waitFor(() =>
      expect(getCollectionArtworks).toHaveBeenLastCalledWith(
        COLLECTION_ID,
        "picasso",
      ),
    );
    expect(await screen.findByText("Found 1 artwork")).toBeInTheDocument();
  });

  it("commits on Enter, putting the query in the address and reading with it", async () => {
    getCollectionArtworks.mockResolvedValue([picasso]);
    renderPage();
    const input = await screen.findByRole("textbox");

    const user = userEvent.setup();
    await user.type(input, "picasso blue{Enter}");

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        `${CANONICAL_PATH}?q=picasso+blue`,
      ),
    );
    await waitFor(() =>
      expect(getCollectionArtworks).toHaveBeenLastCalledWith(
        COLLECTION_ID,
        "picasso blue",
      ),
    );
  });

  it("does not search on every keystroke", async () => {
    renderPage();
    const input = await screen.findByRole("textbox");

    // Let the initial read settle before counting.
    await waitFor(() => expect(getCollectionArtworks).toHaveBeenCalledTimes(1));

    const user = userEvent.setup();
    await user.type(input, "picasso");

    // Typing is a draft until Enter; the committed query did not move.
    expect(getCollectionArtworks).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("location").textContent).toBe(CANONICAL_PATH);
  });

  it("clears the query from the X, removing it from the address and refetching", async () => {
    getCollectionArtworks.mockResolvedValue([picasso]);
    renderPage(`${CANONICAL_PATH}?q=picasso`);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: /clear search/i }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(CANONICAL_PATH),
    );
    await waitFor(() =>
      expect(getCollectionArtworks).toHaveBeenLastCalledWith(COLLECTION_ID, ""),
    );
  });

  it("clears the query when Enter is pressed on an empty input", async () => {
    getCollectionArtworks.mockResolvedValue([picasso]);
    renderPage(`${CANONICAL_PATH}?q=picasso`);
    const input = await screen.findByRole("textbox");

    const user = userEvent.setup();
    await user.clear(input);
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(CANONICAL_PATH),
    );
    await waitFor(() =>
      expect(getCollectionArtworks).toHaveBeenLastCalledWith(COLLECTION_ID, ""),
    );
  });

  it("keeps the query in the address through the canonical slug rewrite", async () => {
    renderPage(`/manage/collection/${COLLECTION_ID}?q=picasso`);

    // A link written with the id alone resolves to the readable address, and
    // the search survives that swap instead of being dropped a moment after
    // load.
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        `${CANONICAL_PATH}?q=picasso`,
      ),
    );
    expect(await screen.findByRole("textbox")).toHaveValue("picasso");
  });

  it("mirrors a query the address gains without a commit", async () => {
    renderPage();
    await screen.findByRole("textbox");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /go to otro/i }));

    // Back/Forward changes the address; the input follows it and the list
    // refetches for the query the user landed on.
    await waitFor(() => expect(searchInput()).toHaveValue("otro"));
    await waitFor(() =>
      expect(getCollectionArtworks).toHaveBeenLastCalledWith(
        COLLECTION_ID,
        "otro",
      ),
    );
  });

  it("keeps a typed draft that has not been committed", async () => {
    getCollectionArtworks.mockResolvedValue([picasso]);
    renderPage(`${CANONICAL_PATH}?q=picasso`);
    const input = await screen.findByRole("textbox");

    const user = userEvent.setup();
    await user.clear(input);

    // The input is the draft, not a mirror: clearing it without Enter leaves
    // the committed search alone until the user commits the clear.
    expect(input).toHaveValue("");
    expect(getCollectionArtworks).toHaveBeenLastCalledWith(
      COLLECTION_ID,
      "picasso",
    );
  });

  it("shows the plain count when no query is active", async () => {
    getCollectionArtworks.mockResolvedValue([picasso, dali]);
    renderPage();

    expect(await screen.findByText("2 artworks")).toBeInTheDocument();
    expect(screen.queryByText(/^Found /)).toBeNull();
  });

  it("shows a no-results panel, and Clear search returns to the collection", async () => {
    getCollectionArtworks.mockResolvedValue([]);
    renderPage(`${CANONICAL_PATH}?q=monet`);

    expect(
      await screen.findByText("No artworks match “monet”."),
    ).toBeInTheDocument();
    // A completed search is not an empty collection.
    expect(
      screen.queryByText("No artworks in this collection yet."),
    ).toBeNull();

    const user = userEvent.setup();
    // The input's X carries the same accessible name; scope to the panel.
    const panel = screen.getByText("No artworks match “monet”.").parentElement;
    await user.click(
      within(panel as HTMLElement).getByRole("button", {
        name: /clear search/i,
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(CANONICAL_PATH),
    );
    await waitFor(() =>
      expect(getCollectionArtworks).toHaveBeenLastCalledWith(COLLECTION_ID, ""),
    );
  });

  it("keeps the empty-collection state when no query is active", async () => {
    renderPage();

    expect(
      await screen.findByText("No artworks in this collection yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No artworks match/)).toBeNull();
  });

  it("keeps the previous rows and retries a failed search", async () => {
    getCollectionArtworks
      .mockResolvedValueOnce([picasso])
      .mockRejectedValueOnce(new Error("offline"));
    renderPage();
    // The first read lands before the failure, so there is something to keep.
    expect(await screen.findByText("Blue Nude")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox"), "dali{Enter}");

    expect(
      await screen.findByText("Failed to search artworks"),
    ).toBeInTheDocument();
    // A dropped connection does not wipe the page.
    expect(screen.getByText("Blue Nude")).toBeInTheDocument();

    getCollectionArtworks.mockResolvedValue([dali]);
    await user.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() =>
      expect(screen.getByText("La persistencia")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Blue Nude")).toBeNull();
    expect(getCollectionArtworks).toHaveBeenLastCalledWith(
      COLLECTION_ID,
      "dali",
    );
  });

  it("replaces the table with the failure when there are no previous rows", async () => {
    getCollectionArtworks.mockRejectedValue(new Error("offline"));
    renderPage();

    expect(
      await screen.findByText("Failed to search artworks"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(
      screen.queryByText("No artworks in this collection yet."),
    ).toBeNull();
  });

  it("keeps a collection-load failure as the page-level error", async () => {
    getCollection.mockRejectedValue(new Error("offline"));
    renderPage();

    expect(
      await screen.findByText("Failed to fetch collection data"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("refuses a query with more than ten words before sending it", async () => {
    renderPage();
    const input = await screen.findByRole("textbox");
    await waitFor(() => expect(getCollectionArtworks).toHaveBeenCalledTimes(1));

    const user = userEvent.setup();
    await user.type(
      input,
      "one two three four five six seven eight nine ten eleven{Enter}",
    );

    expect(screen.getByText("Use 10 words or fewer.")).toBeInTheDocument();
    // Explained instead of sent: no round trip, and no address change.
    expect(getCollectionArtworks).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("location").textContent).toBe(CANONICAL_PATH);
  });

  it("discards a stale answer when an older search resolves last", async () => {
    getCollectionArtworks.mockResolvedValueOnce([picasso]);
    renderPage();
    await screen.findByText("Blue Nude");

    let resolveFirst!: (rows: Artwork[]) => void;
    let resolveSecond!: (rows: Artwork[]) => void;
    getCollectionArtworks
      .mockReturnValueOnce(
        new Promise<Artwork[]>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<Artwork[]>((resolve) => {
          resolveSecond = resolve;
        }),
      );

    const user = userEvent.setup();
    // Two commits in flight: the older answer must not overwrite the newer
    // one, however the network orders them.
    await user.type(screen.getByRole("textbox"), "p{Enter}");
    await waitFor(() =>
      expect(getCollectionArtworks).toHaveBeenLastCalledWith(
        COLLECTION_ID,
        "p",
      ),
    );
    await user.type(screen.getByRole("textbox"), "i{Enter}");
    await waitFor(() =>
      expect(getCollectionArtworks).toHaveBeenLastCalledWith(
        COLLECTION_ID,
        "pi",
      ),
    );

    await act(async () => {
      resolveSecond([dali]);
      await Promise.resolve();
    });
    expect(await screen.findByText("La persistencia")).toBeInTheDocument();

    await act(async () => {
      resolveFirst([picasso]);
      await Promise.resolve();
    });
    // The newer result stands; the stale one is dropped.
    expect(screen.getByText("La persistencia")).toBeInTheDocument();
    expect(screen.queryByText("Blue Nude")).toBeNull();
  });
});
