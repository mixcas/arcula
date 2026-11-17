// The connection service: the consent screen's two calls and the account
// surface's Connected apps.
//
// The first reads the provider's signed authorize query back through the API,
// which is the only side that can verify its signature. The second posts the
// decision to the provider's own endpoint. The third and fourth are the
// account profile: the Connections list (with the MCP endpoint) and Revoke.
//
// Every response is parsed through the shared schema at this boundary, so an
// API reshape is a loud parse error rather than a half-rendered approval
// screen or a list with a row missing a timestamp.

import {
  connectionConsentResultSchema,
  connectionRequestSchema,
  connectionsReadSchema,
  type ConnectionConsentResult,
  type ConnectionRequestRead,
  type ConnectionsRead,
} from "@arcula/shared";
import { apiRequest } from "./api";

const CONSENT_PATH = "/api/auth/oauth2/consent";
const CONNECTIONS_PATH = "/api/v1/connections";

export const connectionService = {
  /** The verified reading of `/consent`'s own querystring. */
  async getRequest(search: string): Promise<ConnectionRequestRead> {
    return connectionRequestSchema.parse(
      await apiRequest<unknown>(`${CONNECTIONS_PATH}/request${search}`),
    );
  },

  /** Accept or deny; the provider answers where the browser goes next (the
   *  client's redirect URI, with the code or with `access_denied`). */
  async decide(
    oauthQuery: string,
    accept: boolean,
  ): Promise<ConnectionConsentResult> {
    return connectionConsentResultSchema.parse(
      await apiRequest<unknown>(CONSENT_PATH, {
        method: "POST",
        body: { accept, oauth_query: oauthQuery },
      }),
    );
  },

  /** The account's Connections and the endpoint that creates them. */
  async list(): Promise<ConnectionsRead> {
    return connectionsReadSchema.parse(
      await apiRequest<unknown>(CONNECTIONS_PATH),
    );
  },

  /** End one Connection. The session and every other Connection stay. */
  async revoke(connectionId: string): Promise<void> {
    await apiRequest<void>(
      `${CONNECTIONS_PATH}/${encodeURIComponent(connectionId)}`,
      { method: "DELETE" },
    );
  },
};
