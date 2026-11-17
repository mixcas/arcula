// The connection (OAuth consent) routes.
//
//   GET /connections/request    the signed authorize query, verified, plus the
//                               client it names — what the consent screen shows
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

import { Hono } from "hono";
import type { ConnectionRequestRead } from "@arcula/shared";
import { auth } from "../auth";
import {
  httpsOnlyLink,
  isSignedConsentQuery,
  signedConsentQuery,
  verifyConsentQuery,
} from "../consentQuery";
import { ApiError } from "../errors";
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
