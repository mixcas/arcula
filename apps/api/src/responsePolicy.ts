// The environment-derived response decisions, as pure functions.
//
// Each reads only its explicit inputs — no `process.env`, no server — so
// the rule can be read and table-tested on its own. `env.ts` is where the
// inputs are read, once, at import; the app's middleware and the health
// route hand them in. With nothing configured (local and production) every
// one of these answers exactly what the app hardcoded before.

/**
 * The host of an http(s) origin, lowercased; `""` when the origin is empty,
 * unparsable, or not http(s). The port is deliberately not part of it: a
 * request's host is compared with its own port stripped, so TLS (443) and a
 * local dev port both match.
 */
function originHost(origin: string): string {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * The canonical-host rule. `www.<the origin's host>` is the origin's alias;
 * a request for it must be 308-redirected (that is the caller's act, and
 * the code that preserves the method) to the origin's own host, keeping the
 * request's path and query. Returns the target URL, or null when the host
 * is already canonical or is not the alias.
 *
 * `origin` is the deployment's configured origin (CLIENT_ORIGIN), so no
 * environment's hostname is named in the source.
 */
export function canonicalRedirect(
  host: string,
  origin: string,
  requestUrl: string,
): string | null {
  const canonical = originHost(origin);
  if (!canonical) return null;
  const bare = host.split(":")[0].toLowerCase();
  if (bare !== `www.${canonical}`) return null;
  const { pathname, search } = new URL(requestUrl);
  return `${origin.replace(/\/$/, "")}${pathname}${search}`;
}

/**
 * The liveness body. The deployed commit is carried only when the
 * deployment configured one, so an environment without it answers exactly
 * `{ "status": "ok" }` — the key absent, not empty.
 */
export function healthBody(commit: string): {
  status: "ok";
  commit?: string;
} {
  return commit ? { status: "ok", commit } : { status: "ok" };
}

/**
 * Whether this deployment asks to be kept out of search indexes. Only the
 * exact string `true` turns it on; anything else (unset, empty, `false`,
 * `1`) leaves the environment untouched.
 */
export function noindexEnabled(flag: string | undefined): boolean {
  return flag === "true";
}
