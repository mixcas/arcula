// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ArtworkAddPage from "@/components/manage/ArtworkAddPage";
import { artworkService } from "@/services/artworkService";
import { catalogueService } from "@/services/catalogueService";
import { ApiRequestError } from "@/services/api";
import {
  MINTED_ID_SHAPE_RE,
  type Artwork,
  type Catalogue,
  type CatalogueKind,
} from "@arcula/shared";

/**
 * The Add page is now one write: the form fields, the client-minted artwork
 * id, and the staged photo/document entries go up in a single POST, and the
 * API promotes the staged objects in the same transaction. What is under
 * test is what the page sends and where each outcome lands:
 *
 * - the payload carries the id the hook staged under, and the staged entries
 *   the hooks' `commit()` answered — neither is the page's to mint or order;
 * - a success lands on the created work's manage page, slugged from the
 *   server's own title and id;
 * - a failure stays on the form (the only outcome where nothing was
 *   written), with the envelope message for a cap hit and a generic one
 *   otherwise.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * What each hook's `commit()` answers, per test.
 *
 * The hooks are mocked out, and `commit()` is the one seam the page reads at
 * submit: `null` means "leave it out of the payload" (nothing staged, on a
 * new work), a list means "promote these". Declared through `vi.hoisted`
 * because `vi.mock`'s factory is hoisted above the imports.
 */
const commits = vi.hoisted(() => ({
  photos: null as Array<{ entryId: string; name: string }> | null,
  documents: null as Array<{ entryId: string; name: string }> | null,
}));

/**
 * The uploader components are replaced wholesale.
 *
 * Mocking their hooks instead would be the tighter seam, but each returns an
 * object large enough that a partial stub reads `undefined` on some branch and
 * throws during render. The components are the honest boundary: what matters
 * is the page's save, not the upload pipeline (covered by `photoUploader` and
 * `documentsUploader`).
 */
vi.mock("@/components/manage/artwork/PhotoUploader", () => ({
  default: () => <div data-testid="photo-uploader" />,
}));
vi.mock("@/components/manage/artwork/DocumentsUploader", () => ({
  default: () => <div data-testid="documents-uploader" />,
}));

vi.mock("@/hooks/useArtworkPhotos", () => ({
  useArtworkPhotos: () =>
    ({
      commit: () => commits.photos,
      addFiles: vi.fn(),
    }) as unknown as ReturnType<
      typeof import("@/hooks/useArtworkPhotos").useArtworkPhotos
    >,
}));

vi.mock("@/hooks/useArtworkDocuments", () => ({
  useArtworkDocuments: () =>
    ({
      commit: () => commits.documents,
      addFiles: vi.fn(),
    }) as unknown as ReturnType<
      typeof import("@/hooks/useArtworkDocuments").useArtworkDocuments
    >,
}));

vi.mock("@/services/artworkService", () => ({
  artworkService: { createArtwork: vi.fn() },
}));

vi.mock("@/services/catalogueService", () => ({
  catalogueService: { getCatalogue: vi.fn() },
}));

// The page mounts the suggestions hook; an empty list is the ordinary
// no-catalogues answer, and keeps these save-path tests off the network.
vi.mock("@/services/artistNameService", () => ({
  artistNameService: { getArtistNames: vi.fn().mockResolvedValue([]) },
}));

// Mantine resolves the colour scheme and responsive props through `matchMedia`,
// which jsdom has no implementation of. Answering `true` only for the empty
// query is what Chrome does, and it keeps responsive props from collapsing.
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

const CATALOGUE_ID = "AAAAAAAAAAAAAAAAAAAA";
const ARTWORK_ID = "BBBBBBBBBBBBBBBBBBBB";
const CATALOGUE_PARAM = `flores-solares-${CATALOGUE_ID}`;
const CATALOGUE_NAME = "Flores Solares";

/** The server's answer for a created work. */
const created = (overrides: Partial<Artwork> = {}): Artwork => ({
  id: ARTWORK_ID,
  userId: "owner-1",
  catalogueId: CATALOGUE_ID,
  title: "Estudio en rojo",
  artistName: "María López",
  status: "published",
  photos: [],
  documents: [],
  ...overrides,
});

/* eslint-disable @typescript-eslint/unbound-method */
const createArtwork = vi.mocked(artworkService.createArtwork);
const getCatalogue = vi.mocked(catalogueService.getCatalogue);
/* eslint-enable @typescript-eslint/unbound-method */

const catalogue = (
  kind: CatalogueKind,
  overrides: Partial<Catalogue> = {},
): Catalogue => ({
  id: CATALOGUE_ID,
  name: CATALOGUE_NAME,
  kind,
  userId: "owner-1",
  isPublic: true,
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 1, nanoseconds: 0 },
  ...overrides,
});

/** The router's own location, so a navigation can be asserted. */
const LocationProbe: React.FC = () => {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
};

const renderPage = (search = "") =>
  render(
    <MantineProvider>
      <ModalsProvider>
        <Notifications />
        <MemoryRouter
          initialEntries={[
            `/manage/catalogue/${CATALOGUE_PARAM}/artwork/add${search}`,
          ]}
        >
          {/* Outside the routes, so it reports wherever the page lands — the Add
              route has no wildcard to fall back to. */}
          <LocationProbe />
          <Routes>
            <Route
              path="/manage/catalogue/:catalogueId/artwork/add"
              element={<ArtworkAddPage />}
            />
          </Routes>
        </MemoryRouter>
      </ModalsProvider>
    </MantineProvider>,
  );

/**
 * Where the page is expected to send the user, spelled out rather than built
 * from `artworkSlug`.
 *
 * The slug the page produces is part of what it decides, and deriving the
 * expectation from the same helper would make this a tautology — a change to
 * `artworkSlug` would change both sides at once. The one case that would not
 * survive this spelling is a deliberate change to the URL shape, which is
 * exactly the change worth being told about.
 */
const editPath = () =>
  `/manage/catalogue/${CATALOGUE_PARAM}/artwork/estudio-en-rojo-${ARTWORK_ID}`;

/** Fills the two required fields and saves. */
const save = async (
  user: ReturnType<typeof userEvent.setup>,
  title = "Estudio en rojo",
  artist = "María López",
) => {
  // The page waits for the catalogue's kind before it shows the fields, so a
  // test that saves has to wait for the form too.
  // Regex, because Mantine appends a required marker and the accessible name
  // is "Title *" rather than "Title". Artist Name is narrowed to the input:
  // the Autocomplete's listbox is labelled by the same text, so a bare label
  // query would match the dropdown too.
  await user.type(await screen.findByLabelText(/^Title/), title);
  const artistField = screen.getByLabelText(/^Artist Name/, {
    selector: "input",
  });
  // A Portfolio arrives holding its own artist, so the field is emptied before
  // the wanted name is typed into it: `type` would append to the default and
  // make every saved artist a different string than the one named here.
  await user.clear(artistField);
  await user.type(artistField, artist);
  await user.click(screen.getByRole("button", { name: "Save Artwork" }));
};

const landedAt = () => screen.getByTestId("location").textContent;

beforeEach(() => {
  commits.photos = null;
  commits.documents = null;
  createArtwork.mockResolvedValue(created());
  // A Collection by default: the plain form, with no market-state control.
  // The availability tests below ask for a Portfolio or an Inventory.
  getCatalogue.mockResolvedValue(catalogue("collection"));
});

afterEach(() => {
  // The catch logs the failure it is about to report, which is right in
  // production and noise here; these tests are about where the page goes.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  cleanup();
  vi.clearAllMocks();
});

describe("the Add page — the single write", () => {
  it("creates the work with the minted id and the staged entries, and lands on its page", async () => {
    commits.photos = [{ entryId: "p1", name: "scan.jpg" }];
    commits.documents = [{ entryId: "d1", name: "report.pdf" }];
    const user = userEvent.setup();
    renderPage();
    // No search was active, so the back control is the catalogue's plain
    // address.
    expect(
      await screen.findByRole("link", { name: `Back to ${CATALOGUE_NAME}` }),
    ).toHaveAttribute("href", `/manage/catalogue/${CATALOGUE_PARAM}`);
    await save(user);

    await waitFor(() => expect(landedAt()).toBe(editPath()));
    expect(createArtwork).toHaveBeenCalledTimes(1);
    const [catalogueId, body] = createArtwork.mock.calls[0];
    expect(catalogueId).toBe(CATALOGUE_ID);
    // The id the page staged under: minted from the shared contract — the
    // same mint the API uses — and ten base62 characters, never a hyphen. The
    // redirect below lands on `{title}-{id}`, and the route recovers the id by
    // cutting at the last hyphen.
    expect(body.artworkId).toMatch(MINTED_ID_SHAPE_RE);
    expect(body.title).toBe("Estudio en rojo");
    expect(body.artistName).toBe("María López");
    // A work the owner did not say otherwise about goes in front of the
    // catalogue's gate.
    expect(body.status).toBe("published");
    // The staged entries pass through the hook's answer untouched: the page
    // neither reorders nor re-names them.
    expect(body.photos).toEqual(commits.photos);
    expect(body.documents).toEqual(commits.documents);
  });

  it("submits the typed medium under the medium key", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText(/^Medium/), "Oil on canvas");
    await save(user);

    await waitFor(() => expect(landedAt()).toBe(editPath()));
    expect(createArtwork.mock.calls[0][1].medium).toBe("Oil on canvas");
  });

  it("carries the active search through the back control and the new work's page", async () => {
    const user = userEvent.setup();
    renderPage("?q=picasso");

    // The back control returns to the search the user left, not to the whole
    // catalogue.
    expect(
      await screen.findByRole("link", { name: `Back to ${CATALOGUE_NAME}` }),
    ).toHaveAttribute("href", `/manage/catalogue/${CATALOGUE_PARAM}?q=picasso`);

    await save(user);

    // The new work's Edit page carries it too, so its own back control still
    // returns to that search.
    await waitFor(() => expect(landedAt()).toBe(`${editPath()}?q=picasso`));
  });

  it("lets the owner send a new work as a draft", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("radio", { name: "Draft" }));
    await save(user);

    await waitFor(() => expect(landedAt()).toBe(editPath()));
    // The chosen status, not the default: a click on the control is what
    // makes this a choice rather than a constant.
    expect(createArtwork.mock.calls[0][1].status).toBe("draft");
  });

  it("sends empty sequences when nothing was staged", async () => {
    const user = userEvent.setup();
    renderPage();
    await save(user);

    await waitFor(() => expect(landedAt()).toBe(editPath()));
    const [, body] = createArtwork.mock.calls[0];
    expect(body.photos).toEqual([]);
    expect(body.documents).toEqual([]);
  });

  it("stays on the form when the create fails, with the generic message", async () => {
    // The one outcome where nothing was written, so the form still holds
    // everything the user typed and there is nothing to redirect away from.
    createArtwork.mockRejectedValue(
      new ApiRequestError(400, "validation", "Title is required"),
    );
    const user = userEvent.setup();
    renderPage();
    await save(user);

    expect(
      await screen.findByText("Failed to create artwork. Please try again."),
    ).toBeVisible();
    expect(landedAt()).toContain("/artwork/add");
  });

  it("renders the server's own message for a limit-reached refusal", async () => {
    // The one failure with prose worth showing verbatim: everything else stays
    // generic so the alert does not leak a status line.
    const capMessage = "An artwork may have at most 10 photos";
    createArtwork.mockRejectedValue(
      new ApiRequestError(409, "limit-reached", capMessage),
    );
    const user = userEvent.setup();
    renderPage();
    await save(user);

    expect(await screen.findByText(capMessage)).toBeVisible();
    expect(landedAt()).toContain("/artwork/add");
  });
});

/**
 * Availability is the Catalogue's choice now, not the Kind's: every Kind offers
 * the same four states, a new work starts Available when the field is enabled,
 * and neither the control nor the key exists when it is off.
 */
describe("the Add page — the catalogue's Availability field", () => {
  it.each(["portfolio", "inventory"] as const)(
    "offers a %s work a market state, defaulting to available",
    async (kind) => {
      getCatalogue.mockResolvedValue(catalogue(kind));
      const user = userEvent.setup();
      renderPage();

      // The select is only there once the catalogue's fields are known.
      const select = await screen.findByRole("combobox", {
        name: /^Availability/,
      });
      expect(select).toHaveValue("Available");
      await save(user);

      await waitFor(() => expect(landedAt()).toBe(editPath()));
      expect(createArtwork.mock.calls[0][1].availability).toBe("available");
    },
  );

  it("offers a Collection that records Availability the control too", async () => {
    // The flattening: a Collection is no longer a Kind that carries no market
    // state, so switching the field on gives it the same control.
    getCatalogue.mockResolvedValue(
      catalogue("collection", { artworkFields: { availability: true } }),
    );
    const user = userEvent.setup();
    renderPage();

    const select = await screen.findByRole("combobox", {
      name: /^Availability/,
    });
    expect(select).toHaveValue("Available");
    await save(user);

    await waitFor(() => expect(landedAt()).toBe(editPath()));
    expect(createArtwork.mock.calls[0][1].availability).toBe("available");
  });

  it("sends the state the owner picks", async () => {
    // On-consignment is offered on every Kind now, so the pick is made on the
    // plainest one.
    getCatalogue.mockResolvedValue(
      catalogue("collection", { artworkFields: { availability: true } }),
    );
    const user = userEvent.setup();
    renderPage();

    const select = await screen.findByRole("combobox", {
      name: /^Availability/,
    });
    await user.click(select);
    await waitFor(() =>
      expect(select).toHaveAttribute("aria-expanded", "true"),
    );
    // jsdom gives the portal's option rows no accessible name, so the row is
    // found by its visible text (the Table suite reads its Select the same
    // way).
    const option = screen
      .queryAllByRole("option", { hidden: true })
      .find((entry) => entry.textContent === "On consignment");
    expect(option).toBeDefined();
    await user.click(option!);
    await save(user);

    await waitFor(() => expect(landedAt()).toBe(editPath()));
    expect(createArtwork.mock.calls[0][1].availability).toBe("on-consignment");
  });

  it("offers a Portfolio the on-consignment state too", async () => {
    // All four states on every Kind: the per-Kind list is gone, and a Portfolio
    // can record work it holds on consignment.
    getCatalogue.mockResolvedValue(catalogue("portfolio"));
    const user = userEvent.setup();
    renderPage();

    const select = await screen.findByRole("combobox", {
      name: /^Availability/,
    });
    await user.click(select);
    await waitFor(() =>
      expect(select).toHaveAttribute("aria-expanded", "true"),
    );
    const options = screen
      .queryAllByRole("option", { hidden: true })
      .map((entry) => entry.textContent);
    expect(options).toContain("Sold");
    expect(options).toContain("On consignment");
  });

  it("offers a Collection no market state and sends none by default", async () => {
    const user = userEvent.setup();
    renderPage();

    // The catalogue must have loaded before the absence means anything: the
    // form is only on screen once its fields are known.
    await screen.findByLabelText(/^Title/);
    expect(
      screen.queryByRole("combobox", { name: /^Availability/ }),
    ).toBeNull();
    await save(user);

    await waitFor(() => expect(landedAt()).toBe(editPath()));
    expect(createArtwork.mock.calls[0][1]).not.toHaveProperty("availability");
  });

  it("sends no availability on a Portfolio that switched the field off", async () => {
    // The field follows the Catalogue's configuration in both directions: a
    // Kind whose default is on can still hold nothing.
    getCatalogue.mockResolvedValue(
      catalogue("portfolio", { artworkFields: { availability: false } }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText(/^Title/);
    expect(
      screen.queryByRole("combobox", { name: /^Availability/ }),
    ).toBeNull();
    await save(user);

    await waitFor(() => expect(landedAt()).toBe(editPath()));
    expect(createArtwork.mock.calls[0][1]).not.toHaveProperty("availability");
  });

  it("stays on the form when the catalogue itself cannot be loaded", async () => {
    getCatalogue.mockResolvedValue(null);
    renderPage();

    expect(await screen.findByText("Catalogue not found")).toBeVisible();
    expect(screen.queryByLabelText(/^Title/)).toBeNull();
  });
});

/**
 * A Portfolio's name *is* the artist's name (ADR-0010), so a work added to one
 * starts credited to that artist. It is a creation-time default, not a derived
 * fact: the field stays editable and required, and whatever is typed is what
 * the save records. An Inventory's name is the gallery's and a Collection's is
 * the collector's, so neither prefills.
 */
describe("the Add page — the Artist Name a new work starts with", () => {
  it("starts a Portfolio work credited to the portfolio", async () => {
    getCatalogue.mockResolvedValue(catalogue("portfolio"));
    renderPage();

    const artistField = await screen.findByLabelText(/^Artist Name/, {
      selector: "input",
    });
    expect(artistField).toHaveValue(CATALOGUE_NAME);
  });

  it.each([
    { kind: "inventory" as const, label: "an Inventory" },
    { kind: "collection" as const, label: "a Collection" },
  ])("starts $label work with an empty Artist Name", async ({ kind }) => {
    getCatalogue.mockResolvedValue(catalogue(kind));
    renderPage();

    const artistField = await screen.findByLabelText(/^Artist Name/, {
      selector: "input",
    });
    expect(artistField).toHaveValue("");
  });

  it("records the artist the owner types over the default", async () => {
    getCatalogue.mockResolvedValue(catalogue("portfolio"));
    const user = userEvent.setup();
    renderPage();
    await save(user, "Estudio en rojo", "Estate of Flores Solares");

    await waitFor(() => expect(landedAt()).toBe(editPath()));
    // The typed name, not the catalogue's: the default is a starting value the
    // field may be written over, so an attribution saves as it was typed.
    expect(createArtwork.mock.calls[0][1].artistName).toBe(
      "Estate of Flores Solares",
    );
  });

  it("still requires an artist, even on a Portfolio that prefilled one", async () => {
    getCatalogue.mockResolvedValue(catalogue("portfolio"));
    const user = userEvent.setup();
    renderPage();

    // The prefill is a default, not a substitute for the field: an owner who
    // empties it gets the ordinary required-field refusal and nothing is
    // written.
    const artistField = await screen.findByLabelText(/^Artist Name/, {
      selector: "input",
    });
    await user.type(await screen.findByLabelText(/^Title/), "Estudio en rojo");
    await user.clear(artistField);
    await user.click(screen.getByRole("button", { name: "Save Artwork" }));

    expect(await screen.findByText("Artist name is required")).toBeVisible();
    expect(createArtwork).not.toHaveBeenCalled();
  });
});

/**
 * The form renders the catalogue's Artwork fields, not Arcula's whole list:
 * a field the catalogue does not record is absent, and a Kind default the
 * member overrode follows the member's choice. Title and Artist Name are
 * always there, and the save never names a field the form did not show.
 */
describe("the Add page — the catalogue's Artwork fields", () => {
  it("hides a Portfolio's default-off acquisition fields and shows the rest", async () => {
    getCatalogue.mockResolvedValue(catalogue("portfolio"));
    renderPage();

    // The kind's defaults arrive once the catalogue has loaded.
    expect(await screen.findByLabelText(/^Medium/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Acquisition Price/)).toBeNull();
    expect(screen.queryByLabelText(/^Acquisition Date/)).toBeNull();
    // The two fixed fields are always recorded.
    expect(screen.getByLabelText(/^Title/)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/^Artist Name/, { selector: "input" }),
    ).toBeInTheDocument();
  });

  it("shows a field the member switched on against the Kind default", async () => {
    getCatalogue.mockResolvedValue(
      catalogue("portfolio", { artworkFields: { acquisitionPrice: true } }),
    );
    renderPage();

    expect(
      await screen.findByLabelText(/^Acquisition Price/),
    ).toBeInTheDocument();
  });

  it("hides a field the member switched off against the Kind default", async () => {
    getCatalogue.mockResolvedValue(
      catalogue("collection", { artworkFields: { provenance: false } }),
    );
    renderPage();

    expect(await screen.findByLabelText(/^Medium/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Provenance/)).toBeNull();
  });

  it("sends no key for a disabled field", async () => {
    getCatalogue.mockResolvedValue(
      catalogue("collection", { artworkFields: { notes: false } }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText(/^Medium/), "Oil on canvas");
    await save(user);

    await waitFor(() => expect(landedAt()).toBe(editPath()));
    const [, body] = createArtwork.mock.calls[0];
    expect(body.medium).toBe("Oil on canvas");
    expect(body).not.toHaveProperty("notes");
  });
});
