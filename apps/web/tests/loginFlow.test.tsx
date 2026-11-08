// @vitest-environment jsdom
//
// The sign-in journey, once, end to end against the real stack.
//
// The bug this pins: `await login()` resolves when the POST /sign-in/email
// succeeds, but the client's session atom refetches only after its own signal
// fires a tick later. A page that navigates on the resolved promise lands on
// `/manage` while `currentUser` is still null, ProtectedRoute answers "no
// user", and the visitor is bounced back to an empty form — the first attempt
// flashes and fails, the second works because the atom caught up in between.
//
// So the assertion is the whole journey, not one page: submit once, then the
// dashboard must still be there after the bounce window. A form that merely
// unmounted would pass on the broken code, because the bounce remounts it with
// empty fields. Nothing is stubbed below the router — the auth client, the
// provider and the pages are the real ones, and the stack transport
// (tests/helpers/stackFetch.ts) carries them to the local API the way the Vite
// proxy does in the dev browser.
//
// The account is run-scoped: the test database persists across runs, and email
// is unique.
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { afterAll, describe, expect, it } from "vitest";

import App from "@/App";
import { authClient } from "@/auth/client";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no matchMedia. Answering `true` only for the empty query is what
// Chrome does, and it keeps Mantine's responsive props from collapsing.
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

const email = `login-${Math.random().toString(36).slice(2, 10)}@arcula.test`;
const password = "login-journey-pass-123";
// The session's `name`, which the manage navbar renders as the account.
const accountName = "Login Journey";

describe("signing in from /login", () => {
  afterAll(async () => {
    cleanup();
    await authClient.signOut();
  });

  it("reaches the dashboard on the first attempt and stays there", async () => {
    const signUp = await authClient.signUp.email({
      name: accountName,
      email,
      password,
    });
    expect(signUp.error).toBeNull();
    // Start anonymous, exactly as a visitor arriving at /login is.
    expect((await authClient.signOut()).error).toBeNull();

    const user = userEvent.setup();
    render(
      <MantineProvider>
        <MemoryRouter initialEntries={["/login"]}>
          <App />
        </MemoryRouter>
      </MantineProvider>,
    );

    await user.type(await screen.findByLabelText(/^Email/), email);
    await user.type(screen.getByLabelText(/^Password/), password);
    await user.click(screen.getByRole("button", { name: "Login" }));

    // The manage shell renders the signed-in account in its navbar — a widget
    // /login does not have — so its presence means the guard read a non-null
    // session and the dashboard, not the form, is on screen.
    const account = await screen.findByText(accountName, undefined, {
      timeout: 10000,
    });

    // The session atom's refetch and the redirect both land asynchronously;
    // wait past them and prove the guard did not send the visitor back. On the
    // broken code this is where the empty form returns.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(account).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Login" }),
    ).not.toBeInTheDocument();
  }, 30000);
});
