// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ManagePage from "@/components/manage/ManagePage";
import { collectionService } from "@/services/collectionService";
import type { Collection, SessionUserRead } from "@arcula/shared";

/**
 * The dashboard's cap reflection (Phase 5): the "N of 1" counter, the
 * New-collection button's link, and its disabled state at the cap.
 *
 * Enforcement is the API's (409 limit-reached — pinned by
 * `collections.api.test.ts`); these tests pin the reflection: the count
 * the UI shows, and that a capped button is a dead link, not a live one
 * that would land on a form the server refuses.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/collectionService", () => ({
  collectionService: { getUserCollections: vi.fn() },
}));

const authState = vi.hoisted(() => ({
  me: null as SessionUserRead | null,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    currentUser: {
      uid: "u1",
      email: "owner@example.test",
      emailVerified: false,
      displayName: "Owner",
    },
    me: authState.me,
    login: vi.fn(),
    logout: vi.fn(),
  }),
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
const getUserCollections = vi.mocked(collectionService.getUserCollections);
/* eslint-enable @typescript-eslint/unbound-method */

const freeMe: SessionUserRead = {
  id: "u1",
  email: "owner@example.test",
  name: "Owner",
  image: null,
  emailVerified: false,
  firstName: "Owner",
  lastName: null,
  tier: "free",
  settings: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const collection: Collection = {
  id: "cccccccccccccccccccc",
  name: "Flores Solares",
  userId: "u1",
  isPublic: true,
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 1, nanoseconds: 0 },
};

/** The router's own location, so a navigation can be asserted. */
const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

const renderPage = (collections: Collection[]) => {
  getUserCollections.mockResolvedValue(collections);
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={["/manage"]}>
        <LocationProbe />
        <Routes>
          <Route path="/manage" element={<ManagePage />} />
          <Route path="/manage/collection/new" element={<div />} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
};

/**
 * The New-collection control, per its state: below the cap it is a link
 * (role link, it navigates), at the cap it is a disabled button (role
 * button — a disabled anchor cannot exist, so the control changes kind).
 */
const newCollectionLink = () =>
  screen.getByRole("link", { name: /new collection/i });
const newCollectionButton = () =>
  screen.getByRole("button", { name: /new collection/i });

beforeEach(() => {
  authState.me = freeMe;
});

afterEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  cleanup();
  vi.clearAllMocks();
});

describe("the dashboard's cap reflection", () => {
  it("offers the link below the cap, with the counter", async () => {
    renderPage([]);

    await waitFor(() =>
      expect(screen.getByText(/0 of 1 collection/i)).toBeInTheDocument(),
    );
    const link = newCollectionLink();
    expect(link).toHaveAttribute("href", "/manage/collection/new");

    const user = userEvent.setup();
    await user.click(link);
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/manage/collection/new",
      ),
    );
  });

  it("shows 1 of 1 at the cap, and the control is a disabled button that goes nowhere", async () => {
    renderPage([collection]);

    await waitFor(() =>
      expect(screen.getByText(/1 of 1 collection/i)).toBeInTheDocument(),
    );
    // The failure this test exists for is a control that looks capped but
    // still navigates to a form the server would refuse: a disabled anchor
    // is not a thing, so the at-cap control must be a real button — and
    // clicking it must not move the location.
    const button = newCollectionButton();
    expect(button).toBeDisabled();
    expect(
      screen.queryByRole("link", { name: /new collection/i }),
    ).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(button);
    expect(screen.getByTestId("location").textContent).toBe("/manage");
  });

  it("falls back to the free cap when the profile read has not landed", async () => {
    // The provider degrades a missing /me to null; the dashboard must fall
    // to the free limit — the same fallback the API's create check makes —
    // not to a blank counter or an always-open button.
    authState.me = null;
    renderPage([]);

    await waitFor(() =>
      expect(screen.getByText(/0 of 1 collection/i)).toBeInTheDocument(),
    );
    expect(newCollectionLink()).toHaveAttribute(
      "href",
      "/manage/collection/new",
    );
  });
});
