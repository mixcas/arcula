/**
 * The invitation service layer.
 *
 * The preview is public; accept and decline need the session the mail's
 * recipient signed in with. The raw token is only ever a path segment on these
 * calls — it is not stored, not echoed, and not logged.
 *
 * Every response is parsed through the shared wire schemas (the same doctrine
 * as the collection service): a reshaped document is a parse failure at the
 * boundary, not a half-rendered page. That includes the one structured refusal
 * the page reads — a wrong-account acceptance, whose invited address rides
 * `error.details.email` — so a refusal that stops carrying it fails loudly
 * instead of leaving the page guessing whose invitation it is.
 */

import { z } from "zod";
import {
  collectionReadSchema,
  invitationInboxEntrySchema,
  invitationPreviewSchema,
  invitationSummarySchema,
  type Collection,
  type InvitationInboxEntry,
  type InvitationPreview,
  type InvitationSummary,
} from "@arcula/shared";
import { ApiRequestError, apiRequest } from "./api";

const BASE = "/api/v1/invitations";
/** The invitee's own offers: listed and declined by id, never accepted here. */
const INBOX = "/api/v1/me/invitations";

/** The forbidden envelope's detail on a wrong-account acceptance. */
const wrongAccountDetailSchema = z.object({ email: z.string() });

/**
 * The accept route's two meaningful answers: the collection the account now
 * shares, or the address the invitation was actually for. Every other outcome
 * is an error and stays one.
 */
export type AcceptInvitationOutcome =
  | { status: "accepted"; collection: Collection }
  | { status: "wrong-account"; email: string };

const path = (token: string, suffix = ""): string =>
  `${BASE}/${encodeURIComponent(token)}${suffix}`;

export const invitationService = {
  /**
   * The public preview. An unknown, expired, revoked or consumed token is the
   * API's one uniform 404 — folded to `null` here so the page renders a single
   * not-found state and never learns why the link stopped working.
   */
  async getInvitation(token: string): Promise<InvitationPreview | null> {
    try {
      const row = await apiRequest<unknown>(path(token));
      return invitationPreviewSchema.parse(row);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        return null;
      }
      throw err;
    }
  },

  /**
   * Accept. A 403 is the server saying the signed-in address is not the
   * invited one; its detail is parsed, so the page can name the address the
   * invitation belongs to. A 404 (the token was consumed or lapsed between the
   * preview and the click) stays an error for the page to map.
   */
  async acceptInvitation(token: string): Promise<AcceptInvitationOutcome> {
    try {
      const row = await apiRequest<unknown>(path(token, "/accept"), {
        method: "POST",
      });
      return {
        status: "accepted",
        collection: collectionReadSchema.parse(row),
      };
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 403) {
        const detail = wrongAccountDetailSchema.parse(err.details);
        return { status: "wrong-account", email: detail.email };
      }
      throw err;
    }
  },

  /** Decline. The answer is the resolved row; the page reads its status. */
  async declineInvitation(token: string): Promise<InvitationSummary> {
    const row = await apiRequest<unknown>(path(token, "/decline"), {
      method: "POST",
    });
    return invitationSummarySchema.parse(row);
  },

  /**
   * The offers addressed to the signed-in account: pending and unexpired, for
   * the dashboard. The server narrows by the session's own address, so nothing
   * about whose list this is travels from here.
   */
  async getPendingInvitations(): Promise<InvitationInboxEntry[]> {
    const rows = await apiRequest<unknown[]>(INBOX);
    return rows.map((row) => invitationInboxEntrySchema.parse(row));
  },

  /**
   * Decline an offer by id, in app. Acceptance is deliberately absent: it
   * needs the mail's token (ADR-0004). The answer is the resolved row, so the
   * caller can confirm it really is `declined` before dropping the card.
   */
  async declinePendingInvitation(id: string): Promise<InvitationSummary> {
    const row = await apiRequest<unknown>(
      `${INBOX}/${encodeURIComponent(id)}/decline`,
      { method: "POST" },
    );
    return invitationSummarySchema.parse(row);
  },
};
