// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProfilePage from "@/components/manage/ProfilePage";
import { authClient } from "@/auth/client";
import { meService } from "@/services/meService";
import { changePasswordSchema, profileNameSchema } from "@/schemas/user";
import type { SessionUserRead } from "@arcula/shared";

/**
 * The profile page (Phase 5): which keys the name save sends (absent-leave
 * is the PATCH contract, so only changed, non-blank halves ride the wire),
 * and the change-password outcome mapping.
 *
 * Stubs sit at the two seams the page has: `meService` (the /api/v1/me
 * pair — pinned API-side by `me.api.test.ts`) and the auth client's native
 * change-password (pinned API-side by `auth.api.test.ts`).
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/meService", () => ({
  meService: {
    getMe: vi.fn(),
    updateProfile: vi.fn(),
  },
}));

vi.mock("@/auth/client", () => ({
  authClient: {
    changePassword: vi.fn(),
  },
}));

/** The page reads `me` through the hook, not through the provider. */
const meOf: SessionUserRead = {
  id: "u1",
  email: "owner@example.test",
  name: "Sofía Lara",
  image: null,
  emailVerified: false,
  firstName: "Sofía",
  lastName: "Lara",
  tier: "free",
  settings: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const authState = vi.hoisted(() => ({ me: null as SessionUserRead | null }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    currentUser: {
      uid: "u1",
      email: "owner@example.test",
      emailVerified: false,
      displayName: "Sofía Lara",
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
const updateProfile = vi.mocked(meService.updateProfile);
/* eslint-enable @typescript-eslint/unbound-method */
const changePassword = vi.mocked(authClient.changePassword);

/** The server's answer for a saved profile: the row with the new names. */
const savedMe = (
  overrides: Partial<SessionUserRead> = {},
): SessionUserRead => ({
  ...meOf,
  ...overrides,
});

const renderPage = () =>
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={["/manage/profile"]}>
        <ProfilePage />
      </MemoryRouter>
    </MantineProvider>,
  );

beforeEach(() => {
  authState.me = meOf;
  updateProfile.mockResolvedValue(savedMe());
  changePassword.mockResolvedValue({ data: { user: { id: "u1" } } });
});

afterEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  cleanup();
  vi.clearAllMocks();
});

describe("the profile page — the name save", () => {
  it("sends only the changed, non-blank key, and reports the save", async () => {
    authState.me = meOf;
    const user = userEvent.setup();
    renderPage();

    await user.clear(screen.getByLabelText(/^Last name/));
    await user.type(screen.getByLabelText(/^Last name/), "Solar");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith({ lastName: "Solar" }),
    );
    await waitFor(() =>
      expect(screen.getByText(/profile updated/i)).toBeInTheDocument(),
    );
    // First name was unchanged, so it must not ride the wire at all:
    // absent keys are "leave alone", and rewriting it would be a no-op write.
    const [payload] = updateProfile.mock.calls[0];
    expect("firstName" in payload).toBe(false);
  });

  it("empties nothing and writes nothing when a field is cleared to blank", async () => {
    const user = userEvent.setup();
    renderPage();

    // First name loaded as "Sofía"; a blank is not a value the PATCH can
    // write, so clearing it must produce no request and no alert.
    await user.clear(screen.getByLabelText(/^First name/));
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(updateProfile).not.toHaveBeenCalled();
    expect(screen.queryByText(/profile updated/i)).not.toBeInTheDocument();
  });

  it("sends no request at all when nothing changed", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(updateProfile).not.toHaveBeenCalled();
  });
});

describe("the profile page — the password change", () => {
  it("changes the password and clears the fields", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^Current password/), "current-123");
    await user.type(screen.getByLabelText(/^New password/), "sunlight-123");
    await user.type(
      screen.getByLabelText(/^Confirm new password/),
      "sunlight-123",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: "current-123",
        newPassword: "sunlight-123",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/password changed/i)).toBeInTheDocument(),
    );
    // The credentials do not survive the change in the inputs.
    expect(screen.getByLabelText(/^New password/)).toHaveValue("");
    expect(screen.getByLabelText(/^Confirm new password/)).toHaveValue("");
  });

  it("maps a wrong current password to its own line", async () => {
    changePassword.mockResolvedValue({
      data: null,
      error: {
        message: "Invalid password",
        code: "INVALID_PASSWORD",
        status: 400,
        statusText: "Bad Request",
      },
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(
      screen.getByLabelText(/^Current password/),
      "not-the-password",
    );
    await user.type(screen.getByLabelText(/^New password/), "sunlight-123");
    await user.type(
      screen.getByLabelText(/^Confirm new password/),
      "sunlight-123",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() =>
      expect(
        screen.getByText(/current password is incorrect/i),
      ).toBeInTheDocument(),
    );
  });

  it("a mismatched confirmation blocks the call and names the mismatch", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^Current password/), "current-123");
    await user.type(screen.getByLabelText(/^New password/), "sunlight-123");
    await user.type(
      screen.getByLabelText(/^Confirm new password/),
      "different-123",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(
      await screen.findByText(/passwords do not match/i),
    ).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });
});

describe("the profile form schemas (tier 1)", () => {
  it("the name schema allows a blank half but not an over-long one", () => {
    expect(
      profileNameSchema.safeParse({ firstName: "", lastName: "" }).success,
    ).toBe(true);
    expect(
      profileNameSchema.safeParse({
        firstName: "a".repeat(201),
        lastName: "",
      }).success,
    ).toBe(false);
  });

  it("the change-password schema rejects a short new password and a mismatch", () => {
    const values = {
      currentPassword: "current-123",
      newPassword: "short",
      confirmPassword: "short",
    };
    expect(changePasswordSchema.safeParse(values).success).toBe(false);

    expect(
      changePasswordSchema.safeParse({
        ...values,
        newPassword: "sunlight-123",
        confirmPassword: "sunlight-123",
      }).success,
    ).toBe(true);
  });
});
