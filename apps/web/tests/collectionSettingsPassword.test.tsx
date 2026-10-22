// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectionSlug, type Collection } from "@arcula/shared";

import CollectionSettingsPage from "@/components/manage/CollectionSettingsPage";
import { accessService } from "@/services/accessService";
import { collectionService } from "@/services/collectionService";

/**
 * The settings page's password wiring: the page actually asking the pure
 * decisions in `collectionPassword`. The decisions themselves are pinned by
 * `collectionPassword.test`; the behaviour only the page can get wrong is the
 * payload, so that is what this file asserts — a confirmation cannot leak
 * onto the wire, and an untouched Protected collection cannot send a password
 * key.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/collectionService", () => ({
  collectionService: {
    getCollection: vi.fn(),
    updateCollection: vi.fn(),
  },
}));

vi.mock("@/services/accessService", () => ({
  accessService: {
    getAccess: vi.fn(),
    removeCollaborator: vi.fn(),
    leaveCollection: vi.fn(),
    transferCollection: vi.fn(),
  },
}));

vi.mock("@/services/invitationService", () => ({
  invitationService: {
    createInvitation: vi.fn(),
    resendInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
  },
}));

// Mantine resolves the colour scheme and responsive props through
// `matchMedia`, which jsdom has no implementation of. Answering `true` only
// for the empty query is what Chrome does.
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

/* eslint-disable @typescript-eslint/unbound-method */
const getCollection = vi.mocked(collectionService.getCollection);
const updateCollection = vi.mocked(collectionService.updateCollection);
const getAccess = vi.mocked(accessService.getAccess);
/* eslint-enable @typescript-eslint/unbound-method */

const COLLECTION_ID = "cccccccccccccccccccc";

const collection = (overrides: Partial<Collection> = {}): Collection => ({
  id: COLLECTION_ID,
  name: "Flores Solares",
  userId: "u-owner",
  isPublic: true,
  role: "owner",
  isPasswordProtected: false,
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 1, nanoseconds: 0 },
  ...overrides,
});

const renderPage = (loaded: Collection) => {
  const param = collectionSlug(loaded.name, COLLECTION_ID);
  getCollection.mockResolvedValue(loaded);
  updateCollection.mockResolvedValue(loaded);
  getAccess.mockResolvedValue({
    role: "owner",
    owner: {
      userId: "u-owner",
      name: "Sofía Lara",
      email: "owner@example.test",
    },
    collaborators: [],
    invitations: [],
  });
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={[`/manage/collection/${param}/settings`]}>
        <Routes>
          <Route
            path="/manage/collection/:collectionId/settings"
            element={<CollectionSettingsPage />}
          />
          <Route
            path="/manage/collection/:collectionId"
            element={<div>manage</div>}
          />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
};

const save = async () => {
  await userEvent.click(
    await screen.findByRole("button", { name: /save settings/i }),
  );
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the settings page's password control", () => {
  it("sends the password without the confirmation", async () => {
    renderPage(collection());

    await userEvent.type(
      await screen.findByLabelText("Password"),
      "long-enough",
    );
    await userEvent.type(
      screen.getByLabelText("Confirm password"),
      "long-enough",
    );
    await save();

    await waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(1));
    const payload = updateCollection.mock.calls[0][1];
    expect(payload.password).toBe("long-enough");
    expect(payload).not.toHaveProperty("confirm");
  });

  it("sends no password key when a Protected collection is untouched", async () => {
    renderPage(collection({ isPasswordProtected: true }));

    await screen.findByLabelText(/collection name/i);
    await save();

    await waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(1));
    const payload = updateCollection.mock.calls[0][1];
    expect(payload).not.toHaveProperty("password");
    expect(payload).not.toHaveProperty("confirm");
  });

  it("blocks a mismatched confirmation before any request", async () => {
    renderPage(collection());

    await userEvent.type(
      await screen.findByLabelText("Password"),
      "long-enough",
    );
    await userEvent.type(
      screen.getByLabelText("Confirm password"),
      "different-password",
    );
    await save();

    expect(updateCollection).not.toHaveBeenCalled();
  });

  it("sends a null password after Remove", async () => {
    renderPage(collection({ isPasswordProtected: true }));

    await userEvent.click(
      await screen.findByRole("button", { name: /remove password/i }),
    );
    await save();

    await waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(1));
    expect(updateCollection.mock.calls[0][1].password).toBeNull();
  });
});
