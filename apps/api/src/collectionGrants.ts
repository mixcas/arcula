// The Access grant's pure facts: the token algebra and whether a row still
// admits its holder. No database, no session, no Hono — the unlock route mints
// and stores, the read paths load the row and ask this, so expiry reads the
// same everywhere.
//
// The raw token exists only in the reader's cookie. The row stores
// `sha256(token)`, which is what makes a database leak a set of unguessable
// hashes rather than a set of working grants. A password change deletes the
// collection's rows, so revocation needs no version column (ADR-0005).

import { createHash, randomBytes } from "node:crypto";
import type { collectionAccessGrants as collectionAccessGrantsTable } from "@arcula/db";

/** URL-safe, unguessable: 32 random bytes, base64url-encoded. */
export const mintGrantToken = (): string =>
  randomBytes(32).toString("base64url");

export const hashGrantToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

type GrantFacts = Pick<
  typeof collectionAccessGrantsTable.$inferSelect,
  "expiresAt"
>;

/**
 * A grant that has not expired. The exact expiry instant is no longer usable;
 * nothing is stored as a status, so the clock is the only answer.
 */
export const isGrantUsable = (
  grant: GrantFacts,
  now: Date = new Date(),
): boolean => grant.expiresAt.getTime() > now.getTime();
