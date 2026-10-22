// The Access grant's pure facts: the token algebra, the name it travels under
// and whether a row still admits its holder. No database, no session, no Hono —
// the unlock route mints and stores, the read paths load the row and ask this,
// so expiry reads the same everywhere.
//
// The raw token exists only in the reader's cookie. The row stores
// `sha256(token)`, which is what makes a database leak a set of unguessable
// hashes rather than a set of working grants. A password change deletes the
// collection's rows, so revocation needs no version column (ADR-0005).
//
// The cookie's NAME is its scope: one cookie per collection, and a route reads
// only the name for the collection it is serving, so a cookie minted for
// another collection is never even consulted. The cookie's `Path` cannot say
// "this collection" — no prefix covers `/collections/{id}`, its artwork reads
// and `/api/v1/media` while excluding anything else — so the path is broad on
// purpose and the name carries the isolation (ADR-0005).

import { createHash, randomBytes } from "node:crypto";
import type { collectionAccessGrants as collectionAccessGrantsTable } from "@arcula/db";

/** URL-safe, unguessable: 32 random bytes, base64url-encoded. */
export const mintGrantToken = (): string =>
  randomBytes(32).toString("base64url");

/** How long a grant admits its holder, in both the cookie's `Max-Age` and the
 *  row's `expiresAt`: twelve hours, one number for the two clocks. */
export const GRANT_TTL_MS = 12 * 60 * 60 * 1000;

/** The cookie's path on the API: broad, because the media proxy is one route
 *  for every collection's bytes (see the module comment). */
export const GRANT_COOKIE_PATH = "/api/v1";

/** The one cookie this collection's unlock mints and its routes read. */
export const grantCookieName = (collectionId: string): string =>
  `arcula_grant_${collectionId}`;

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
