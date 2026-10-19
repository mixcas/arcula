// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ArtworkEditPage from "@/components/manage/ArtworkEditPage";
import { artworkService } from "@/services/artworkService";
import type { Artwork, ArtworkUpdatePayload } from "@arcula/shared";

/**
 * The Edit save is one PATCH, and the status is one of the fields it may carry.
 * What is under test is the round trip the owner sees: the status a stored work
 * arrives with is the one the control shows, and the one the control ends on is
 * the one the PATCH sends.
 *
 * The uploaders are replaced wholesale, as in the Add page's suite: the hooks
 * are large enough that a partial stub throws on some branch during render, and
 * what matters here is the page's save, not the upload pipeline.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/manage/artwork/PhotoUploader", () => ({
  default: () => <div data-testid="photo-uploader" />,
}));
vi.mock("@/components/manage/artwork/DocumentsUploader", () => ({
  default: () => <div data-testid="documents-uploader" />,
}));

// The page holds `hydrate` in an effect dependency list, so a fresh function
// per render re-runs the load, which re-renders, which re-runs the load. The
// stubs are therefore allocated once, not inside the hook body — the real hooks
// return stable callbacks for the same reason.
const hooks = vi.hoisted(() => ({
  commit: (): null => null,
  hydrate: (): void => undefined,
  addFiles: (): void => undefined,
}));

vi.mock("@/hooks/useArtworkPhotos", () => ({
  useArtworkPhotos: () =>
    ({
      commit: hooks.commit,
      hydrate: hooks.hydrate,
      addFiles: hooks.addFiles,
    }) as unknown as ReturnType<
      typeof import("@/hooks/useArtworkPhotos").useArtworkPhotos
    >,
}));

vi.mock("@/hooks/useArtworkDocuments", () => ({
  useArtworkDocuments: () =>
    ({
      commit: hooks.commit,
      hydrate: hooks.hydrate,
      addFiles: hooks.addFiles,
    }) as unknown as ReturnType<
      typeof import("@/hooks/useArtworkDocuments").useArtworkDocuments
    >,
}));

vi.mock("@/services/artworkService", () => ({
  artworkService: { getArtwork: vi.fn(), updateArtwork: vi.fn() },
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

// Opaque ids, not `"artwork-1"`: a manage URL is "{slug}-{id}" and the route
// recovers the id by cutting at the last hyphen.
const COLLECTION_ID = "AAAAAAAAAAAAAAAAAAAA";
const ARTWORK_ID = "BBBBBBBBBBBBBBBBBBBB";
const COLLECTION_PARAM = `flores-solares-${COLLECTION_ID}`;
const ARTWORK_PARAM = `estudio-en-rojo-${ARTWORK_ID}`;

/** The server's answer for a stored work. */
const stored = (overrides: Partial<Artwork> = {}): Artwork => ({
  id: ARTWORK_ID,
  userId: "owner-1",
  collectionId: COLLECTION_ID,
  title: "Estudio en rojo",
  artistName: "María López",
  status: "published",
  photos: [],
  documents: [],
  ...overrides,
});

/* eslint-disable @typescript-eslint/unbound-method */
const getArtwork = vi.mocked(artworkService.getArtwork);
const updateArtwork = vi.mocked(artworkService.updateArtwork);
/* eslint-enable @typescript-eslint/unbound-method */

const renderPage = () =>
  render(
    <MantineProvider>
      <ModalsProvider>
        <Notifications />
        <MemoryRouter
          initialEntries={[
            `/manage/collection/${COLLECTION_PARAM}/artwork/${ARTWORK_PARAM}`,
          ]}
        >
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

/** The PATCH body the page sent, once the save has landed. */
const sentPatch = async (): Promise<ArtworkUpdatePayload> => {
  await waitFor(() => expect(updateArtwork).toHaveBeenCalledTimes(1));
  const call = updateArtwork.mock.calls[0];
  expect(call[0]).toBe(COLLECTION_ID);
  expect(call[1]).toBe(ARTWORK_ID);
  return call[2];
};

beforeEach(() => {
  getArtwork.mockResolvedValue(stored());
  updateArtwork.mockResolvedValue(stored());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the Edit page — the status the owner chose", () => {
  it("shows the status the stored work arrived with", async () => {
    getArtwork.mockResolvedValue(stored({ status: "draft" }));
    renderPage();

    // By role and checked state, not by the word: "Draft" also appears in the
    // table's badge elsewhere, and on this page the claim is which option the
    // control has selected.
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Draft" })).toBeChecked(),
    );
    expect(screen.getByRole("radio", { name: "Published" })).not.toBeChecked();
  });

  it("sends a work the owner switches to draft as a draft", async () => {
    const user = userEvent.setup();
    renderPage();
    // The control is only meaningful once the load has filled it.
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Published" })).toBeChecked(),
    );

    await user.click(screen.getByRole("radio", { name: "Draft" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect((await sentPatch()).status).toBe("draft");
  });

  it("publishes a work the owner brings back from draft", async () => {
    // The other direction, because a PATCH that only ever sent "draft" would
    // satisfy the test above and strand every draft the owner re-publishes.
    getArtwork.mockResolvedValue(stored({ status: "draft" }));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Draft" })).toBeChecked(),
    );

    await user.click(screen.getByRole("radio", { name: "Published" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect((await sentPatch()).status).toBe("published");
  });
});
