// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectionSlug,
  type Collection,
  type InvitationPreview,
} from "@arcula/shared";

import InvitationPage from "@/components/invitation/InvitationPage";
import { authClient } from "@/auth/client";
import { ApiRequestError } from "@/services/api";
import { invitationService } from "@/services/invitationService";

/**
 * The invite page's four audiences: a visitor, the invited account, another
 * account, and a dead link — plus the transport's second chance at the
 * mismatched state (the server refusing an acceptance the page thought was
 * allowed).
 *
 * The seams are the invitation service and the auth hooks the page reads,
 * stubbed; the wire contract behind them is pinned by
 * `invitationService.test.ts`, and the routes by the API's invitation suite.
 * The page's own decisions — which controls exist, and where a click goes —
 * are what these tests keep true.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const authState = vi.hoisted(() => ({
  currentUser: null as null | {
    uid: string;
    email: string | null;
    emailVerified: boolean;
    displayName: string | null;
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    currentUser: authState.currentUser,
    me: null,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/services/invitationService", () => ({
  invitationService: {
    getInvitation: vi.fn(),
    acceptInvitation: vi.fn(),
    declineInvitation: vi.fn(),
  },
}));

vi.mock("@/auth/client", () => ({
  authClient: { signOut: vi.fn() },
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
const getInvitation = vi.mocked(invitationService.getInvitation);
const acceptInvitation = vi.mocked(invitationService.acceptInvitation);
const declineInvitation = vi.mocked(invitationService.declineInvitation);
const signOut = vi.mocked(authClient.signOut);
/* eslint-enable @typescript-eslint/unbound-method */

const TOKEN = "tok-from-the-mail";
const INVITE_PATH = `/invite/${TOKEN}`;

const preview: InvitationPreview = {
  collection: { id: "cccccccccccccccccccc", name: "Flores Solares" },
  inviter: { name: "Sofía Lara" },
  email: "invited@example.test",
  expiresAt: { seconds: 1790000000, nanoseconds: 0 },
};

const collection: Collection = {
  id: preview.collection.id,
  name: preview.collection.name,
  userId: "u-owner",
  isPublic: false,
  createdAt: { seconds: 1, nanoseconds: 0 },
  updatedAt: { seconds: 1, nanoseconds: 0 },
};

const declinedRow = {
  id: "iiiiiiiiiiiiiiiiiiii",
  collectionId: preview.collection.id,
  email: preview.email,
  invitedByUserId: "u-owner",
  status: "declined" as const,
  createdAt: { seconds: 1, nanoseconds: 0 },
  expiresAt: preview.expiresAt,
  resolvedAt: { seconds: 2, nanoseconds: 0 },
};

const signedInAs = (email: string | null) => {
  authState.currentUser = {
    uid: "u-viewer",
    email,
    emailVerified: false,
    displayName: "Viewer",
  };
};

/** The router's own location, path and return state, so navigation can be
 *  asserted without trusting a component's copy of either. */
const LocationProbe: React.FC = () => {
  const location = useLocation();
  const state = location.state as
    { from?: { pathname?: string } } | null | undefined;
  return (
    <div data-testid="location" data-from={state?.from?.pathname ?? ""}>
      {location.pathname}
    </div>
  );
};

const renderPage = () =>
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={[INVITE_PATH]}>
        <LocationProbe />
        <Routes>
          <Route path="/invite/:token" element={<InvitationPage />} />
          <Route path="/login" element={<div />} />
          <Route path="/signup" element={<div />} />
          <Route path="/manage" element={<div />} />
          <Route path="/manage/collection/:collectionId" element={<div />} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );

const location = () => screen.getByTestId("location");

const acceptButton = () =>
  screen.queryByRole("button", { name: "Accept invitation" });
const declineButton = () => screen.queryByRole("button", { name: "Decline" });

beforeEach(() => {
  authState.currentUser = null;
  getInvitation.mockResolvedValue(preview);
  acceptInvitation.mockResolvedValue({ status: "accepted", collection });
  declineInvitation.mockResolvedValue(declinedRow);
  signOut.mockResolvedValue({ data: { success: true } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the invite page's loading and dead-link states", () => {
  it("shows a status while the preview is read, then the preview", async () => {
    let resolve!: (value: InvitationPreview) => void;
    getInvitation.mockReturnValue(
      new Promise<InvitationPreview>((settle) => {
        resolve = settle;
      }),
    );

    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();

    resolve(preview);
    expect(
      await screen.findByText(preview.collection.name),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders one dead-link state for a null preview and discloses nothing", async () => {
    getInvitation.mockResolvedValue(null);
    renderPage();

    expect(
      await screen.findByTestId("invitation-not-found"),
    ).toBeInTheDocument();
    // Nothing the invitation would have named, and no way to answer it.
    expect(screen.queryByText(preview.collection.name)).not.toBeInTheDocument();
    expect(screen.queryByText(preview.email)).not.toBeInTheDocument();
    expect(acceptButton()).not.toBeInTheDocument();
    expect(declineButton()).not.toBeInTheDocument();
  });

  it("offers a retry when the preview read fails, and recovers", async () => {
    getInvitation
      .mockRejectedValueOnce(new Error("the api is not answering"))
      .mockResolvedValueOnce(preview);
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId("invitation-failed");
    // A failed read is not a dead invitation: it must not claim the link is
    // gone, and the retry must run the read again.
    expect(
      screen.queryByTestId("invitation-not-found"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText(preview.collection.name),
    ).toBeInTheDocument();
    expect(getInvitation).toHaveBeenCalledTimes(2);
  });
});

describe("the invite page's signed-out preview", () => {
  it("names the collection, the inviter, the invited address and the expiry, and offers no answer", async () => {
    renderPage();

    expect(
      await screen.findByText(preview.collection.name),
    ).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(preview.inviter.name)),
    ).toBeInTheDocument();
    expect(screen.getByTestId("invitation-email")).toHaveTextContent(
      preview.email,
    );
    // The wire timestamp is seconds; the page's <time> carries the ISO the
    // browser (and a screen reader) understands.
    expect(screen.getByTestId("invitation-expiry")).toHaveAttribute(
      "dateTime",
      new Date(preview.expiresAt.seconds * 1000).toISOString(),
    );

    expect(acceptButton()).not.toBeInTheDocument();
    expect(declineButton()).not.toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(
      screen.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", "/signup");
  });

  it("sends a visitor to sign in and carries the invite path back", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(preview.collection.name);

    await user.click(screen.getByRole("link", { name: "Sign in" }));

    await waitFor(() => expect(location().textContent).toBe("/login"));
    expect(location()).toHaveAttribute("data-from", INVITE_PATH);
  });

  it("sends a visitor to sign up and carries the invite path back", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(preview.collection.name);

    await user.click(screen.getByRole("link", { name: "Create an account" }));

    await waitFor(() => expect(location().textContent).toBe("/signup"));
    expect(location()).toHaveAttribute("data-from", INVITE_PATH);
  });
});

describe("the invite page for the invited account", () => {
  it("accepts, and lands in the collection", async () => {
    signedInAs(preview.email);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(preview.collection.name);

    expect(acceptButton()).toBeInTheDocument();
    expect(declineButton()).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Accept invitation" }));

    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledWith(TOKEN));
    await waitFor(() =>
      expect(location().textContent).toBe(
        `/manage/collection/${collectionSlug(collection.name, collection.id)}`,
      ),
    );
  });

  it("declines, and shows the declined outcome with no way left to accept", async () => {
    signedInAs(preview.email);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(preview.collection.name);

    await user.click(screen.getByRole("button", { name: "Decline" }));

    await waitFor(() => expect(declineInvitation).toHaveBeenCalledWith(TOKEN));
    expect(
      await screen.findByTestId("invitation-declined"),
    ).toBeInTheDocument();
    expect(acceptButton()).not.toBeInTheDocument();
    expect(declineButton()).not.toBeInTheDocument();
  });

  it("turns a token that died between preview and accept into the dead-link state", async () => {
    signedInAs(preview.email);
    acceptInvitation.mockRejectedValue(
      new ApiRequestError(404, "not-found", "The invitation does not exist"),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(preview.collection.name);

    await user.click(screen.getByRole("button", { name: "Accept invitation" }));

    // Same state as any other dead link: nothing about this invitation is
    // left on screen, and no retry is offered.
    expect(
      await screen.findByTestId("invitation-not-found"),
    ).toBeInTheDocument();
    expect(screen.queryByText(preview.collection.name)).not.toBeInTheDocument();
  });

  it("says the account already has access when accept conflicts", async () => {
    signedInAs(preview.email);
    acceptInvitation.mockRejectedValue(
      new ApiRequestError(409, "conflict", "You already have access"),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(preview.collection.name);

    await user.click(screen.getByRole("button", { name: "Accept invitation" }));

    // A retry cannot fix this one, so the page must not answer with the
    // generic "try again" — it names the state.
    expect(
      await screen.findByTestId("invitation-action-error"),
    ).toHaveTextContent(/already have access/i);
    expect(location().textContent).toBe(INVITE_PATH);
  });

  it("turns the server's wrong-account refusal into the switch-account state", async () => {
    // The page thought the addresses matched; the server knows better. The
    // refusal's own address must reach the page — using a different one from
    // the preview's is what proves the page reads the refusal and not just
    // the preview it already had.
    const refusedEmail = "the-invited@example.test";
    signedInAs(preview.email);
    acceptInvitation.mockResolvedValue({
      status: "wrong-account",
      email: refusedEmail,
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(preview.collection.name);

    await user.click(screen.getByRole("button", { name: "Accept invitation" }));

    expect(
      await screen.findByRole("button", { name: "Switch account" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("invitation-email")).toHaveTextContent(
      refusedEmail,
    );
    expect(acceptButton()).not.toBeInTheDocument();
  });
});

describe("the invite page for a different account", () => {
  it("names the invited address and offers a switch, never an accept", async () => {
    signedInAs("someone-else@example.test");
    renderPage();
    await screen.findByText(preview.collection.name);

    const mismatch = screen.getByRole("alert");
    expect(
      within(mismatch).getByText(new RegExp(preview.email)),
    ).toBeInTheDocument();
    expect(
      within(mismatch).getByText(/someone-else@example\.test/),
    ).toBeInTheDocument();

    expect(acceptButton()).not.toBeInTheDocument();
    expect(declineButton()).not.toBeInTheDocument();
  });

  it("signs out and returns to sign-in with the invite path", async () => {
    signedInAs("someone-else@example.test");
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(preview.collection.name);

    await user.click(screen.getByRole("button", { name: "Switch account" }));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    await waitFor(() => expect(location().textContent).toBe("/login"));
    expect(location()).toHaveAttribute("data-from", INVITE_PATH);
  });
});
