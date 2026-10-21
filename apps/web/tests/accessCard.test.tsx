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
import { ModalsProvider } from "@mantine/modals";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CollectionAccess,
  InvitationSummary,
  Timestamp,
} from "@arcula/shared";

import AccessCard from "@/components/manage/collection/AccessCard";
import { ApiRequestError } from "@/services/api";
import { accessService } from "@/services/accessService";
import { invitationService } from "@/services/invitationService";

/**
 * The settings page's access card: whose view is rendered, the controls each
 * role gets, and the confirmations before either ending.
 *
 * The access read is the source of the role — not a dashboard row — so the
 * card renders what the read says. The two services are stubbed; their wire
 * halves are pinned by `accessService.test` and `invitationService.test`, and
 * the routes by the API suites. These tests keep the card's own decisions
 * true: expired offers stay visible and resendable, the resend cooldown is the
 * server's own window, an unsent mail is a warning rather than a lost
 * invitation, and remove/leave warn before they discard staged uploads.
 */
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/accessService", () => ({
  accessService: {
    getAccess: vi.fn(),
    removeCollaborator: vi.fn(),
    leaveCollection: vi.fn(),
    transferCollection: vi.fn(),
  },
}));

vi.mock("@/services/invitationService", () => ({
  invitationService: {
    createInvitation: vi.fn(),
    resendInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
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
const getAccess = vi.mocked(accessService.getAccess);
const removeCollaborator = vi.mocked(accessService.removeCollaborator);
const leaveCollection = vi.mocked(accessService.leaveCollection);
const transferCollection = vi.mocked(accessService.transferCollection);
const createInvitation = vi.mocked(invitationService.createInvitation);
const resendInvitation = vi.mocked(invitationService.resendInvitation);
const revokeInvitation = vi.mocked(invitationService.revokeInvitation);
/* eslint-enable @typescript-eslint/unbound-method */

const COLLECTION_ID = "cccccccccccccccccccc";

const ts = (ms: number): Timestamp => ({
  seconds: Math.floor(ms / 1000),
  nanoseconds: (ms % 1000) * 1e6,
});

const NOW = Date.now();
const AN_HOUR = 60 * 60 * 1000;
const A_DAY = 24 * AN_HOUR;

const OWNER = {
  userId: "u-owner",
  name: "Sofía Lara",
  email: "owner@example.test",
};

const MATE = {
  userId: "u-mate",
  name: "Mateo Ruiz",
  email: "mate@example.test",
};

const invitation = (
  overrides: Partial<InvitationSummary> = {},
): InvitationSummary => ({
  id: "iiiiiiiiiiiiiiiiiiii",
  collectionId: COLLECTION_ID,
  email: "invited@example.test",
  invitedByUserId: OWNER.userId,
  status: "pending",
  // Issued well outside the cooldown, expiring in a week: the ordinary row.
  createdAt: ts(NOW - A_DAY),
  expiresAt: ts(NOW + 6 * A_DAY),
  resolvedAt: null,
  ...overrides,
});

const ownerAccess = (
  overrides: Partial<CollectionAccess> = {},
): CollectionAccess => ({
  role: "owner",
  owner: OWNER,
  collaborators: [MATE],
  invitations: [invitation()],
  ...overrides,
});

const collaboratorAccess = (
  overrides: Partial<CollectionAccess> = {},
): CollectionAccess => ({
  role: "collaborator",
  owner: OWNER,
  collaborators: [MATE],
  ...overrides,
});

/** The router's own location, so leaving can be asserted. */
const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

const renderCard = (access: CollectionAccess) => {
  getAccess.mockResolvedValue(access);
  return render(
    <MantineProvider>
      <ModalsProvider>
        <MemoryRouter initialEntries={["/manage/collection/flores/settings"]}>
          <LocationProbe />
          <AccessCard collectionId={COLLECTION_ID} />
        </MemoryRouter>
      </ModalsProvider>
    </MantineProvider>,
  );
};

/** The confirm dialog element, the last one mounted. */
const dialogEl = async () => {
  const found = await screen.findAllByRole("dialog");
  return found[found.length - 1];
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the owner's access card", () => {
  it("offers the invite form, the pending offers and the collaborators, and no leave action", async () => {
    renderCard(ownerAccess());

    expect(await screen.findByText("Pending invitations")).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send invitation/i }),
    ).toBeInTheDocument();

    const offerRow = screen.getByTestId(
      "access-invitation-iiiiiiiiiiiiiiiiiiii",
    );
    expect(within(offerRow).getByText("invited@example.test")).toBeTruthy();
    expect(
      within(offerRow).getByRole("button", { name: /resend/i }),
    ).toBeEnabled();

    const mateRow = screen.getByTestId("access-collaborator-u-mate");
    expect(within(mateRow).getByText("Mateo Ruiz")).toBeTruthy();
    expect(
      within(mateRow).getByRole("button", { name: /remove/i }),
    ).toBeTruthy();

    // The owner cannot leave: a collection is never left without an owner.
    expect(
      screen.queryByRole("button", { name: /leave/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps an expired offer visible, marked, and still resendable and revocable", async () => {
    const lapsed = invitation({
      createdAt: ts(NOW - 8 * A_DAY),
      expiresAt: ts(NOW - A_DAY),
    });
    renderCard(ownerAccess({ invitations: [lapsed] }));

    const row = await screen.findByTestId(
      "access-invitation-iiiiiiiiiiiiiiiiiiii",
    );
    // Distinct from a live offer, and not silently swept away: it can still be
    // revived (the mailed link is already dead, a resend mints a fresh one).
    expect(within(row).getByText("Expired")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /resend/i })).toBeEnabled();
    expect(within(row).getByRole("button", { name: /revoke/i })).toBeEnabled();
  });

  it("disables Resend inside the cooldown", async () => {
    // Issued seconds ago: still inside the server's 60-second window.
    const cooling = invitation({ createdAt: ts(NOW - 10_000) });
    renderCard(ownerAccess({ invitations: [cooling] }));

    const row = await screen.findByTestId(
      "access-invitation-iiiiiiiiiiiiiiiiiiii",
    );
    expect(within(row).getByRole("button", { name: /resend/i })).toBeDisabled();
  });

  it("a resend refreshes the row's expiry and re-arms the cooldown", async () => {
    // A row old enough to resend, whose offer has lapsed: the click rotates
    // the expiry, so the same row stops reading as expired.
    const stale = invitation({
      createdAt: ts(NOW - 8 * A_DAY),
      expiresAt: ts(NOW - A_DAY),
    });
    renderCard(ownerAccess({ invitations: [stale] }));

    const row = await screen.findByTestId(
      "access-invitation-iiiiiiiiiiiiiiiiiiii",
    );
    resendInvitation.mockResolvedValue({
      invitation: {
        ...stale,
        createdAt: ts(Date.now()),
        expiresAt: ts(Date.now() + 7 * A_DAY),
      },
      emailSent: true,
    });
    await userEvent
      .setup()
      .click(within(row).getByRole("button", { name: /resend/i }));

    expect(resendInvitation).toHaveBeenCalledWith(
      COLLECTION_ID,
      "iiiiiiiiiiiiiiiiiiii",
    );
    await waitFor(() =>
      expect(within(row).queryByText("Expired")).not.toBeInTheDocument(),
    );
    // The row's fresh issue time is the cooldown's clock, so the control is
    // shut again without a second read.
    expect(within(row).getByRole("button", { name: /resend/i })).toBeDisabled();
  });

  it("revokes the offer the click named and drops the row", async () => {
    const offer = invitation();
    revokeInvitation.mockResolvedValue({
      ...offer,
      status: "revoked",
      resolvedAt: ts(NOW),
    });
    renderCard(ownerAccess({ invitations: [offer] }));

    const row = await screen.findByTestId(
      "access-invitation-iiiiiiiiiiiiiiiiiiii",
    );
    await userEvent
      .setup()
      .click(within(row).getByRole("button", { name: /revoke/i }));

    expect(revokeInvitation).toHaveBeenCalledWith(
      COLLECTION_ID,
      "iiiiiiiiiiiiiiiiiiii",
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("access-invitation-iiiiiiiiiiiiiiiiiiii"),
      ).not.toBeInTheDocument(),
    );
  });

  it("reports a validation failure on the field and sends nothing", async () => {
    renderCard(ownerAccess());

    await screen.findByLabelText(/email address/i);
    await userEvent
      .setup()
      .type(screen.getByLabelText(/email address/i), "not-an-email");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /send invitation/i }));

    expect(
      await screen.findByText(/enter a valid email address/i),
    ).toBeInTheDocument();
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("names the conflict the API reports instead of a generic failure", async () => {
    createInvitation.mockRejectedValue(
      new ApiRequestError(
        409,
        "conflict",
        "An invitation for that address is already pending",
      ),
    );
    renderCard(ownerAccess());

    await screen.findByLabelText(/email address/i);
    await userEvent
      .setup()
      .type(screen.getByLabelText(/email address/i), "invited@example.test");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /send invitation/i }));

    expect(
      await screen.findByText(
        "An invitation for that address is already pending",
      ),
    ).toBeInTheDocument();
  });

  it("keeps an invitation whose mail failed, and says it is resendable", async () => {
    const sent = invitation({ createdAt: ts(NOW - A_DAY) });
    createInvitation.mockResolvedValue({
      invitation: sent,
      emailSent: false,
    });
    renderCard(ownerAccess({ invitations: [] }));

    await screen.findByLabelText(/email address/i);
    await userEvent
      .setup()
      .type(screen.getByLabelText(/email address/i), "invited@example.test");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /send invitation/i }));

    expect(
      await screen.findByTestId("access-invite-warning"),
    ).toHaveTextContent(/could not be sent/i);
    const row = screen.getByTestId("access-invitation-iiiiiiiiiiiiiiiiiiii");
    expect(within(row).getByRole("button", { name: /resend/i })).toBeEnabled();
  });

  it("warns before a transfer that it is immediate and that the owner becomes a collaborator, then re-reads the card", async () => {
    transferCollection.mockResolvedValue({
      transferred: true,
      emailSent: true,
    });
    renderCard(ownerAccess());

    const mateRow = await screen.findByTestId("access-collaborator-u-mate");
    await userEvent
      .setup()
      .click(
        within(mateRow).getByRole("button", { name: /transfer ownership/i }),
      );

    const scope = within(await dialogEl());
    expect(transferCollection).not.toHaveBeenCalled();

    // The read after the transfer is the caller's new role: they are a
    // collaborator, so the owner controls give way to leave.
    getAccess.mockResolvedValueOnce(collaboratorAccess());
    await userEvent
      .setup()
      .click(scope.getByRole("button", { name: /transfer ownership/i }));

    expect(transferCollection).toHaveBeenCalledWith(COLLECTION_ID, "u-mate");
    expect(
      await screen.findByRole("button", { name: /leave collection/i }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("access-card")).queryByRole("button", {
        name: /transfer ownership/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByTestId("access-transfer-notice"),
    ).toBeInTheDocument();
  });

  it("keeps the transfer and says so when the notice could not be sent", async () => {
    transferCollection.mockResolvedValue({
      transferred: true,
      emailSent: false,
    });
    renderCard(ownerAccess());

    const mateRow = await screen.findByTestId("access-collaborator-u-mate");
    await userEvent
      .setup()
      .click(
        within(mateRow).getByRole("button", { name: /transfer ownership/i }),
      );
    getAccess.mockResolvedValueOnce(collaboratorAccess());
    await userEvent.setup().click(
      within(await dialogEl()).getByRole("button", {
        name: /transfer ownership/i,
      }),
    );

    // The transfer is the durable fact; only the notice failed.
    expect(transferCollection).toHaveBeenCalledWith(COLLECTION_ID, "u-mate");
    expect(
      await screen.findByTestId("access-transfer-notice"),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /leave collection/i }),
    ).toBeInTheDocument();
  });

  it("asks before removing, warns that unsaved uploads go with it, then drops the row", async () => {
    removeCollaborator.mockResolvedValue(undefined);
    renderCard(ownerAccess());

    const mateRow = await screen.findByTestId("access-collaborator-u-mate");
    await userEvent
      .setup()
      .click(within(mateRow).getByRole("button", { name: /remove/i }));

    const scope = within(await dialogEl());
    expect(scope.getByText(/unsaved uploads/i)).toBeInTheDocument();
    expect(removeCollaborator).not.toHaveBeenCalled();

    await userEvent
      .setup()
      .click(scope.getByRole("button", { name: /remove/i }));

    expect(removeCollaborator).toHaveBeenCalledWith(COLLECTION_ID, "u-mate");
    await waitFor(() =>
      expect(
        screen.queryByTestId("access-collaborator-u-mate"),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows a stale-card conflict as the API words it, and refreshes from the alert", async () => {
    removeCollaborator.mockRejectedValue(
      new ApiRequestError(
        409,
        "conflict",
        "That account does not have access to this collection",
      ),
    );
    renderCard(ownerAccess());

    const mateRow = await screen.findByTestId("access-collaborator-u-mate");
    await userEvent
      .setup()
      .click(within(mateRow).getByRole("button", { name: /remove/i }));
    await userEvent
      .setup()
      .click(within(await dialogEl()).getByRole("button", { name: /remove/i }));

    const alert = await screen.findByTestId("access-action-error");
    expect(alert).toHaveTextContent(
      "That account does not have access to this collection",
    );

    // The read has moved on: the next one no longer names the stale member.
    getAccess.mockResolvedValueOnce(ownerAccess({ collaborators: [] }));
    await userEvent
      .setup()
      .click(within(alert).getByRole("button", { name: /refresh/i }));

    await waitFor(() => expect(getAccess).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByTestId("access-collaborator-u-mate"),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("a collaborator's access card", () => {
  it("shows the owner and the collaborators, and offers no owner-only control", async () => {
    renderCard(collaboratorAccess());

    expect(await screen.findByText("Sofía Lara")).toBeInTheDocument();
    expect(
      screen.getByTestId("access-collaborator-u-mate"),
    ).toBeInTheDocument();

    // The invitation list and the invite form are the owner's administrative
    // view, absent from a collaborator's read and from this card.
    expect(screen.queryByText("Pending invitations")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /send invitation/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /leave collection/i }),
    ).toBeInTheDocument();
  });

  it("leaves only after a confirmation that warns, then returns to the dashboard", async () => {
    leaveCollection.mockResolvedValue(undefined);
    renderCard(collaboratorAccess());

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /leave collection/i }));

    const scope = within(await dialogEl());
    expect(scope.getByText(/unsaved uploads/i)).toBeInTheDocument();
    expect(leaveCollection).not.toHaveBeenCalled();

    await userEvent
      .setup()
      .click(scope.getByRole("button", { name: /leave/i }));

    expect(leaveCollection).toHaveBeenCalledWith(COLLECTION_ID);
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/manage"),
    );
  });
});
