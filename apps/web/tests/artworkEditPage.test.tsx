// @vitest-environment jsdom
import React from "react";
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
  artworkService: {
    getArtwork: vi.fn(),
    updateArtwork: vi.fn(),
    restoreArtwork: vi.fn(),
  },
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
const restoreArtwork = vi.mocked(artworkService.restoreArtwork);
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
  restoreArtwork.mockResolvedValue({ restored: true });
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

/**
 * A deleted work still loads (the API lets a member read and edit one), so the
 * page has to be the thing that says it is deleted. Save stays shut until a
 * restore succeeds, and the restore happens in place: the form is uncontrolled
 * and is never re-initialised, so what the user typed survives.
 */
describe("the Edit page — a deleted work", () => {
  const DELETED_AT = { seconds: 1_760_000_000, nanoseconds: 0 };

  /**
   * Scoped to the page's container: Mantine's notification store is
   * module-global and its portal lives outside the rendered container, so a
   * toast raised by an earlier test survives `cleanup` and would otherwise be
   * counted as an alert on this page.
   */
  const renderDeleted = () => {
    getArtwork.mockResolvedValue(stored({ deletedAt: DELETED_AT }));
    const page = within(renderPage().container);
    const saveButton = async () =>
      await page.findByRole("button", { name: "Save Changes" });
    return { page, saveButton };
  };

  it("explains the deletion and keeps Save shut", async () => {
    const { page, saveButton } = renderDeleted();

    expect(await saveButton()).toBeDisabled();
    // The banner is the page's only alert before a restore is attempted, and
    // the Restore it offers is the one recovery the page presents.
    expect(page.getByRole("alert")).toBeInTheDocument();
    expect(page.getByRole("button", { name: "Restore" })).toBeEnabled();
  });

  it("restores in place, leaving the typed title alone", async () => {
    const user = userEvent.setup();
    const { page, saveButton } = renderDeleted();

    const title = await page.findByLabelText(/^Title/);
    await user.clear(title);
    await user.type(title, "Unsaved new title");

    await user.click(page.getByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(page.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(await saveButton()).toBeEnabled();
    expect(restoreArtwork).toHaveBeenCalledTimes(1);
    expect(restoreArtwork).toHaveBeenCalledWith(COLLECTION_ID, ARTWORK_ID);
    // Re-read: a re-initialised form remounts the input, so the element found
    // before the click would keep its value even if the page discarded it.
    expect(await page.findByLabelText(/^Title/)).toHaveValue(
      "Unsaved new title",
    );
    // No navigation, no refetch, no auto-save.
    expect(getArtwork).toHaveBeenCalledTimes(1);
    expect(updateArtwork).not.toHaveBeenCalled();
  });

  it("stays deleted after a rejected restore and shows the failure", async () => {
    // The page logs the rejection; keep the run's output to what is under test.
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
    restoreArtwork.mockRejectedValue(new Error("network down"));
    const { page, saveButton } = renderDeleted();

    const title = await page.findByLabelText(/^Title/);
    await user.type(title, " (edited)");

    await user.click(page.getByRole("button", { name: "Restore" }));

    // The banner's alert plus the inline failure.
    await waitFor(() => expect(page.getAllByRole("alert")).toHaveLength(2));
    expect(await saveButton()).toBeDisabled();
    // The banner is still the same state, so the retry is simply clicking again.
    expect(page.getByRole("button", { name: "Restore" })).toBeEnabled();
    expect(page.getByLabelText(/^Title/)).toHaveValue(
      "Estudio en rojo (edited)",
    );
    expect(updateArtwork).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("cannot start a second restore while one is in flight", async () => {
    const user = userEvent.setup();
    let settle: (value: { restored: true }) => void = () => undefined;
    restoreArtwork.mockImplementation(
      () =>
        new Promise<{ restored: true }>((resolve) => {
          settle = resolve;
        }),
    );
    const { page } = renderDeleted();

    const restore = await page.findByRole("button", { name: "Restore" });
    await user.click(restore);
    await waitFor(() => expect(restore).toBeDisabled());
    await user.click(restore);
    expect(restoreArtwork).toHaveBeenCalledTimes(1);

    settle({ restored: true });
    await waitFor(() =>
      expect(page.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });
});
