// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUserRead } from "@arcula/shared";

import ManageNavBar from "@/components/manage/layout/ManageNavBar";
import AccountMenu from "@/components/layout/AccountMenu";

/**
 * The header's account control, characterized at the seam both shells share:
 * the bar rendered under `MantineProvider` + `MemoryRouter` with the auth hook
 * stubbed, exactly as `managePage.test.tsx` and `invitationPage.test.tsx` do.
 *
 * This ticket changes no behaviour; these tests exist so the extraction into a
 * shared bar and a shared menu is a refactor a reviewer can trust. They pin
 * where the wordmark leads, which name the menu trigger announces, which items
 * the menu offers, and that the manage header does not offer a second way to
 * the page it is already on.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

const profile: SessionUserRead = {
  id: "u1",
  email: "owner@example.test",
  name: "Owner",
  image: null,
  emailVerified: false,
  firstName: "Sofía",
  lastName: "Lara",
  tier: "free",
  settings: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const renderInApp = (element: React.ReactElement) =>
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={["/manage"]}>{element}</MemoryRouter>
    </MantineProvider>,
  );

/** Opens the account menu the way a visitor does, and returns its trigger. */
const openAccountMenu = async (accessibleName: string) => {
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: accessibleName });
  await user.click(trigger);
  return trigger;
};

/**
 * The menu's items, read in one snapshot.
 *
 * Mantine portals the dropdown and its transition can hide it again between
 * separate lookups in jsdom, so every item is taken together — the same
 * precaution `cataloguePage.test.tsx` takes with its actions menu.
 */
const menuItems = async () => {
  const items = await screen.findAllByRole("menuitem");
  return {
    href: (name: string) =>
      items.find((item) => item.textContent === name)?.getAttribute("href"),
    has: (name: string) => items.some((item) => item.textContent === name),
  };
};

beforeEach(() => {
  authState.me = profile;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the manage header", () => {
  it("leads the wordmark to the dashboard, never to the public home", () => {
    renderInApp(<ManageNavBar />);

    expect(screen.getByRole("link", { name: "Arcula" })).toHaveAttribute(
      "href",
      "/manage",
    );
  });

  it("announces the full name on the menu trigger, profile name first", async () => {
    // The trigger collapses to a bare initial below `md`, so its accessible
    // name is the only place the account's name survives: the profile's
    // first + last name wins over the session's display name.
    renderInApp(<ManageNavBar />);

    expect(
      await openAccountMenu("Sofía Lara — account menu"),
    ).toBeInTheDocument();
  });

  it("falls back to the session display name while the profile has none", async () => {
    authState.me = null;
    renderInApp(<ManageNavBar />);

    expect(await openAccountMenu("Owner — account menu")).toBeInTheDocument();
  });

  it("offers Profile and Logout, and no Manage item on the page Manage leads to", async () => {
    renderInApp(<ManageNavBar />);
    await openAccountMenu("Sofía Lara — account menu");
    const menu = await menuItems();

    expect(menu.href("Profile")).toBe("/manage/profile");
    expect(menu.has("Logout")).toBe(true);
    // The wordmark already reaches the dashboard; an item to the current
    // page would be a dead control.
    expect(menu.has("Manage")).toBe(false);
  });
});

describe("the shared account menu", () => {
  it("adds Manage when asked, because a public header has no other route there", async () => {
    renderInApp(<AccountMenu withManage />);
    await openAccountMenu("Sofía Lara — account menu");
    const menu = await menuItems();

    expect(menu.href("Manage")).toBe("/manage");
  });
});
