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
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvitationInboxEntry, InvitationSummary } from "@arcula/shared";

import PendingInvitations from "@/components/manage/PendingInvitations";
import { ApiRequestError } from "@/services/api";
import { invitationService } from "@/services/invitationService";

/**
 * The dashboard's pending-offer cards: what the invitee sees, what the one
 * control does, and what is deliberately absent.
 *
 * The service is stubbed; its wire half is pinned by `invitationService.test`,
 * and the routes by the API's invitation-offer suite. These tests keep the
 * card's own decisions true — that each offer is named by collection and
 * inviter, that decline removes the offer the click named, and that there is no
 * accept control at all (acceptance is the mail's token, ADR-0004).
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/invitationService", () => ({
  invitationService: {
    getPendingInvitations: vi.fn(),
    declinePendingInvitation: vi.fn(),
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

/* eslint-disable @typescript-eslint/unbound-method */
const getPendingInvitations = vi.mocked(
  invitationService.getPendingInvitations,
);
const declinePendingInvitation = vi.mocked(
  invitationService.declinePendingInvitation,
);
/* eslint-enable @typescript-eslint/unbound-method */

const invitation = (
  overrides: Partial<InvitationInboxEntry> = {},
): InvitationInboxEntry => ({
  id: "iiiiiiiiiiiiiiiiiiii",
  collectionId: "cccccccccccccccccccc",
  email: "invitee@example.test",
  invitedByUserId: "u-owner",
  status: "pending",
  createdAt: { seconds: 1, nanoseconds: 0 },
  expiresAt: { seconds: 1790000000, nanoseconds: 0 },
  resolvedAt: null,
  collectionName: "Flores Solares",
  inviterName: "Sofía Lara",
  ...overrides,
});

const declined = (entry: InvitationInboxEntry): InvitationSummary => ({
  id: entry.id,
  collectionId: entry.collectionId,
  email: entry.email,
  invitedByUserId: entry.invitedByUserId,
  status: "declined",
  createdAt: entry.createdAt,
  expiresAt: entry.expiresAt,
  resolvedAt: { seconds: 2, nanoseconds: 0 },
});

const renderList = (rows: InvitationInboxEntry[]) => {
  getPendingInvitations.mockResolvedValue(rows);
  return render(
    <MantineProvider>
      <PendingInvitations />
    </MantineProvider>,
  );
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the dashboard's pending invitations", () => {
  it("names each offer by collection and inviter, and points acceptance at the mail", async () => {
    renderList([
      invitation(),
      invitation({
        id: "jjjjjjjjjjjjjjjjjjjj",
        collectionId: "dddddddddddddddddddd",
        collectionName: "Estudio Compartido",
        inviterName: "Mateo Ruiz",
      }),
    ]);

    expect(await screen.findByText("Flores Solares")).toBeInTheDocument();
    expect(screen.getByText("Estudio Compartido")).toBeInTheDocument();
    expect(screen.getByText("Invited by Sofía Lara")).toBeInTheDocument();
    expect(screen.getByText("Invited by Mateo Ruiz")).toBeInTheDocument();
    // Each card says where acceptance happens: the mailed link, not here.
    expect(
      screen.getAllByText(
        /acceptance happens through the link in the email sent to invitee@example\.test/i,
      ),
    ).toHaveLength(2);
  });

  it("offers decline and no accept control", async () => {
    renderList([invitation()]);

    const card = await screen.findByTestId(
      "pending-invitation-iiiiiiiiiiiiiiiiiiii",
    );
    expect(
      within(card).getByRole("button", { name: /decline/i }),
    ).toBeInTheDocument();
    // The failure this pins: an in-app accept that bypasses the mail's token.
    expect(
      screen.queryByRole("button", { name: /accept/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /accept/i }),
    ).not.toBeInTheDocument();
  });

  it("removes the offer the decline named, leaving the others", async () => {
    const first = invitation();
    const second = invitation({
      id: "jjjjjjjjjjjjjjjjjjjj",
      collectionId: "dddddddddddddddddddd",
      collectionName: "Estudio Compartido",
      inviterName: "Mateo Ruiz",
    });
    declinePendingInvitation.mockResolvedValue(declined(first));
    renderList([first, second]);

    const card = await screen.findByTestId(
      "pending-invitation-iiiiiiiiiiiiiiiiiiii",
    );
    await userEvent
      .setup()
      .click(within(card).getByRole("button", { name: /decline/i }));

    expect(declinePendingInvitation).toHaveBeenCalledWith(first.id);
    await waitFor(() =>
      expect(
        screen.queryByTestId(`pending-invitation-${first.id}`),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByTestId(`pending-invitation-${second.id}`),
    ).toBeInTheDocument();
  });

  it("keeps the card and says so when the decline fails", async () => {
    declinePendingInvitation.mockRejectedValue(new Error("connection lost"));
    renderList([invitation()]);

    const card = await screen.findByTestId(
      "pending-invitation-iiiiiiiiiiiiiiiiiiii",
    );
    await userEvent
      .setup()
      .click(within(card).getByRole("button", { name: /decline/i }));

    expect(
      await screen.findByTestId("pending-invitations-action-error"),
    ).toBeInTheDocument();
    expect(card).toBeInTheDocument();
  });

  it("drops a card whose offer lapsed before the click, without an error", async () => {
    // A 404 is the API saying this is no longer an offer at all. The reader
    // cannot act on that, so the card simply goes.
    declinePendingInvitation.mockRejectedValue(
      new ApiRequestError(404, "not-found", "The invitation does not exist"),
    );
    renderList([invitation()]);

    const card = await screen.findByTestId(
      "pending-invitation-iiiiiiiiiiiiiiiiiiii",
    );
    await userEvent
      .setup()
      .click(within(card).getByRole("button", { name: /decline/i }));

    await waitFor(() =>
      expect(
        screen.queryByTestId("pending-invitation-iiiiiiiiiiiiiiiiiiii"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("pending-invitations-action-error"),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when the account has no offers", async () => {
    renderList([]);

    await waitFor(() => expect(getPendingInvitations).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("pending-invitations")).not.toBeInTheDocument();
  });
});
