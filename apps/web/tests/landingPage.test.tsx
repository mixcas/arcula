// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";

/**
 * The landing page at the route seam: the app rendered at `/` with the real
 * router, provider and page, and only the session answered.
 *
 * The one behaviour worth pinning is where the page's primary actions lead,
 * because they are its conversion path and they change with the session. The
 * page has two conversion doors — the hero's and the closing action's — and a
 * presence check cannot tell a broken door from a working one, since either
 * alone would satisfy it. So each session state counts its doors exactly: two
 * `/signup` links and no `/manage` for a visitor, two `/manage` links and no
 * `/signup` for an account holder. Links are found by `href`, never by their
 * visible text: the copy is free to change, the destination is not. Layout,
 * colour and the copy itself are a reviewer's job — jsdom cannot see them.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface SessionUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

const session = vi.hoisted(() => ({
  data: null as { user: SessionUser } | null,
}));

vi.mock("@/auth/client", () => ({
  authClient: {
    // AuthProvider gates its children on the session; each test answers it.
    useSession: () => ({ data: session.data, isPending: false }),
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
    signOut: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

// The signed-in provider reads /me on mount. Nothing here is about the
// profile, so it answers with an absent row rather than reaching the stack.
vi.mock("@/services/meService", () => ({
  meService: { getMe: vi.fn(() => Promise.resolve(null)) },
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

const renderLanding = () =>
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    </MantineProvider>,
  );

/** The page's own links: the header's doors sit outside the main landmark. */
const mainLinks = (href: string) =>
  Array.from(screen.getByRole("main").querySelectorAll("a")).filter(
    (link) => link.getAttribute("href") === href,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  session.data = null;
});

describe("the landing page's primary action", () => {
  it("offers a signed-out visitor the way to create a catalogue at both doors", () => {
    renderLanding();

    expect(mainLinks("/signup")).toHaveLength(2);
    expect(mainLinks("/manage")).toHaveLength(0);
  });

  it("sends a signed-in account holder to their catalogues, not to sign-up", () => {
    session.data = {
      user: {
        id: "u1",
        email: "owner@example.test",
        emailVerified: false,
        name: "Owner",
      },
    };
    renderLanding();

    expect(mainLinks("/manage")).toHaveLength(2);
    expect(mainLinks("/signup")).toHaveLength(0);
  });
});
