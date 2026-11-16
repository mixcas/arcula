// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ManagePage from "@/components/manage/ManagePage";
import { catalogueService } from "@/services/catalogueService";
import {
  CATALOGUE_LIMITS,
  type Catalogue,
  type SessionUserRead,
} from "@arcula/shared";

/**
 * The dashboard's cap reflection: the "N of the cap" counter, the
 * New-catalogue button's link, and its disabled state at the cap.
 *
 * Enforcement is the API's (409 limit-reached — pinned by
 * `catalogues.api.test.ts`); these tests pin the reflection: the count
 * the UI shows, and that a capped button is a dead link, not a live one
 * that would land on a form the server refuses.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/catalogueService", () => ({
  catalogueService: { getUserCatalogues: vi.fn() },
}));

// The dashboard mounts the invitee's pending-offer list. Its own suite pins
// that card; here it only has to stay out of the catalogues assertions.
vi.mock("@/services/invitationService", () => ({
  invitationService: {
    getPendingInvitations: vi.fn(() => Promise.resolve([])),
    declinePendingInvitation: vi.fn(),
  },
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
const getUserCatalogues = vi.mocked(catalogueService.getUserCatalogues);
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

const catalogue: Catalogue = {
  id: "cccccccccccccccccccc",
  name: "Flores Solares",
  kind: "collection",
  userId: "u1",
  isPublic: true,
  role: "owner",
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 1, nanoseconds: 0 },
};

/** A catalogue somebody else owns and shared with this account. */
const sharedCatalogue: Catalogue = {
  id: "dddddddddddddddddddd",
  name: "Estudio Compartido",
  kind: "collection",
  userId: "u2",
  isPublic: false,
  role: "collaborator",
  ownerName: "Sofía Lara",
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 1, nanoseconds: 0 },
};

/** `count` distinct owned catalogues, so an at-cap case can fill the cap. */
const ownedCatalogues = (count: number): Catalogue[] =>
  Array.from({ length: count }, (_, i) => ({
    ...catalogue,
    id: `owned-${i}`,
    name: `Owned ${i}`,
  }));

/** The router's own location, so a navigation can be asserted. */
const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

const renderPage = (catalogues: Catalogue[]) => {
  getUserCatalogues.mockResolvedValue(catalogues);
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={["/manage"]}>
        <LocationProbe />
        <Routes>
          <Route path="/manage" element={<ManagePage />} />
          <Route path="/manage/catalogue/new" element={<div />} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
};

/**
 * The New-catalogue control, per its state: below the cap it is a link
 * (role link, it navigates), at the cap it is a disabled button (role
 * button — a disabled anchor cannot exist, so the control changes kind).
 */
const newCatalogueLink = () =>
  screen.getByRole("link", { name: /new catalogue/i });
const newCatalogueButton = () =>
  screen.getByRole("button", { name: /new catalogue/i });

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
      expect(screen.getByText(/0 of 10 catalogues/i)).toBeInTheDocument(),
    );
    const link = newCatalogueLink();
    expect(link).toHaveAttribute("href", "/manage/catalogue/new");

    const user = userEvent.setup();
    await user.click(link);
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/manage/catalogue/new",
      ),
    );
  });

  it("shows the cap at the cap, and the control is a disabled button that goes nowhere", async () => {
    renderPage(ownedCatalogues(CATALOGUE_LIMITS.free));

    await waitFor(() =>
      expect(screen.getByText(/10 of 10 catalogues/i)).toBeInTheDocument(),
    );
    // The failure this test exists for is a control that looks capped but
    // still navigates to a form the server would refuse: a disabled anchor
    // is not a thing, so the at-cap control must be a real button — and
    // clicking it must not move the location.
    const button = newCatalogueButton();
    expect(button).toBeDisabled();
    expect(
      screen.queryByRole("link", { name: /new catalogue/i }),
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
      expect(screen.getByText(/0 of 10 catalogues/i)).toBeInTheDocument(),
    );
    expect(newCatalogueLink()).toHaveAttribute("href", "/manage/catalogue/new");
  });

  it("counts owned catalogues only, so a shared row does not cap the account", async () => {
    // The failure this test exists for: a shared row counted as owned would
    // read "1 of 10" here, not "0 of 10".
    renderPage([sharedCatalogue]);

    await waitFor(() =>
      expect(screen.getByText(/0 of 10 catalogues/i)).toBeInTheDocument(),
    );
    expect(newCatalogueLink()).toHaveAttribute("href", "/manage/catalogue/new");
  });

  it("caps on the owned count even when shared rows are present", async () => {
    renderPage([...ownedCatalogues(CATALOGUE_LIMITS.free), sharedCatalogue]);

    await waitFor(() =>
      expect(screen.getByText(/10 of 10 catalogues/i)).toBeInTheDocument(),
    );
    expect(newCatalogueButton()).toBeDisabled();
  });
});

describe("a shared row on the dashboard", () => {
  it("names the role and the owner on the shared row, and the owner alone", async () => {
    renderPage([catalogue, sharedCatalogue]);

    await waitFor(() =>
      expect(screen.getByText("Estudio Compartido")).toBeInTheDocument(),
    );
    // Two rows, two roles: the shared one carries the collaborator badge and
    // the owner's display name, the owned one carries the owner badge and no
    // name — you are the owner of it. `getAllByText` counts the name so a
    // second `by …` line appearing anywhere is a failure, not a style.
    expect(screen.getByText("Collaborator")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getAllByText("by Sofía Lara")).toHaveLength(1);
  });
});
