// The invitation's pure facts: the token algebra and whether a row is still
// an offer. No database, no session, no Hono — the routes load the row and ask
// these, so expiry and single-use read the same everywhere.
//
// The raw token exists only in the mail. The row stores `sha256(token)`, which
// is what makes a database leak a set of unguessable hashes rather than a set
// of working links.

import { createHash, randomBytes } from "node:crypto";
import type { collectionInvitations as collectionInvitationsTable } from "@arcula/db";

/** An invitation is valid for seven days from its current issue. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** URL-safe, unguessable: 32 random bytes, base64url-encoded. */
export const mintInvitationToken = (): string =>
  randomBytes(32).toString("base64url");

export const hashInvitationToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** Stored and compared in this form, so "A@B.test" and "a@b.test" are one
 *  address. */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

type InvitationFacts = Pick<
  typeof collectionInvitationsTable.$inferSelect,
  "status" | "expiresAt"
>;

/**
 * A pending, unexpired invitation. Accepted, declined and revoked rows are
 * history; an expired row is still technically `pending`, so expiry is always
 * computed from the timestamp, never read off the status column.
 */
export const isInvitationUsable = (
  invitation: InvitationFacts,
  now: Date = new Date(),
): boolean =>
  invitation.status === "pending" &&
  invitation.expiresAt.getTime() > now.getTime();
