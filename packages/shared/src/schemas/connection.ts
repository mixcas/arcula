import { z } from "zod";
import { wireTimestamp } from "./document";

/**
 * The Connection wire contract: the consent screen's request, and the account
 * surface's list.
 *
 * A remote MCP client starts an OAuth authorization; the plugin redirects the
 * browser to the app's `/consent` with the whole signed query. The SPA cannot
 * verify that signature — only the server can — so it asks
 * `/api/v1/connections/request` for the verified reading: the client's name,
 * the links it claims (only `https:` ones), the redirect host the code will go
 * to, and the exact `oauth_query` string to post back.
 *
 * The client's name and links are attacker-chosen — whoever controls the
 * client ID metadata document chose them — which is why the redirect host is
 * rendered beside them and why a non-`https:` link is dropped rather than
 * rendered.
 */
export const connectionRequestSchema = z.object({
  client: z.object({
    name: z.string(),
    /** Only ever an `https:` URL; the API drops anything else. */
    uri: z.string().optional(),
    logo: z.string().optional(),
    tos: z.string().optional(),
    policy: z.string().optional(),
  }),
  /** The signed `redirect_uri`'s host — the one fact about where the code goes
   *  that the person can compare with the client they think they are adding. */
  redirectHost: z.string(),
  /** The scopes the client asked for, as the signed query names them. */
  scopes: z.array(z.string()),
  /** The signed query, verified and ready to post to `/api/auth/oauth2/consent`. */
  oauthQuery: z.string(),
});

export type ConnectionRequestRead = z.infer<typeof connectionRequestSchema>;

/** The provider's answer to a consent decision: both Accept and Deny send the
 *  browser to the client's redirect URI (the code, or `error=access_denied`). */
export const connectionConsentResultSchema = z.object({
  redirect: z.boolean(),
  url: z.string(),
});

export type ConnectionConsentResult = z.infer<
  typeof connectionConsentResultSchema
>;

/**
 * One Connection, as "Connected apps" lists it. A Connection is the account's
 * approval of one client — the consent row the MCP guard reads on every call —
 * so its `id` is what Revoke names, and deleting it ends that client's access
 * to this account.
 *
 * `clientName` is the client's own claim when it made one; an unnamed client is
 * named by its `clientId`, which for a CIMD client is the URL it hosts. The
 * times are the API's wire timestamp shape (like the catalogue and artwork
 * documents), because the page renders them through `relativeTime`.
 */
export const connectionReadSchema = z.object({
  /** The consent row this Connection is; the id Revoke names. */
  id: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  /** When the person approved the client (the consent row's `createdAt`). */
  connectedAt: wireTimestamp,
  /** When the agent last acted (the guard's touch, at most a minute stale). */
  lastActedAt: wireTimestamp,
});

export type ConnectionRead = z.infer<typeof connectionReadSchema>;

/**
 * GET /api/v1/connections: the account surface's whole block. The endpoint is
 * the API's own resource URL, never the client's guess from `window.location`
 * (in dev the SPA and the API are different ports); the list is most recently
 * acted first and holds one row per client.
 */
export const connectionsReadSchema = z.object({
  endpoint: z.string(),
  connections: z.array(connectionReadSchema),
});

export type ConnectionsRead = z.infer<typeof connectionsReadSchema>;
