// The signed consent query: which parameters the plugin's signature covers,
// and the one place that asks whether a query is authentic.
//
// The plugin redirects to `consentPage` with the whole authorization query
// re-signed: `sig` is the signature, `ba_param` names each parameter it
// covers, and `exp` bounds its life (`codeExpiresIn`, ten minutes). The
// browser can hand the string back verbatim, but it cannot be trusted to have
// done so — so the server rebuilds the signed subset from the redirect and
// verifies it before the screen renders anything, and the same verified string
// is what the SPA posts to `/oauth2/consent`.

import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";

/**
 * The parameters the signature covers, in the order the redirect carried
 * them. `sig` and the `ba_param` names themselves are always included: the
 * signature covers the list of what it signed.
 *
 * Anything else the browser appended (a tracker's `utm_source`, a stray
 * fragment parameter) is not part of the query and is dropped — posting an
 * unsigned extra would make the provider reject the whole thing.
 */
export const signedConsentQuery = (params: URLSearchParams): string => {
  const signed = new Set(["sig", "ba_param", ...params.getAll("ba_param")]);
  return new URLSearchParams(
    [...params].filter(([key]) => signed.has(key)),
  ).toString();
};

/** Whether the query even claims to be signed. A redirect that carries no
 *  `sig` did not come from the provider's authorize endpoint. */
export const isSignedConsentQuery = (query: string): boolean =>
  new URLSearchParams(query).has("sig");

/** The provider's verdict on a query: authentic and unexpired, or not. Pure
 *  of the auth instance, so the route is the only place that loads its secret. */
export const verifyConsentQuery = (
  query: string,
  secret: string,
): Promise<boolean> => verifyOAuthQueryParams(query, secret);

/**
 * The `https:` link a client claims, or `undefined`. A client chooses its own
 * metadata, so a link is rendered only when it is an https URL — an
 * `http:`/`javascript:`/`data:` one is dropped, never shown as clickable.
 */
export const httpsOnlyLink = (
  value: string | null | undefined,
): string | undefined => {
  if (!value) return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
};
