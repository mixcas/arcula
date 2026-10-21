// Where a mail's links point: the web app, never the API. A reset form, an
// invite page and a manage page are SPA routes, so a link on the API origin
// would land on JSON.
//
// Kept apart from the provider (which imports it) and from the composer
// (which imports it) so neither has to import the other: composing a message
// never builds a provider, and a provider never composes copy.

import { clientOrigin } from "../env";

// Better Auth's hook URLs point at the API origin; the links in the mails
// have to land on the web app that renders the reset/verification forms,
// so the origin is rewritten to CLIENT_ORIGIN — path and query stay.
export function clientUrl(apiUrl: string): string {
  // url.origin is not assignable in every runtime (Bun's is a read-only
  // accessor), so rebuild from the parts instead.
  const url = new URL(apiUrl);
  return clientLink(`${url.pathname}${url.search}${url.hash}`);
}

/** An absolute link on the web app's origin — the mails point at the SPA, not
 *  at the API. A missing origin is a config error, not a relative link nobody
 *  can open. */
export function clientLink(path: string): string {
  if (!clientOrigin) {
    throw new Error(
      "CLIENT_ORIGIN is not set; a mail link cannot point at the web app.",
    );
  }
  return `${clientOrigin}${path.startsWith("/") ? path : `/${path}`}`;
}
