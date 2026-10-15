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
import { ApiRequestError } from "@/services/api";
import type { Artwork } from "@arcula/shared";

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

const COLLECTION_ID = "AAAAAAAAAAAAAAAAAAAA";
const ARTWORK_ID = "BBBBBBBBBBBBBBBBBBBB";
const COLLECTION_PARAM = `flores-solares-${COLLECTION_ID}`;

/** The server's answer for a created work. */
const created = (overrides: Partial<Artwork> = {}): Artwork => ({
  id: ARTWORK_ID,
  userId: "owner-1",
  collectionId: COLLECTION_ID,
  title: "Estudio en rojo",
  artistName: "María López",
  isPublic: true,
  photos: [],
  documents: [],
  ...overrides,
});

/* eslint-disable @typescript-eslint/unbound-method */
const createArtwork = vi.mocked(artworkService.createArtwork);
/* eslint-enable @typescript-eslint/unbound-method */

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

const renderPage = () =>
  render(
    <MantineProvider>
      <ModalsProvider>
        <Notifications />
        <MemoryRouter
          initialEntries={[
            `/manage/collection/${COLLECTION_PARAM}/artwork/add`,
          ]}
        >
          {/* Outside the routes, so it reports wherever the page lands — the Add
              route has no wildcard to fall back to. */}
          <LocationProbe />
          <Routes>
            <Route
              path="/manage/collection/:collectionId/artwork/add"
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
  `/manage/collection/${COLLECTION_PARAM}/artwork/estudio-en-rojo-${ARTWORK_ID}`;

/** Fills the two required fields and saves. */
const save = async (
  user: ReturnType<typeof userEvent.setup>,
  title = "Estudio en rojo",
) => {
  // Regex, because Mantine appends a required marker and the accessible name
  // is "Title *" rather than "Title".
  await user.type(screen.getByLabelText(/^Title/), title);
  await user.type(screen.getByLabelText(/^Artist Name/), "María López");
  await user.click(screen.getByRole("button", { name: "Save Artwork" }));
};

const landedAt = () => screen.getByTestId("location").textContent;

beforeEach(() => {
  commits.photos = null;
  commits.documents = null;
  createArtwork.mockResolvedValue(created());
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
    await save(user);

    await waitFor(() => expect(landedAt()).toBe(editPath()));
    expect(createArtwork).toHaveBeenCalledTimes(1);
    const [collectionId, body] = createArtwork.mock.calls[0];
    expect(collectionId).toBe(COLLECTION_ID);
    // The id the hook staged under: minted by the page on mount, and
    // hyphen-free — the redirect below lands on `{title}-{id}`, and the route
    // recovers the id by cutting at the last hyphen, which would land inside a
    // hyphenated one.
    expect(body.artworkId).toMatch(/^[0-9a-f]{32}$/);
    expect(body.title).toBe("Estudio en rojo");
    expect(body.artistName).toBe("María López");
    expect(body.isPublic).toBe(true);
    // The staged entries pass through the hook's answer untouched: the page
    // neither reorders nor re-names them.
    expect(body.photos).toEqual(commits.photos);
    expect(body.documents).toEqual(commits.documents);
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
