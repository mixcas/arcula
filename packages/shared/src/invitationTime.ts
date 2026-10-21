// The invitation's clock: the two product durations and the wire reading of
// them. The API asks the same facts of a row before it acts (its
// `isInvitationUsable` / `isInvitationResendable`), and the owner's access
// card asks them of the serialized row so the badge and the Resend button say
// the same thing the route will answer.
//
// The timestamps are the wire shape (`{ seconds, nanoseconds }`), not a Date:
// this is the client's half of the contract, and it must not reach into the
// server's row type to read it.

import type { Timestamp } from "./types";

/** An invitation is valid for seven days from its current issue. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A resend may not follow the previous send sooner than this. */
export const INVITATION_RESEND_COOLDOWN_MS = 60 * 1000;

/** A wire timestamp as epoch milliseconds. */
export const timestampMillis = (timestamp: Timestamp): number =>
  timestamp.seconds * 1000 + Math.floor(timestamp.nanoseconds / 1e6);

/**
 * A pending row whose expiry is at or before `now`. The API's usable check is
 * `expiresAt > now`, so the exact instant is already lapsed — the same
 * comparison here is what keeps the card from offering a link the server
 * refuses.
 */
export const invitationLapsed = (
  expiresAt: Timestamp,
  now: number = Date.now(),
): boolean => timestampMillis(expiresAt) <= now;

/**
 * How long the owner must still wait before this row may be resent, in
 * milliseconds; `0` once the cooldown has passed. The clock is `createdAt`,
 * which every issue refreshes — the same column the route's cutoff reads.
 */
export const invitationResendWaitMs = (
  createdAt: Timestamp,
  now: number = Date.now(),
): number =>
  Math.max(0, timestampMillis(createdAt) + INVITATION_RESEND_COOLDOWN_MS - now);
