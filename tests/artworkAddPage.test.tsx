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
import { imageService } from "@/services/imageService";
import { documentService } from "@/services/documentService";

/**
 * Which upload stage failed, and where the user is sent as a result.
 *
 * The Add page is a three-write sequence — create, then photos, then documents —
 * and past the first write the document exists whether or not the rest succeed.
 * That splits the outcomes in two: only a failed *create* leaves a form worth
 * staying on, and every other failure leaves a saved artwork missing files, which
 * only the Edit page can put back. So the page redirects on all three of those
 * and stays on exactly one.
 *
 * What is under test is that split, and the `stage` variable that decides it. A
 * `stage` that never advances would report "Failed to create artwork" for a save
 * that had in fact written the document — and a user told their work was never
 * saved creates it a second time.
 *
 * The receiving end of the redirect is `tests/artworkFormSave.test.tsx`, which
 * owns the `warn` param: that the message arrives, and that it is stripped
 * afterwards. Splitting it this way keeps each file on one half of the handoff.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * What is waiting to be uploaded, per hook.
 *
 * Each upload stage only runs when its list is non-empty, and the uploaders that
 * would fill those lists are mocked out — so the lists are the seam. Declared
 * through `vi.hoisted` because `vi.mock`'s factory is hoisted above the imports
 * and would run before this binding existed.
 */
const pending = vi.hoisted(() => ({
  photos: [] as unknown[],
  documents: [] as unknown[],
}));

/**
 * The uploader components are replaced wholesale.
 *
 * Mocking their hooks instead would be the tighter seam, but each returns an
 * object large enough that a partial stub reads `undefined.length` on some
 * branch and throws during render, which unmounts the tree and makes the thing
 * under test invisible. The components are the honest boundary: what matters is
 * the page's sequencing, not the upload pipeline (covered by `photoUploader` and
 * `documentsUploader`).
 */
vi.mock("@/components/manage/artwork/PhotoUploader", () => ({
  default: () => <div data-testid="photo-uploader" />,
}));
vi.mock("@/components/manage/artwork/DocumentsUploader", () => ({
  default: () => <div data-testid="documents-uploader" />,
}));

// Cast because a stub cannot be the real thing, and the real hook cannot be told
// to report a pending upload without a `File` behind it.
vi.mock("@/hooks/useArtworkPhotos", () => ({
  useArtworkPhotos: () =>
    ({
      pendingImages: pending.photos,
      pendingFiles: [],
      entries: [],
      count: pending.photos.length,
      processing: false,
      progress: null,
      dirty: pending.photos.length > 0,
      hasRoom: true,
      variantWebp: true,
      removedStoredIds: [],
      addFiles: vi.fn(),
      remove: vi.fn(),
      reorder: vi.fn(),
      makePrimary: vi.fn(),
      hydrate: vi.fn(),
      // The page writes the service's list straight back, so the merge has to be
      // callable. What it returns is the service's business, not this page's.
      mergeUploaded: (uploaded: unknown) => uploaded,
      commit: () => null,
    }) as unknown as ReturnType<
      typeof import("@/hooks/useArtworkPhotos").useArtworkPhotos
    >,
}));

vi.mock("@/hooks/useArtworkDocuments", () => ({
  useArtworkDocuments: () =>
    ({
      pendingUploads: pending.documents,
      entries: [],
      count: pending.documents.length,
      processing: false,
      progress: null,
      dirty: pending.documents.length > 0,
      hasRoom: true,
      removedStoredIds: [],
      addFiles: vi.fn(),
      remove: vi.fn(),
      reorder: vi.fn(),
      hydrate: vi.fn(),
      mergeUploaded: (uploaded: unknown) => uploaded,
      commit: () => null,
    }) as unknown as ReturnType<
      typeof import("@/hooks/useArtworkDocuments").useArtworkDocuments
    >,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ currentUser: { uid: "owner-1" } }),
}));

vi.mock("@/services/artworkService", () => ({
  artworkService: { createArtwork: vi.fn(), updateArtwork: vi.fn() },
}));
vi.mock("@/services/imageService", () => ({
  imageService: { uploadArtworkPhotos: vi.fn() },
}));
vi.mock("@/services/documentService", () => ({
  documentService: { uploadArtworkDocuments: vi.fn() },
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

/**
 * Every step, in the order it was reached.
 *
 * A shared log rather than call counts, because the property is the *sequence*:
 * the merged single-write version this replaced also makes three calls, and a
 * count of two updates is equally true of it.
 */
const log: string[] = [];

/**
 * The mocked service functions, held once.
 *
 * The services are typed with real signatures, so the linter reads a bare
 * reference to one of their methods as an unbound call — correctly, in general.
 * Here it is not one: these are the stand-ins, and the objects they hang off are
 * not what the tests are about. Held as locals so the four read the same way at
 * every use, which is the same reason `artworksTable.test.tsx` does this.
 */
/* eslint-disable @typescript-eslint/unbound-method */
const createArtwork = vi.mocked(artworkService.createArtwork);
const updateArtwork = vi.mocked(artworkService.updateArtwork);
const uploadArtworkPhotos = vi.mocked(imageService.uploadArtworkPhotos);
const uploadArtworkDocuments = vi.mocked(
  documentService.uploadArtworkDocuments,
);
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
const editPath = (query = "") =>
  `/manage/collection/${COLLECTION_PARAM}/artwork/estudio-en-rojo-${ARTWORK_ID}${query}`;

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
  pending.photos = [];
  pending.documents = [];
  log.length = 0;

  // Each returns a resolved promise rather than being `async`: none of them
  // waits for anything, and the `await` would be decorative.
  createArtwork.mockImplementation(() => {
    log.push("create");
    return Promise.resolve(ARTWORK_ID);
  });
  updateArtwork.mockImplementation((_id, patch) => {
    // Which field the update carried is what distinguishes the two writes, so
    // the log records it rather than just counting them.
    log.push("photos" in patch ? "photos:update" : "documents:update");
    return Promise.resolve();
  });
  uploadArtworkPhotos.mockImplementation(() => {
    log.push("photos");
    return Promise.resolve([]);
  });
  uploadArtworkDocuments.mockImplementation(() => {
    log.push("documents");
    return Promise.resolve([]);
  });
});

afterEach(() => {
  // The catch logs the failure it is about to report, which is right in
  // production and noise here; these tests are about where the page goes.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("the Add page — where each outcome lands", () => {
  it("sends a clean save to the artwork's own page, with no warning", async () => {
    const user = userEvent.setup();
    renderPage();
    await save(user);

    await waitFor(() => expect(landedAt()).toBe(editPath()));
    // The param is omitted on the success path so the URL stays clean, and so a
    // later refresh cannot re-raise a warning about an upload that worked.
    expect(landedAt()).not.toContain("warn");
  });

  it("stays on the form when the create itself failed", async () => {
    // The one outcome where nothing was written, so the form still holds
    // everything the user typed and there is nothing to redirect away from.
    createArtwork.mockRejectedValue(new Error("permission-denied"));
    const user = userEvent.setup();
    renderPage();
    await save(user);

    expect(await screen.findByText(/failed to create artwork/i)).toBeVisible();
    // And no upload was attempted: the artwork has no id to put objects under
    // until the document exists.
    expect(landedAt()).toContain("/artwork/add");
    expect(uploadArtworkPhotos).not.toHaveBeenCalled();
    expect(uploadArtworkDocuments).not.toHaveBeenCalled();
  });

  it("redirects with a photos warning when the photos fail", async () => {
    pending.photos = [{ id: "pending-1" }];
    uploadArtworkPhotos.mockRejectedValue(new Error("storage/unauthorized"));
    const user = userEvent.setup();
    renderPage();
    await save(user);

    // The document exists by now, so this form can no longer fix it.
    await waitFor(() => expect(landedAt()).toBe(editPath("?warn=photos")));
  });

  it("redirects with a documents warning when the documents fail", async () => {
    // The photos uploaded fine. This is the distinguishing case: keying the
    // message on "are there still pending images" would report the *photos* as
    // broken, because the pending list still holds them after a successful
    // upload. Sending the user to a photo grid with nothing wrong in it is the
    // exact waste the `stage` variable exists to prevent.
    pending.photos = [{ id: "pending-1" }];
    pending.documents = [{ id: "pending-2" }];
    uploadArtworkDocuments.mockRejectedValue(new Error("storage/unauthorized"));
    const user = userEvent.setup();
    renderPage();
    await save(user);

    await waitFor(() => expect(landedAt()).toBe(editPath("?warn=documents")));
  });

  it("writes the photos before the documents, each as its own update", async () => {
    // Two independent updates rather than one merged write. Merged, a document
    // failure would land after the photos were recorded and report the whole
    // save as failed — or, swallowed to avoid that, leave the photo references
    // unrecorded and their objects orphaned in Storage.
    pending.photos = [{ id: "pending-1" }];
    pending.documents = [{ id: "pending-2" }];
    const user = userEvent.setup();
    renderPage();
    await save(user);

    await waitFor(() => expect(landedAt()).toBe(editPath()));
    expect(log).toEqual([
      "create",
      "photos",
      "photos:update",
      "documents",
      "documents:update",
    ]);
  });

  it("attempts no upload stage with nothing queued", async () => {
    // The common case is an artwork with no files, and it must not call the
    // upload services with empty lists: `stage` only advances inside the
    // `length > 0` guards, so no `?warn` can be raised for work never sent.
    const user = userEvent.setup();
    renderPage();
    await save(user);

    await waitFor(() => expect(landedAt()).toBe(editPath()));
    expect(uploadArtworkPhotos).not.toHaveBeenCalled();
    expect(uploadArtworkDocuments).not.toHaveBeenCalled();
  });
});
