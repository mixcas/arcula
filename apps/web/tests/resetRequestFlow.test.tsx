// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { authClient } from "@/auth/client";

/**
 * The reset request and the reset form as a journey between routes, not as
 * one page's mode.
 *
 * The seam is the route table: this renders the real application component at
 * a real entry URL, with only the auth client mocked, so a link pointed at the
 * wrong page or a route that went missing fails here. Everything between the
 * URL and the network — the router, the auth provider, the pages — is real.
 *
 * Pinned API-side by `email.api.test.ts`'s live reset flow, where the mailed
 * token actually resets a password.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/auth/client", () => ({
  authClient: {
    // AuthProvider gates its children on the session; signed out is the state
    // every route here starts in.
    useSession: () => ({ data: null, isPending: false }),
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
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

const requestPasswordReset = vi.mocked(authClient.requestPasswordReset);
const resetPassword = vi.mocked(authClient.resetPassword);

const renderApp = (entry: string | { pathname: string; state?: unknown }) =>
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={[entry]}>
        <App />
      </MemoryRouter>
    </MantineProvider>,
  );

beforeEach(() => {
  requestPasswordReset.mockResolvedValue({ data: { status: true } });
  resetPassword.mockResolvedValue({ data: { status: true } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the reset request and reset form as routes", () => {
  it("carries the typed address from sign-in to the request screen, then answers without confirming", async () => {
    const user = userEvent.setup();
    renderApp("/login");

    await user.type(screen.getByLabelText(/^Email/), "lapsed@example.test");
    const door = screen.getByRole("link", {
      name: /forgot your password/i,
    });
    // The address rides router state, never the URL: nothing about the typed
    // address is user-addressable or needs sanitising.
    expect(door).toHaveAttribute("href", "/reset-password");
    await user.click(door);

    // The request screen, with the address the sign-in form was holding.
    expect(
      await screen.findByRole("heading", { name: "Reset your password" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/)).toHaveValue("lapsed@example.test");

    await user.click(screen.getByRole("button", { name: "Send reset email" }));

    await waitFor(() =>
      expect(requestPasswordReset).toHaveBeenCalledWith({
        email: "lapsed@example.test",
      }),
    );
    // The sentence is the same whether or not the account exists: the endpoint
    // is enumeration-safe, and the page repeats that discipline.
    expect(
      await screen.findByText(/if an account exists for that address/i),
    ).toBeInTheDocument();
    // The form is spent; only the way back to sign-in is left.
    expect(
      screen.queryByRole("button", { name: "Send reset email" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to sign in" }),
    ).toHaveAttribute("href", "/login");
  });

  it("stands alone when opened cold, with an empty address", async () => {
    const user = userEvent.setup();
    // No state a writer produced — a bookmark, or a link from elsewhere.
    renderApp({ pathname: "/reset-password", state: { email: 42 } });

    expect(
      screen.getByRole("heading", { name: "Reset your password" }),
    ).toBeInTheDocument();
    const email = screen.getByLabelText(/^Email/);
    expect(email).toHaveValue("");

    await user.type(email, "bookmark@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset email" }));

    await waitFor(() =>
      expect(requestPasswordReset).toHaveBeenCalledWith({
        email: "bookmark@example.test",
      }),
    );
  });

  it("leaves sign-up without a reset door and points back to sign-in", () => {
    renderApp("/signup");

    expect(
      screen.queryByRole("link", { name: /forgot your password/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /forgot your password/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Login" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("turns the reset form's expired-link message into a way back to the request screen", async () => {
    resetPassword.mockResolvedValue({
      data: null,
      error: {
        message: "Invalid token",
        code: "INVALID_TOKEN",
        status: 400,
        statusText: "Bad Request",
      },
    });
    const user = userEvent.setup();
    renderApp("/reset-password/tok-from-an-old-mail");

    await user.type(screen.getByLabelText(/^New password/), "sunlight-123");
    await user.type(
      screen.getByLabelText(/^Confirm new password/),
      "sunlight-123",
    );
    await user.click(screen.getByRole("button", { name: "Update password" }));

    const recovery = await screen.findByRole("link", {
      name: "Request a new one",
    });
    expect(recovery).toHaveAttribute("href", "/reset-password");

    // It is the request screen it lands on, not a page that merely mentions it.
    await user.click(recovery);
    expect(
      await screen.findByRole("heading", { name: "Reset your password" }),
    ).toBeInTheDocument();
  });
});
