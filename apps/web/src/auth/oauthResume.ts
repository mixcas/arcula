// The login page's OAuth resume.
//
// When an MCP client's authorization starts and the browser has no session,
// the provider redirects it to `loginPage` with the whole authorize query
// re-signed — `sig` and the names in `ba_param` are the signature's own
// envelope, and `exp` bounds it. That query is the login page's entire
// querystring, so the page has to carry it through the sign-in rather than
// treat it as decoration: dropping it strands the person on the dashboard with
// the client still waiting.
//
// Nothing here trusts the query — the consent screen verifies it server-side.
// This module only decides where a successful sign-in goes.

/** Whether this page's querystring is a signed authorize hand-off. */
export const isOAuthResume = (search: string): boolean =>
  new URLSearchParams(search).has("sig");

/**
 * Where a successful sign-in lands, in order:
 *
 *  1. the consent screen with the signed query intact, when the login page was
 *     reached from an OAuth authorize redirect;
 *  2. the page that bounced the visitor here (router state, from the guard);
 *  3. the dashboard.
 *
 * A pathname carrying a query string is allowed: `returnPathFrom` only refuses
 * an absolute URL or a protocol-relative path.
 */
export const loginReturnPath = (
  search: string,
  from: string | undefined,
): string =>
  isOAuthResume(search) ? `/consent${search}` : (from ?? "/manage");
