// The connection (OAuth consent) routes.
//
//   GET    /connections/request    the signed authorize query, verified, plus
//                                  the client it names — what the consent
//                                  screen shows
//   GET    /connections            the account's Connections, with the MCP
//                                  endpoint — the "Connected apps" block
//   DELETE /connections/:id        ends one Connection: that account's
//                                  approval of that client, and its live
//                                  refresh tokens
//
// The consent screen itself is app-owned (the plugin has no UI): the provider
// redirects the browser to `/consent` with the whole authorization query
// re-signed, and the SPA cannot verify a signature. So the page asks this
// route, which rebuilds the signed subset, verifies it against the auth
// instance's secret, and loads the client's public metadata. The page renders
// only what this answers, and posts the same verified query back.
//
// The client's name and links are chosen by whoever controls its metadata
// document, so nothing here is trusted as copy: a link rides only when it is
// `https:`, and the signed `redirect_uri`'s host comes back beside the name
// for the person to compare.
//
// A Connection is the consent row: one per (account, client), which is what
// the MCP guard reads on every call. Revoke therefore deletes every consent
// row for the pair (the plugin declares no unique index, so a find-then-create
// race can leave two) and revokes every live refresh-token row for it. The
// session is a different credential and is never touched — and the guard's
// next call for that client is a 401, because the row it reads is gone.

import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import {
  connectionsReadSchema,
  type ConnectionRequestRead,
} from "@arcula/shared";
import {
  oauthClient as oauthClientTable,
  oauthConsent as oauthConsentTable,
  oauthRefreshToken as oauthRefreshTokenTable,
} from "@arcula/db";
import { auth } from "../auth";
import { newestPerClient } from "../connectionList";
import {
  httpsOnlyLink,
  isSignedConsentQuery,
  signedConsentQuery,
  verifyConsentQuery,
} from "../consentQuery";
import { db } from "../db";
import { mcpResource } from "../env";
import { ApiError } from "../errors";
import { param } from "../http";
import { wireTimestamp } from "../serialize";
import { requireSession } from "../session";

export const connectionRoutes = new Hono();

connectionRoutes.get("/connections/request", requireSession, async (c) => {
  const query = signedConsentQuery(new URL(c.req.url).searchParams);
  if (!isSignedConsentQuery(query)) {
    throw new ApiError(
      "validation",
      "This connection request did not come from an authorization page. Start again from your client.",
    );
  }
  const { secret } = await auth.$context;
  if (!(await verifyConsentQuery(query, secret))) {
    throw new ApiError(
      "validation",
      "This connection request has expired or was altered. Start again from your client.",
    );
  }

  const params = new URLSearchParams(query);
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  if (!clientId || !redirectUri) {
    throw new ApiError(
      "validation",
      "This connection request is incomplete. Start again from your client.",
    );
  }

  let redirectHost: string;
  try {
    redirectHost = new URL(redirectUri).host;
  } catch {
    throw new ApiError(
      "validation",
      "This connection request names an invalid redirect address. Start again from your client.",
    );
  }

  let client: Awaited<ReturnType<typeof auth.api.getOAuthClientPublic>>;
  try {
    client = await auth.api.getOAuthClientPublic({
      query: { client_id: clientId },
      headers: c.req.raw.headers,
    });
  } catch {
    // The query verified, so this is a client that was deleted between the
    // authorize redirect and this read. Nothing to approve.
    throw new ApiError(
      "validation",
      "This connection request names a client that no longer exists. Start again from your client.",
    );
  }

  const body: ConnectionRequestRead = {
    client: {
      // CIMD requires a name, but a hand-registered client may lack one. The
      // redirect host is the honest fallback: it is what the person is really
      // approving.
      name: client.client_name?.trim() || redirectHost,
      uri: httpsOnlyLink(client.client_uri),
      logo: httpsOnlyLink(client.logo_uri),
      tos: httpsOnlyLink(client.tos_uri),
      policy: httpsOnlyLink(client.policy_uri),
    },
    redirectHost,
    scopes: (params.get("scope") ?? "").split(" ").filter(Boolean),
    oauthQuery: query,
  };
  return c.json(body);
});

/**
 * The account's Connections and the endpoint that creates them. The endpoint
 * comes from the API's own environment, not from the browser's origin: in dev
 * the SPA is on one port and the API on another, and `window.location` would
 * name a URL that answers the app shell.
 *
 * One row per client — the consent table has no unique index, so
 * `newestPerClient` collapses a duplicate to the row the guard touched last.
 * It reads only this account's rows; another account's approvals never appear.
 */
connectionRoutes.get("/connections", requireSession, async (c) => {
  const user = c.get("user");
  const rows = await db
    .select({
      id: oauthConsentTable.id,
      clientId: oauthConsentTable.clientId,
      clientName: oauthClientTable.name,
      createdAt: oauthConsentTable.createdAt,
      updatedAt: oauthConsentTable.updatedAt,
    })
    .from(oauthConsentTable)
    .leftJoin(
      oauthClientTable,
      eq(oauthClientTable.clientId, oauthConsentTable.clientId),
    )
    .where(eq(oauthConsentTable.userId, user.id));

  // The plugin always writes both stamps; a row without one is not a
  // Connection the page can date, so the other stamp is the honest fallback
  // and an all-null row sorts to the epoch rather than crashing the read.
  const epoch = new Date(0);
  const connections = newestPerClient(
    rows.map((row) => ({
      id: row.id,
      clientId: row.clientId,
      // A hand-registered client may have no name; CIMD requires one. The id
      // is the honest fallback — for a CIMD client it is the URL it hosts.
      clientName: row.clientName?.trim() || row.clientId,
      connectedAt: row.createdAt ?? row.updatedAt ?? epoch,
      lastActedAt: row.updatedAt ?? row.createdAt ?? epoch,
    })),
  ).map((row) => ({
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    connectedAt: wireTimestamp(row.connectedAt),
    lastActedAt: wireTimestamp(row.lastActedAt),
  }));

  // Parsed on the way out, so a serializer↔schema drift fails here rather
  // than as a half-rendered list in the browser.
  return c.json(
    connectionsReadSchema.parse({ endpoint: mcpResource, connections }),
  );
});

/**
 * Revoke one Connection. The consent row names the client, and the pair
 * (account, client) is the unit Revoke acts on: every consent row for it goes,
 * because the plugin's find-then-create can leave duplicates, and every live
 * refresh token for it is stamped revoked so the client cannot mint another
 * access token. The access token already out lives to its expiry, but the MCP
 * guard reads the consent row first, so the client's next call is a 401.
 *
 * The session is untouched: the browser and the agent are two credentials, and
 * ending one never ends the other.
 */
connectionRoutes.delete(
  "/connections/:connectionId",
  requireSession,
  async (c) => {
    const user = c.get("user");
    const connectionId = param(c, "connectionId");

    // Scoped by the session's user, so another account's id is indistinguishable
    // from one that does not exist.
    const [consent] = await db
      .select({ clientId: oauthConsentTable.clientId })
      .from(oauthConsentTable)
      .where(
        and(
          eq(oauthConsentTable.id, connectionId),
          eq(oauthConsentTable.userId, user.id),
        ),
      )
      .limit(1);
    if (!consent) {
      throw new ApiError("not-found", "This connection does not exist.");
    }

    const revokedAt = new Date();
    await db.transaction(async (tx) => {
      await tx
        .delete(oauthConsentTable)
        .where(
          and(
            eq(oauthConsentTable.userId, user.id),
            eq(oauthConsentTable.clientId, consent.clientId),
          ),
        );
      await tx
        .update(oauthRefreshTokenTable)
        .set({ revoked: revokedAt })
        .where(
          and(
            eq(oauthRefreshTokenTable.userId, user.id),
            eq(oauthRefreshTokenTable.clientId, consent.clientId),
            isNull(oauthRefreshTokenTable.revoked),
          ),
        );
    });

    return c.body(null, 204);
  },
);
