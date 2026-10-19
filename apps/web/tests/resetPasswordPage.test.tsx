// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ResetPasswordPage from "@/components/auth/ResetPasswordPage";
import { authClient } from "@/auth/client";
import { resetPasswordSchema } from "@/schemas/user";

/**
 * The reset form the mail's token link lands on. The token is
 * the seam: it comes from the URL, the page carries it in the request, and
 * a dead link is the server's 400 — asserted here, pinned API-side by
 * `email.api.test.ts`'s live reset flow.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/auth/client", () => ({
  authClient: {
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

const resetPassword = vi.mocked(authClient.resetPassword);

const TOKEN = "tok-123";

const renderPage = () =>
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={[`/reset-password/${TOKEN}`]}>
        <Routes>
          <Route
            path="/reset-password/:token"
            element={<ResetPasswordPage />}
          />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );

beforeEach(() => {
  resetPassword.mockResolvedValue({ data: { status: true } });
});

afterEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  cleanup();
  vi.clearAllMocks();
});

describe("the reset-password page", () => {
  it("resets with the token from the URL and hands off to sign-in", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^New password/), "sunlight-123");
    await user.type(
      screen.getByLabelText(/^Confirm new password/),
      "sunlight-123",
    );
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith({
        newPassword: "sunlight-123",
        token: TOKEN,
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/password updated/i)).toBeInTheDocument(),
    );
    // The sign-in hand-off is a real link, and the form is gone.
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.queryByLabelText(/^New password/)).not.toBeInTheDocument();
  });

  it("a mismatched confirmation blocks the call and names the mismatch", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^New password/), "sunlight-123");
    await user.type(
      screen.getByLabelText(/^Confirm new password/),
      "other-1234",
    );
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(
      await screen.findByText(/passwords do not match/i),
    ).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("reports a dead link with the server's own invalid-token case", async () => {
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
    renderPage();

    await user.type(screen.getByLabelText(/^New password/), "sunlight-123");
    await user.type(
      screen.getByLabelText(/^Confirm new password/),
      "sunlight-123",
    );
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() =>
      expect(
        screen.getByText(/this reset link is invalid or has expired/i),
      ).toBeInTheDocument(),
    );
  });
});

describe("the reset-password schema (tier 1)", () => {
  it("rejects a short password and a mismatch, and accepts a matched pair", () => {
    expect(
      resetPasswordSchema.safeParse({
        newPassword: "short",
        confirmPassword: "short",
      }).success,
    ).toBe(false);

    expect(
      resetPasswordSchema.safeParse({
        newPassword: "sunlight-123",
        confirmPassword: "different-1",
      }).success,
    ).toBe(false);

    expect(
      resetPasswordSchema.safeParse({
        newPassword: "sunlight-123",
        confirmPassword: "sunlight-123",
      }).success,
    ).toBe(true);
  });
});
