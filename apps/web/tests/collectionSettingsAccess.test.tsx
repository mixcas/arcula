// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectionSlug, type Collection } from "@arcula/shared";

import CollectionSettingsPage from "@/components/manage/CollectionSettingsPage";
import { accessService } from "@/services/accessService";
import { collectionService } from "@/services/collectionService";

/**
 * The settings page's half of the access card: the card is mounted with the
 * bare collection id (the route carries "{slug}-{id}"), and a collaborator
 * keeps the settings form. The card's own views are pinned by
 * `accessCard.test`; this is the wiring between the page and that component.
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
// for the empty query is what Chrome does, and it keeps responsive props
// from collapsing.
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
const getAccess = vi.mocked(accessService.getAccess);
/* eslint-enable @typescript-eslint/unbound-method */

const COLLECTION_ID = "cccccccccccccccccccc";

const collection: Collection = {
  id: COLLECTION_ID,
  name: "Flores Solares",
  userId: "u-owner",
  isPublic: false,
  role: "collaborator",
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 1, nanoseconds: 0 },
};

const renderPage = () => {
  const param = collectionSlug(collection.name, COLLECTION_ID);
  getCollection.mockResolvedValue(collection);
  getAccess.mockResolvedValue({
    role: "collaborator",
    owner: {
      userId: "u-owner",
      name: "Sofía Lara",
      email: "owner@example.test",
    },
    collaborators: [
      {
        userId: "u-mate",
        name: "Mateo Ruiz",
        email: "mate@example.test",
      },
    ],
  });
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={[`/manage/collection/${param}/settings`]}>
        <Routes>
          <Route
            path="/manage/collection/:collectionId/settings"
            element={<CollectionSettingsPage />}
          />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the settings page's access card", () => {
  it("mounts the card with the parsed id and keeps the settings form for a collaborator", async () => {
    renderPage();

    // The route carries the slug; the access read needs the id alone.
    await waitFor(() => expect(getAccess).toHaveBeenCalledWith(COLLECTION_ID));
    expect(await screen.findByTestId("access-card")).toBeInTheDocument();

    // A collaborator changes every setting, so the form stays theirs.
    expect(screen.getByLabelText(/collection name/i)).toBeInTheDocument();

    // …and the card renders their view: leave, never remove.
    expect(
      await screen.findByRole("button", { name: /leave collection/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();
  });
});
