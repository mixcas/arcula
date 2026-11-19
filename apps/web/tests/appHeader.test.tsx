// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUserRead } from "@arcula/shared";

import ManageNavBar from "@/components/manage/layout/ManageNavBar";
import PublicNavBar from "@/components/layout/PublicNavBar";
import AccountMenu from "@/components/layout/AccountMenu";
import type { ReturnState } from "@/utils/returnPath";

/**
 * The app's two headers, characterized at the seam both shells share: the bar
 * rendered under `MantineProvider` + `MemoryRouter` with the auth hook stubbed,
 * exactly as `managePage.test.tsx` and `invitationPage.test.tsx` do.
 *
 * The manage cases pin where the wordmark leads, which name the menu trigger
 * announces, which items the menu offers, and that the manage header does not
 * offer a second way to the page it is already on. The public cases pin the
 * same shape on the anonymous side of the app: the auth doors a signed-out
 * visitor gets, the account menu a signed-in one gets, the page the header
 * refuses to link to because the visitor is already there, and the one page
 * (an invitation) whose path the doors carry through authentication.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface Session {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
}

const signedIn: Session = {
  uid: "u1",
  email: "owner@example.test",
  emailVerified: false,
  displayName: "Owner",
};

const authState = vi.hoisted(() => ({
  me: null as SessionUserRead | null,
  currentUser: null as Session | null,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    currentUser: authState.currentUser,
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

/** The router's own location, path and return state, so a header link's
 *  carried state can be asserted without trusting the link's props — the
 *  same probe `invitationPage.test.tsx` reads after a click. */
const LocationProbe: React.FC = () => {
  const location = useLocation();
  const state = location.state as ReturnState | null | undefined;
  return (
    <div data-testid="location" data-from={state?.from?.pathname ?? ""}>
      {location.pathname}
    </div>
  );
};

const renderInApp = (element: React.ReactElement, path = "/manage") =>
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        {element}
      </MemoryRouter>
    </MantineProvider>,
  );

const location = () => screen.getByTestId("location");

const clickDoor = async (name: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("link", { name }));
};

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
  authState.currentUser = signedIn;
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

  it("offers Account and Log out, and no Manage item on the page Manage leads to", async () => {
    renderInApp(<ManageNavBar />);
    await openAccountMenu("Sofía Lara — account menu");
    const menu = await menuItems();

    expect(menu.href("Account")).toBe("/manage/profile");
    expect(menu.has("Log out")).toBe(true);
    // The wordmark already reaches the dashboard; an item to the current
    // page would be a dead control.
    expect(menu.has("Manage")).toBe(false);
  });
});

describe("the public header signed out", () => {
  it("leads the wordmark home and offers both auth doors", () => {
    authState.currentUser = null;
    renderInApp(<PublicNavBar />, "/");

    expect(screen.getByRole("link", { name: "Arcula" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/signup",
    );
    // No session, so no account control.
    expect(
      screen.queryByRole("button", { name: /account menu/ }),
    ).not.toBeInTheDocument();
  });
});

describe("the public header signed in", () => {
  it("shows the account menu with Manage, and no auth doors", async () => {
    renderInApp(<PublicNavBar />, "/");
    await openAccountMenu("Sofía Lara — account menu");
    const menu = await menuItems();

    expect(menu.href("Account")).toBe("/manage/profile");
    expect(menu.href("Manage")).toBe("/manage");
    expect(menu.has("Log out")).toBe(true);
    expect(
      screen.queryByRole("link", { name: "Log in" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Sign up" }),
    ).not.toBeInTheDocument();
  });
});

describe("the public header's auth doors", () => {
  beforeEach(() => {
    authState.currentUser = null;
  });

  it("omits Log in on the page it would lead to", () => {
    renderInApp(<PublicNavBar />, "/login");

    expect(
      screen.queryByRole("link", { name: "Log in" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/signup",
    );
  });

  it("omits Sign up on the page it would lead to", () => {
    renderInApp(<PublicNavBar />, "/signup");

    expect(
      screen.queryByRole("link", { name: "Sign up" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});

describe("the public header's auth doors and where authentication lands", () => {
  const INVITE_PATH = "/invite/tok-from-the-mail";

  beforeEach(() => {
    authState.currentUser = null;
  });

  it("carries the invitation back through Log in", async () => {
    renderInApp(<PublicNavBar />, INVITE_PATH);

    await clickDoor("Log in");

    await waitFor(() => expect(location().textContent).toBe("/login"));
    // A visitor who came for the invitation must not lose it by using the
    // header's door instead of the invitation card's own.
    expect(location()).toHaveAttribute("data-from", INVITE_PATH);
  });

  it("carries the invitation back through Sign up", async () => {
    renderInApp(<PublicNavBar />, INVITE_PATH);

    await clickDoor("Sign up");

    await waitFor(() => expect(location().textContent).toBe("/signup"));
    expect(location()).toHaveAttribute("data-from", INVITE_PATH);
  });

  it("carries no return path from an ordinary public page through Log in", async () => {
    renderInApp(<PublicNavBar />, "/");

    await clickDoor("Log in");

    // No state means the login page's own default, the dashboard — the
    // landing page's Login button has always landed there.
    await waitFor(() => expect(location().textContent).toBe("/login"));
    expect(location()).toHaveAttribute("data-from", "");
  });

  it("carries no return path from an ordinary public page through Sign up", async () => {
    renderInApp(<PublicNavBar />, "/");

    await clickDoor("Sign up");

    await waitFor(() => expect(location().textContent).toBe("/signup"));
    expect(location()).toHaveAttribute("data-from", "");
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
