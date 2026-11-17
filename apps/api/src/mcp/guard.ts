// The endpoint's guard: `requireMcpAuth` verifies the access token, and the
// connection check makes a revoked Connection dead before the JWT expires.
//
// Two facts, deliberately in this order:
//
//  1. The JWT is the credential. `requireMcpAuth` verifies signature, issuer,
//     audience and expiry against the auth instance's JWKS, and a missing or
//     invalid token gets the RFC 9728 challenge that starts the client's
//     discovery flow. Nothing here parses the token; the verified claims are
//     handed over.
//  2. The consent row is the permission. Access tokens are JWTs and are not
//     stored, so deleting the row the provider writes for "this account
//     approved this client" cannot revoke an issued token by itself — but the
//     guard reads that row on every call, so the next request answers 401
//     "revoked". That is what makes Revoke immediate despite a token that
//     lives for its full hour.
//
// The same read is where "when it last acted" comes from (#288): the row's
// `updatedAt` is touched at most once a minute, so a busy agent does not write
// on every call. The plugin moves that column only on a scope change, so the
// touch is ours to own — and it is the only source the plugin's model offers.

import { requireMcpAuth } from "@better-auth/mcp";
import { and, eq } from "drizzle-orm";
import { oauthConsent as oauthConsentTable } from "@arcula/db";
import { auth } from "../auth";
import { db } from "../db";
import { mcpResource } from "../env";
import { mcpHandler } from "./server";

/** How stale "last acted" may be: one write per connection per minute. */
export const CONNECTION_TOUCH_INTERVAL_MS = 60_000;

/**
 * The RFC 9728 metadata pointer for a resource identifier, in the
 * resource-path-inserted form the plugin publishes:
 * `https://host/.well-known/oauth-protected-resource/api/mcp`.
 */
export const resourceMetadataUrl = (resource: string): string => {
  const url = new URL(resource);
  const path = url.pathname.endsWith("/")
    ? url.pathname.slice(0, -1)
    : url.pathname;
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
};

/** Whether a connection's "last acted" is old enough to move. */
export const consentTouchDue = (
  lastTouched: Date,
  now: Date,
  intervalMs = CONNECTION_TOUCH_INTERVAL_MS,
): boolean => now.getTime() - lastTouched.getTime() >= intervalMs;

/**
 * The consent row, or `false`. One read per MCP call; the touch is the only
 * write, and only once a minute.
 */
const connectionStillApproved = async (
  userId: string,
  clientId: string,
  now = new Date(),
): Promise<boolean> => {
  const [consent] = await db
    .select({
      id: oauthConsentTable.id,
      updatedAt: oauthConsentTable.updatedAt,
    })
    .from(oauthConsentTable)
    .where(
      and(
        eq(oauthConsentTable.userId, userId),
        eq(oauthConsentTable.clientId, clientId),
      ),
    )
    .limit(1);
  if (!consent) return false;
  if (consentTouchDue(consent.updatedAt, now)) {
    await db
      .update(oauthConsentTable)
      .set({ updatedAt: now })
      .where(eq(oauthConsentTable.id, consent.id));
  }
  return true;
};

/**
 * The 401 a revoked connection answers: a JSON-RPC error (the transport's
 * shape), the RFC 9728 challenge a client needs to start a fresh authorization,
 * and a message a person can act on.
 */
const revokedConnectionResponse = (): Response =>
  new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message:
          "This connection was revoked. Reconnect the agent from the client's settings.",
      },
      id: null,
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl(mcpResource)}"`,
      },
    },
  );

/**
 * The endpoint's whole handler: verify the token, prove the connection is
 * still approved, then let the SDK serve the call.
 *
 * `authInfo.token` is deliberately empty — the token is read by the guard and
 * never reaches a tool. `sub` and `jti` ride `extra`, which is the only place
 * the factory reads the principal from.
 */
export const mcpPost = requireMcpAuth(
  auth,
  async (request, claims) => {
    const userId = typeof claims.sub === "string" ? claims.sub : "";
    const clientId =
      typeof claims.client_id === "string" ? claims.client_id : "";
    if (
      userId === "" ||
      clientId === "" ||
      !(await connectionStillApproved(userId, clientId))
    ) {
      return revokedConnectionResponse();
    }
    return mcpHandler.fetch(request, {
      authInfo: {
        token: "",
        clientId,
        scopes: typeof claims.scope === "string" ? claims.scope.split(" ") : [],
        expiresAt: typeof claims.exp === "number" ? claims.exp : undefined,
        extra: { sub: userId, jti: claims.jti },
      },
    });
  },
  { resource: mcpResource },
);
