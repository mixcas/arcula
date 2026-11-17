import { z } from "zod";

/**
 * The consent screen's wire contract.
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
