// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import * as rtl from "@testing-library/react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ArtworkEditPage from "@/components/manage/ArtworkEditPage";
import type { Artwork, Collection } from "@/types";

/**
 * The Add → Edit handoff for a partial failure.
 *
 * The Add page creates the artwork, then uploads photos, then documents, and
 * only the *last* step is optional about its outcome. A failure in either upload
 * leaves a saved artwork that is missing files, and the only place the user can
 * fix that is the Edit page — which is why the Add page redirects there even on
 * failure, and carries the reason in `warn` so the message survives the hop.
 *
 * These are the two things worth pinning about that: the message *arrives*, and
 * it is *stripped* afterwards. The second is easy to skip and expensive to skip —
 * `warn` says an upload failed, and the fix is on the very page the param points
 * at, so a param left in the URL re-raises a warning about a failure that has
 * since been fixed. A stale alarm is worse than none: it teaches the reader to
 * ignore the one message that matters.
 *
 * Only the Edit page is imported. That is deliberate: it is the half with the
 * behaviour worth stating, and driving the Add page's three-write sequence
 * would be a test of the upload pipeline as much as of this param.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The two uploaders are replaced wholesale.
 *
 * Mocking their *hooks* would be the tighter seam, but each hook returns an
 * object large enough that a partial stub silently reads `undefined.length` on
 * some branch and throws during render — which unmounts the tree and makes the
 * warning this file is about invisible. The components are the honest boundary
 * here: what is under test is the page around them, not the upload pipeline
 * (covered by `photoUploader` and `documentsUploader`).
 */
vi.mock("@/components/manage/artwork/PhotoUploader", () => ({
  default: () => <div data-testid="photo-uploader" />,
}));
vi.mock("@/components/manage/artwork/DocumentsUploader", () => ({
  default: () => <div data-testid="documents-uploader" />,
}));

// The skin's Carousel: embla needs real rects, which jsdom has none of. The
// artwork view's own decision — that a warning renders at all — is what is under
// test here, not the slideshow.
vi.mock("@mantine/carousel", async () => {
  const { carouselMock } = await import("./helpers/carouselMock");
  return carouselMock();
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentUser: null }) }));

// Mantine sets the colour scheme on the root element through `matchMedia`,
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

const getArtwork = vi.fn<() => Promise<Artwork | null>>();
const updateArtwork = vi.fn<() => Promise<void>>();
const getCollection = vi.fn<() => Promise<Collection | null>>();

vi.mock("@/services/artworkService", () => ({
  artworkService: {
    getArtwork: (...args: unknown[]) =>
      (getArtwork as unknown as (...a: unknown[]) => unknown)(...args),
    updateArtwork: (...args: unknown[]) =>
      (updateArtwork as unknown as (...a: unknown[]) => unknown)(...args),
  },
}));

vi.mock("@/services/collectionService", () => ({
  collectionService: { getCollection: vi.fn() },
}));

vi.mock("@/services/imageService", () => ({ imageService: {} }));
vi.mock("@/services/documentService", () => ({ documentService: {} }));

const artwork = (overrides: Partial<Artwork> = {}): Artwork => ({
  id: ARTWORK_ID,
  userId: "owner-1",
  collectionId: COLLECTION_ID,
  title: "Estudio en rojo",
  artistName: "María López",
  isPublic: true,
  documents: [],
  photos: [],
  ...overrides,
});

/**
 * Reports the router's own location, so a navigation can be asserted.
 *
 * A `MemoryRouter` has no `window.location` to read, and asserting on
 * `window.history` would be asserting on the wrong thing entirely.
 */
const SearchProbe: React.FC = () => {
  const [params] = useSearchParams();
  const location = useLocation();
  return (
    <div data-testid="search">
      {location.pathname}
      {params.toString() ? `?${params.toString()}` : ""}
    </div>
  );
};

const renderAt = (search: string) =>
  rtl.render(
    <MantineProvider>
      <ModalsProvider>
        <MemoryRouter
          initialEntries={[
            `/manage/collection/flores-solares-${COLLECTION_ID}/artwork/estudio-en-rojo-${ARTWORK_ID}${search}`,
          ]}
        >
          {/*
            Outside the routes, so it reports the location whatever path the
            page is on — the strip only touches the query, so a route-gated probe
            would never render.
          */}
          <SearchProbe />
          <Routes>
            <Route
              path="/manage/collection/:collectionId/artwork/:artworkId"
              element={<ArtworkEditPage />}
            />
          </Routes>
        </MemoryRouter>
      </ModalsProvider>
    </MantineProvider>,
  );

beforeEach(() => {
  getArtwork.mockReset();
  updateArtwork.mockReset();
  getCollection.mockReset();
  getArtwork.mockResolvedValue(artwork());
  updateArtwork.mockResolvedValue(undefined);
  getCollection.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the `warn` param on the artwork view", () => {
  it("explains that the images are missing, and offers to fix them here", async () => {
    renderAt("?warn=photos");
    const warning = await screen.findByText(/images could not be uploaded/);
    expect(warning).toBeVisible();
    // "Add them below and save again" is the point: the user is already on the
    // only page that can put them back.
    expect(screen.getByText(/Add them below/)).toBeVisible();
  });

  it("distinguishes the documents case, so the user knows which uploader", async () => {
    renderAt("?warn=documents");
    expect(
      await screen.findByText(/documents could not be uploaded/),
    ).toBeVisible();
    // The other message must not also be on screen: "everything went wrong"
    // would send them to check the photo grid for a problem it does not have.
    expect(screen.queryByText(/images could not be uploaded/)).toBeNull();
  });

  it("strips the param once shown, so a refresh does not re-raise it", async () => {
    renderAt("?warn=photos");
    await screen.findByText(/images could not be uploaded/);

    // Observed from inside the tree, since a `MemoryRouter` has no window URL to
    // read. The message is still on screen — that is the point, it was captured
    // before the param went — while the URL has forgotten why.
    await waitFor(() =>
      expect(screen.getByTestId("search")).toHaveTextContent("/"),
    );
    expect(screen.getByTestId("search")).not.toHaveTextContent("warn");
    expect(screen.getByText(/images could not be uploaded/)).toBeVisible();
  });

  it("shows nothing for an unrecognised value", async () => {
    // A hand-edited `?warn=anything` must not reach a visitor as an alert
    // about their uploads. Read through a lookup rather than an `if` for
    // exactly this.
    renderAt("?warn=anything");
    await waitFor(() => expect(getArtwork).toHaveBeenCalled());
    expect(screen.queryByText(/could not be uploaded/)).toBeNull();
  });

  it("shows nothing when the param is absent", async () => {
    renderAt("");
    await waitFor(() => expect(getArtwork).toHaveBeenCalled());
    expect(screen.queryByText(/could not be uploaded/)).toBeNull();
  });
});
