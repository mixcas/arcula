// The Selection's Access grant: the token algebra the Catalogue already owns,
// under a name of its own.
//
// The hash, the TTL and the cookie path are imported rather than copied. A
// Selection's grant is the same kind of fact as a Catalogue's — an unguessable
// token whose only stored form is its SHA-256, good for twelve hours, carried
// on `/api/v1` so the media proxy can read it — and the one thing that differs
// is the cookie's name. The two prefixes must never collide:
//
//   arcula_grant_{catalogueId}            a Catalogue's
//   arcula_selection_grant_{selectionId}  a Selection's
//
// The cookie's NAME is its scope, exactly as `catalogueGrants.ts` explains: one
// cookie per Selection, and a route reads only the name for the Selection it is
// serving. The path cannot be narrower, because the media proxy is one route for
// every Selection's bytes.

export {
  GRANT_COOKIE_PATH,
  GRANT_TTL_MS,
  hashGrantToken,
  mintGrantToken,
} from "./catalogueGrants";

/** The one cookie a Selection's unlock mints and its routes read. */
export const selectionGrantCookieName = (selectionId: string): string =>
  `arcula_selection_grant_${selectionId}`;
