// The invitation's pure facts: the token algebra and whether a row is still
// an offer. No database, no session, no Hono — the routes load the row and ask
// these, so expiry and single-use read the same everywhere.
//
// The raw token exists only in the mail. The row stores `sha256(token)`, which
// is what makes a database leak a set of unguessable hashes rather than a set
// of working links.

import { createHash, randomBytes } from "node:crypto";
import type { collectionInvitations as collectionInvitationsTable } from "@arcula/db";
import { INVITATION_RESEND_COOLDOWN_MS } from "@arcula/shared";

// The two durations are product facts shared with the owner's access card —
// one definition, so the UI's expired badge and disabled Resend button cannot
// disagree with the route's refusal. Re-exported for this package's callers.
export {
  INVITATION_RESEND_COOLDOWN_MS,
  INVITATION_TTL_MS,
} from "@arcula/shared";

/** URL-safe, unguessable: 32 random bytes, base64url-encoded. */
export const mintInvitationToken = (): string =>
  randomBytes(32).toString("base64url");

export const hashInvitationToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

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

type ResendFacts = Pick<
  typeof collectionInvitationsTable.$inferSelect,
  "status" | "createdAt"
>;

/** The earliest issue time a resend at `now` may replace. */
export const resendCutoff = (now: Date): Date =>
  new Date(now.getTime() - INVITATION_RESEND_COOLDOWN_MS);

/**
 * Whether the owner may send this invitation again: a pending row whose last
 * issue is older than the cooldown. Expiry is deliberately not part of it — a
 * lapsed offer is exactly the one the owner most needs to revive, and
 * resending replaces its issue time, so the link it mails is fresh. The
 * cooldown clock is `createdAt`, which every issue refreshes.
 */
export const isInvitationResendable = (
  invitation: ResendFacts,
  now: Date = new Date(),
): boolean =>
  invitation.status === "pending" &&
  invitation.createdAt.getTime() <= resendCutoff(now).getTime();
