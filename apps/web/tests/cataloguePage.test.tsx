// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
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

import CataloguePage from "@/components/manage/CataloguePage";
import { catalogueService } from "@/services/catalogueService";
import { artworkService } from "@/services/artworkService";
import type { Artwork, Catalogue } from "@arcula/shared";

/**
 * The catalogue page's nav bar and its Catalogue search.
 *
 * The search lives in the address as `?q=…` and is the source of truth: typing
 * commits after a short pause, the X clears, and the list read follows the
 * committed query. The tests assert what a reader sees and what the page asks
 * the service for — where those controls take you, not how Mantine draws them.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/catalogueService", () => ({
  catalogueService: { getCatalogue: vi.fn() },
}));

vi.mock("@/services/artworkService", () => ({
  artworkService: {
    getCatalogueArtworks: vi.fn(),
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

const CATALOGUE_ID = "cccccccccccccccccccc";
const CATALOGUE_NAME = "Flores Solares";
// The address the page settles on once its canonical rewrite has run, so the
// destinations asserted below are the ones a reader sees in the address bar.
const CATALOGUE_PARAM = "flores-solares-cccccccccccccccccccc";
const CANONICAL_PATH = `/manage/catalogue/${CATALOGUE_PARAM}`;

const catalogue: Catalogue = {
  id: CATALOGUE_ID,
  name: CATALOGUE_NAME,
  kind: "collection",
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
  catalogueId: CATALOGUE_ID,
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
            path="/manage/catalogue/:catalogueId"
            element={<CataloguePage />}
          />
          <Route
            path="/manage/catalogue/:catalogueId/deleted"
            element={<div />}
          />
          <Route
            path="/manage/catalogue/:catalogueId/settings"
            element={<div />}
          />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );

/* eslint-disable @typescript-eslint/unbound-method */
const getCatalogue = vi.mocked(catalogueService.getCatalogue);
const getCatalogueArtworks = vi.mocked(artworkService.getCatalogueArtworks);
/* eslint-enable @typescript-eslint/unbound-method */

const searchInput = () =>
  screen.getByRole("textbox", { name: /search this catalogue/i });

/** A promise the test settles by hand, for the states before a read answers. */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  getCatalogue.mockResolvedValue(catalogue);
  getCatalogueArtworks.mockResolvedValue([]);
});

afterEach(cleanup);

describe("a catalogue's nav bar", () => {
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

    // The trigger is the bar's one page-level control; it has a name a screen
    // reader can announce. What it opens is Mantine's behaviour.
    expect(
      screen.getByRole("button", { name: /catalogue actions/i }),
    ).toBeInTheDocument();
  });

  it("puts the search input beside Add Artwork", async () => {
    renderPage();

    // The input is the member's way into the catalogue's works; Add Artwork
    // is the way to add one. Both are in the bar once the catalogue loads.
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
        screen.getByRole("button", { name: /catalogue actions/i }),
      ).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /catalogue actions/i }),
    );
    await user.click(await screen.findByRole("menuitem", { name }));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        `${CANONICAL_PATH}/${path}`,
      ),
    );
  });

  it("carries the active search into Edit and Add, and nowhere else", async () => {
    getCatalogueArtworks.mockResolvedValue([picasso]);
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
    // catalogue's address and the row's public work, in that order.
    const views = screen.getAllByRole("link", { name: "View" });
    expect(views[0]).toHaveAttribute("href", `/catalogue/${CATALOGUE_PARAM}`);
    expect(views[1]).toHaveAttribute(
      "href",
      `/catalogue/${CATALOGUE_PARAM}/artwork/blue-nude-a1`,
    );
    expect(screen.getByRole("link", { name: "PDF" })).toHaveAttribute(
      "href",
      `/catalogue/${CATALOGUE_PARAM}/pdf`,
    );
  });

  it("leaves the search out of the Deleted and Settings destinations", async () => {
    getCatalogueArtworks.mockResolvedValue([picasso]);
    renderPage(`${CANONICAL_PATH}?q=picasso`);

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /catalogue actions/i }),
    );

    // Both items in one query: they render together, and reading them from a
    // single snapshot keeps a transition from closing the menu between reads.
    // Sorted, because the menu's order is a presentation choice and not this
    // test's subject.
    const hrefs = (await screen.findAllByRole("menuitem"))
      .map((item) => item.getAttribute("href"))
      .sort();
    // Those pages do not search; carrying `q` would pretend they do. Back
    // still restores the results because the commit left a history entry.
    expect(hrefs).toEqual(
      [`${CANONICAL_PATH}/deleted`, `${CANONICAL_PATH}/settings`].sort(),
    );
  });
});

describe("Catalogue search", () => {
  it("takes the committed query from the address and reads with it", async () => {
    getCatalogueArtworks.mockResolvedValue([picasso]);
    renderPage(`${CANONICAL_PATH}?q=picasso`);

    // The input and the address agree on load, and the list read carries the
    // query rather than filtering the unfiltered list on the client.
    expect(await screen.findByRole("textbox")).toHaveValue("picasso");
    await waitFor(() =>
      expect(getCatalogueArtworks).toHaveBeenLastCalledWith(
        CATALOGUE_ID,
        "picasso",
      ),
    );
    expect(await screen.findByText("Found 1 artwork")).toBeInTheDocument();
  });

  it("searches as the collector types, putting the query in the address and reading with it", async () => {
    getCatalogueArtworks.mockResolvedValue([picasso]);
    renderPage();
    const input = await screen.findByRole("textbox");

    const user = userEvent.setup();
    await user.type(input, "picasso blue");

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        `${CANONICAL_PATH}?q=picasso+blue`,
      ),
    );
    await waitFor(() =>
      expect(getCatalogueArtworks).toHaveBeenLastCalledWith(
        CATALOGUE_ID,
        "picasso blue",
      ),
    );
  });

  it("clears the query from the X, removing it from the address and refetching", async () => {
    getCatalogueArtworks.mockResolvedValue([picasso]);
    renderPage(`${CANONICAL_PATH}?q=picasso`);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: /clear search/i }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(CANONICAL_PATH),
    );
    await waitFor(() =>
      expect(getCatalogueArtworks).toHaveBeenLastCalledWith(CATALOGUE_ID, ""),
    );
  });

  it("clears the query when the input is emptied", async () => {
    getCatalogueArtworks.mockResolvedValue([picasso]);
    renderPage(`${CANONICAL_PATH}?q=picasso`);
    const input = await screen.findByRole("textbox");

    const user = userEvent.setup();
    await user.clear(input);

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(CANONICAL_PATH),
    );
    await waitFor(() =>
      expect(getCatalogueArtworks).toHaveBeenLastCalledWith(CATALOGUE_ID, ""),
    );
  });

  it("keeps the query in the address through the canonical slug rewrite", async () => {
    renderPage(`/manage/catalogue/${CATALOGUE_ID}?q=picasso`);

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
      expect(getCatalogueArtworks).toHaveBeenLastCalledWith(
        CATALOGUE_ID,
        "otro",
      ),
    );
  });

  it("shows the plain count when no query is active", async () => {
    getCatalogueArtworks.mockResolvedValue([picasso, dali]);
    renderPage();

    expect(await screen.findByText("2 artworks")).toBeInTheDocument();
  });

  it("shows a no-results panel, and Clear search returns to the catalogue", async () => {
    getCatalogueArtworks.mockResolvedValue([]);
    renderPage(`${CANONICAL_PATH}?q=monet`);

    expect(
      await screen.findByText("No artworks match “monet”."),
    ).toBeInTheDocument();
    // A completed search is not an empty catalogue.
    expect(screen.queryByText("No artworks in this catalogue yet.")).toBeNull();

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
      expect(getCatalogueArtworks).toHaveBeenLastCalledWith(CATALOGUE_ID, ""),
    );
  });

  it("keeps the empty-catalogue state when no query is active", async () => {
    renderPage();

    expect(
      await screen.findByText("No artworks in this catalogue yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No artworks match/)).toBeNull();
  });

  it("publishes no empty-catalogue answer before the first list read settles", async () => {
    const firstList = deferred<Artwork[]>();
    getCatalogueArtworks.mockReturnValueOnce(firstList.promise);
    renderPage();

    await waitFor(() => expect(getCatalogueArtworks).toHaveBeenCalledTimes(1));
    // The catalogue is known but the list is not: the page is loading, not
    // empty.
    expect(screen.queryByText("No artworks in this catalogue yet.")).toBeNull();
    expect(screen.queryByText("0 artworks")).toBeNull();

    await act(async () => {
      firstList.resolve([]);
      await Promise.resolve();
    });
    expect(
      await screen.findByText("No artworks in this catalogue yet."),
    ).toBeInTheDocument();
  });

  it("publishes no no-results answer before the first search settles", async () => {
    const firstList = deferred<Artwork[]>();
    getCatalogueArtworks.mockReturnValueOnce(firstList.promise);
    renderPage(`${CANONICAL_PATH}?q=monet`);

    await waitFor(() => expect(getCatalogueArtworks).toHaveBeenCalledTimes(1));
    // An unanswered search has not concluded that nothing matched.
    expect(screen.queryByText(/No artworks match/)).toBeNull();
    expect(screen.queryByText("No artworks in this catalogue yet.")).toBeNull();

    await act(async () => {
      firstList.resolve([]);
      await Promise.resolve();
    });
    expect(
      await screen.findByText("No artworks match “monet”."),
    ).toBeInTheDocument();
  });

  it("keeps the previous rows and retries a failed search", async () => {
    getCatalogueArtworks
      .mockResolvedValueOnce([picasso])
      .mockRejectedValueOnce(new Error("offline"));
    renderPage();
    // The first read lands before the failure, so there is something to keep.
    expect(await screen.findByText("Blue Nude")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox"), "dali");

    expect(
      await screen.findByText("Failed to search artworks"),
    ).toBeInTheDocument();
    // A dropped connection does not wipe the page.
    expect(screen.getByText("Blue Nude")).toBeInTheDocument();

    getCatalogueArtworks.mockResolvedValue([dali]);
    await user.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() =>
      expect(screen.getByText("La persistencia")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Blue Nude")).toBeNull();
    expect(getCatalogueArtworks).toHaveBeenLastCalledWith(CATALOGUE_ID, "dali");
  });

  it("replaces the table with the failure when there are no previous rows", async () => {
    getCatalogueArtworks.mockRejectedValue(new Error("offline"));
    renderPage();

    // No query is active, so this is the list's failure, not a search's.
    expect(
      await screen.findByText("Failed to fetch artworks"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText("No artworks in this catalogue yet.")).toBeNull();
  });

  it("says a search failed only when a query was active", async () => {
    getCatalogueArtworks.mockRejectedValue(new Error("offline"));
    renderPage(`${CANONICAL_PATH}?q=monet`);

    expect(
      await screen.findByText("Failed to search artworks"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("keeps a catalogue-load failure as the page-level error", async () => {
    getCatalogue.mockRejectedValue(new Error("offline"));
    renderPage();

    expect(
      await screen.findByText("Failed to fetch catalogue data"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("refuses a query with more than ten words before sending it", async () => {
    renderPage();
    const input = await screen.findByRole("textbox");
    await waitFor(() => expect(getCatalogueArtworks).toHaveBeenCalledTimes(1));

    // One change carrying the whole over-cap query: each pause is a commit,
    // and this is the one that must be explained rather than sent.
    fireEvent.change(input, {
      target: {
        value: "one two three four five six seven eight nine ten eleven",
      },
    });

    expect(
      await screen.findByText("Use 10 words or fewer."),
    ).toBeInTheDocument();
    // Explained instead of sent: no round trip, and no address change.
    expect(getCatalogueArtworks).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("location").textContent).toBe(CANONICAL_PATH);
  });

  it("discards a stale answer when an older search resolves last", async () => {
    getCatalogueArtworks.mockResolvedValueOnce([picasso]);
    renderPage();
    await screen.findByText("Blue Nude");

    let resolveFirst!: (rows: Artwork[]) => void;
    let resolveSecond!: (rows: Artwork[]) => void;
    getCatalogueArtworks
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
    await user.type(screen.getByRole("textbox"), "p");
    await waitFor(() =>
      expect(getCatalogueArtworks).toHaveBeenLastCalledWith(CATALOGUE_ID, "p"),
    );
    await user.type(screen.getByRole("textbox"), "i");
    await waitFor(() =>
      expect(getCatalogueArtworks).toHaveBeenLastCalledWith(CATALOGUE_ID, "pi"),
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

/**
 * The page is the one place that knows the catalogue's configuration, so it is
 * where the manage list learns whether a work's market state belongs on screen.
 * The API is a superset, so Availability's resolved state — not the row, and no
 * longer the Kind — is what hides it (ADR-0010's per-Kind rule is gone).
 */
describe("the manage view — a work's market state", () => {
  it("shows it for a Catalogue that records Availability", async () => {
    getCatalogue.mockResolvedValue({ ...catalogue, kind: "portfolio" });
    getCatalogueArtworks.mockResolvedValue([
      artwork({ id: "a1", title: "Blue Nude", availability: "sold" }),
    ]);
    renderPage();

    expect(await screen.findByText("Blue Nude")).toBeInTheDocument();
    expect(screen.getByText("Sold")).toBeInTheDocument();
  });

  it("shows it for a Collection that switched Availability on, in both views", async () => {
    // The flattening, end to end: the badge follows the Catalogue's choice, so
    // a Kind whose default is off still badges the state it records.
    getCatalogue.mockResolvedValue({
      ...catalogue,
      artworkFields: { availability: true },
    });
    getCatalogueArtworks.mockResolvedValue([
      artwork({ id: "a1", title: "Blue Nude", availability: "sold" }),
    ]);
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("Blue Nude")).toBeInTheDocument();
    // The Grid is the default view, so the card carries the badge.
    expect(screen.getByText("Sold")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Table" }));
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Sold")).toBeInTheDocument();
  });

  it("hides it for a Collection that does not record it, whatever the work carries", async () => {
    getCatalogueArtworks.mockResolvedValue([
      artwork({ id: "a1", title: "Blue Nude", availability: "sold" }),
    ]);
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("Blue Nude")).toBeInTheDocument();
    expect(screen.queryByText("Sold")).toBeNull();

    // The Table honours the same flag: the badge is absent there too.
    await user.click(screen.getByRole("radio", { name: "Table" }));
    const table = await screen.findByRole("table");
    expect(within(table).queryByText("Sold")).toBeNull();
  });
});
