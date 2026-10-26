// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SignUpPage from "@/components/auth/SignUpPage";
import { authClient } from "@/auth/client";
import {
  EMPTY_SIGN_UP_FORM,
  signUpSchema,
  toSignUpPayload,
} from "@/schemas/user";

/**
 * The sign-up page: what it sends and where each outcome lands.
 *
 * The seam is the auth client itself: everything past `authClient` is
 * Better Auth's native endpoint, pinned on the API side
 * (`me.api.test.ts` writes the same sign-up and reads the row back).
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/auth/client", () => ({
  authClient: {
    signUp: { email: vi.fn() },
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

const signUpEmail = vi.mocked(authClient.signUp.email);

/** The router's own location, so a navigation can be asserted. */
const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

const renderPage = (from?: string) =>
  render(
    <MantineProvider>
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/signup",
            state: from ? { from: { pathname: from } } : null,
          },
        ]}
      >
        {/* Outside the routes, so it reports wherever the page lands. */}
        <LocationProbe />
        <Routes>
          <Route path="/signup" element={<SignUpPage />} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );

/** Fills the sign-up form and submits it. */
const submitSignUp = async (
  user: ReturnType<typeof userEvent.setup>,
  values: {
    firstName?: string;
    lastName?: string;
    email?: string;
    password?: string;
    confirmation?: string;
  } = {},
) => {
  const password = values.password ?? "sunlight-123";
  await user.type(
    screen.getByLabelText(/^First name/),
    values.firstName ?? "Sofía",
  );
  await user.type(
    screen.getByLabelText(/^Last name/),
    values.lastName ?? "Lara",
  );
  await user.type(
    screen.getByLabelText(/^Email/),
    values.email ?? "new@example.test",
  );
  await user.type(screen.getByLabelText(/^Password/), password);
  await user.type(
    screen.getByLabelText(/^Confirm password/),
    values.confirmation ?? password,
  );
  await user.click(screen.getByRole("button", { name: "Sign up" }));
};

beforeEach(() => {
  // The happy answers; individual tests override.
  signUpEmail.mockResolvedValue({
    data: { token: "session-token", user: { id: "u1" } },
  });
});

afterEach(() => {
  // The catch logs the failure it is about to report, which is right in
  // production and noise here; these tests are about where the page goes.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  cleanup();
  vi.clearAllMocks();
});

describe("the sign-up schema and payload (tier 1)", () => {
  it("rejects a blank first name, a short password, and a malformed email", () => {
    const blankName = signUpSchema.safeParse({
      ...EMPTY_SIGN_UP_FORM,
      email: "a@b.co",
      password: "sunlight-123",
      firstName: "   ",
    });
    expect(blankName.success).toBe(false);

    const shortPassword = signUpSchema.safeParse({
      ...EMPTY_SIGN_UP_FORM,
      email: "a@b.co",
      password: "short",
      firstName: "Sofía",
    });
    expect(shortPassword.success).toBe(false);

    const badEmail = signUpSchema.safeParse({
      ...EMPTY_SIGN_UP_FORM,
      email: "not-an-email",
      password: "sunlight-123",
      firstName: "Sofía",
    });
    expect(badEmail.success).toBe(false);
  });

  it("rejects a mismatched pair on the confirmation field and accepts a matching one", () => {
    const values = {
      ...EMPTY_SIGN_UP_FORM,
      email: "a@b.co",
      password: "sunlight-123",
      firstName: "Sofía",
    };

    const mismatch = signUpSchema.safeParse({
      ...values,
      confirmPassword: "sunlight-124",
    });
    expect(mismatch.success).toBe(false);
    if (!mismatch.success) {
      expect(mismatch.error.issues).toContainEqual(
        expect.objectContaining({
          message: "Passwords do not match",
          path: ["confirmPassword"],
        }),
      );
    }

    expect(
      signUpSchema.safeParse({
        ...values,
        confirmPassword: "sunlight-123",
      }).success,
    ).toBe(true);
  });

  it("derives the core name from the trimmed halves, dropping a blank last name", () => {
    const both = toSignUpPayload({
      email: "a@b.co",
      password: "sunlight-123",
      confirmPassword: "sunlight-123",
      firstName: "  Sofía  ",
      lastName: "  Lara ",
    });
    expect(both.name).toBe("Sofía Lara");
    expect(both.firstName).toBe("Sofía");
    expect(both.lastName).toBe("Lara");
    // The confirmation is form state alone: the payload the auth client
    // receives must not gain a field its endpoint does not own.
    expect(Object.keys(both)).not.toContain("confirmPassword");

    const firstOnly = toSignUpPayload({
      email: "a@b.co",
      password: "sunlight-123",
      confirmPassword: "sunlight-123",
      firstName: "Sofía",
      lastName: "   ",
    });
    expect(firstOnly.name).toBe("Sofía");
    expect(firstOnly.lastName).toBe("");
  });
});

describe("the sign-up page", () => {
  it("signs up with the derived name and the custom fields, and lands on the dashboard", async () => {
    const user = userEvent.setup();
    renderPage();
    await submitSignUp(user);

    await waitFor(() =>
      expect(signUpEmail).toHaveBeenCalledWith({
        name: "Sofía Lara",
        email: "new@example.test",
        password: "sunlight-123",
        firstName: "Sofía",
        lastName: "Lara",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/manage"),
    );
  });

  it("blocks sign-up when the passwords differ and names the box to fix", async () => {
    const user = userEvent.setup();
    renderPage();
    await submitSignUp(user, {
      password: "sunlight-123",
      confirmation: "sunlight-124",
    });

    await waitFor(() =>
      expect(screen.getByText("Passwords do not match")).toBeInTheDocument(),
    );
    expect(signUpEmail).not.toHaveBeenCalled();
    expect(screen.getByTestId("location").textContent).toBe("/signup");
  });

  it("asks the browser for a new password in both boxes", () => {
    renderPage();
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByLabelText(/^Confirm password/)).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  it("returns to the invite path it came from instead of the dashboard", async () => {
    // The invite page is the one arrival that must survive sign-up: the
    // token lives in that path, and landing on /manage loses it for good.
    const user = userEvent.setup();
    renderPage("/invite/tok-from-the-mail");
    await submitSignUp(user);

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/invite/tok-from-the-mail",
      ),
    );
  });

  it("stays on the page with the specific message when the email is taken", async () => {
    signUpEmail.mockResolvedValue({
      data: null,
      error: {
        message: "User already exists, use another email",
        code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
        status: 422,
        statusText: "Unprocessable Entity",
      },
    });
    const user = userEvent.setup();
    renderPage();
    await submitSignUp(user);

    await waitFor(() =>
      expect(
        screen.getByText(/an account with that email already exists/i),
      ).toBeInTheDocument(),
    );
    // The form is still there: nothing was written, so nothing changes.
    expect(screen.getByTestId("location").textContent).toBe("/signup");
    expect(screen.getByLabelText(/^First name/)).toBeInTheDocument();
  });

  it("keeps a server failure generic — no status line in the alert", async () => {
    signUpEmail.mockResolvedValue({
      data: null,
      error: {
        message: "boom",
        code: "INTERNAL_SERVER_ERROR",
        status: 500,
        statusText: "Internal Server Error",
      },
    });
    const user = userEvent.setup();
    renderPage();
    await submitSignUp(user);

    await waitFor(() =>
      expect(
        screen.getByText(/sign up failed\. please try again/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("location").textContent).toBe("/signup");
  });
});
