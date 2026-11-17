// The consent screen's service: the two calls an OAuth approval makes.
//
// The first reads the provider's signed authorize query back through the API,
// which is the only side that can verify its signature. The second posts the
// decision to the provider's own endpoint. Both parse their wire shape through
// the shared schema at this boundary, so an API reshape is a loud parse error
// rather than a half-rendered approval screen.

import {
  connectionConsentResultSchema,
  connectionRequestSchema,
  type ConnectionConsentResult,
  type ConnectionRequestRead,
} from "@arcula/shared";
import { apiRequest } from "./api";

const CONSENT_PATH = "/api/auth/oauth2/consent";

export const connectionService = {
  /** The verified reading of `/consent`'s own querystring. */
  async getRequest(search: string): Promise<ConnectionRequestRead> {
    return connectionRequestSchema.parse(
      await apiRequest<unknown>(`/api/v1/connections/request${search}`),
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
};
