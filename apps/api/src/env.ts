// Parsed environment shared by the app and the auth instance.
//
// The root .env is the single source; scripts source it before
// running. Values here are read once at import time.

import { configuredReplyTo } from "./email/compose/text";

// The browser origins the API admits cross-origin requests from (the
// web client, locally Vite on 3000). The same set doubles as
// Better Auth's trustedOrigins: a cookie-based state-changing request
// is only CSRF-legitimate from an origin we already allow.
export const corsOrigins: string[] = (
  process.env.CORS_ORIGINS ?? "http://localhost:3000"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// The web app's origin — where the links in the reset/verification mails
// have to land. Locally the Vite dev server; in prod the same host
// the static hosting serves from. A trailing slash is dropped: links are
// built as `${clientOrigin}${pathname}`. It is also the canonical host the
// www redirect derives from (environment.ts), so no hostname lives in the
// source.
export const clientOrigin = (process.env.CLIENT_ORIGIN ?? "")
  .trim()
  .replace(/\/$/, "");

// Whether a reply to a mail reaches a person: EMAIL_REPLY_TO is the monitored
// inbox the invitation footer offers. Empty is a supported configuration (dev
// has no such inbox), and the copy follows it rather than promising a path that
// does not exist. The rule itself is shared with the provider, which is what
// actually decides whether a Reply-To header is sent.
export const replyToConfigured =
  configuredReplyTo(process.env.EMAIL_REPLY_TO) !== null;

// The commit this deployment was built from, when one is configured. The
// dev environment sets it so `/api/health` answers "is my change live?" in
// one request; production leaves it unset and the health body carries no
// key at all.
export const deployedCommit = (process.env.DEPLOYED_COMMIT ?? "").trim();

// The checkout whose code this process runs, set by the local scripts that
// start it (`scripts/ensure-api.sh`, apps/api's `dev`). Locally several
// worktrees can share one port, so `/api/health` names its checkout and the
// caller refuses a stranger. The Lambda never sets it, so production's body
// carries no key at all.
export const checkout = (process.env.ARCULA_CHECKOUT ?? "").trim();

// Dev-only: keep this environment out of search indexes. Unset everywhere
// else, where both the header and the robots path behave exactly as they
// always have.
export const noindexFlag = process.env.NOINDEX;

// Whether cookies the API sets are marked `Secure`. The session cookie's rule
// and the Access grant's are the same one, kept here rather than written twice:
// production is https, where a `Secure` cookie is the safe default; local dev
// is plain http, where a browser rejects it.
export const useSecureCookies = process.env.NODE_ENV === "production";

// The API's own origin, derived from AUTH_BASE_URL: in production the CDK
// hands the Lambda `PUBLIC_URL` as AUTH_BASE_URL (no path), while a local
// `.env` may write the full Better Auth base (`http://localhost:8000/api/auth`).
// `URL.origin` is the one reading that is right for both: it drops the path
// whether or not one is present, which is what makes the MCP resource
// (`/api/mcp`) sit beside the auth mount rather than under it. The local
// default is the port the README's dev API already uses.
const apiOrigin = new URL(process.env.AUTH_BASE_URL ?? "http://localhost:8000")
  .origin;

// The MCP endpoint's URL, which is also every access token's audience (RFC
// 8707). One value, so the plugin's `resource`, the guard's expected audience
// and the challenge's `resource_metadata` cannot disagree.
export const mcpResource = `${apiOrigin}/api/mcp`;

// Whether a session token is accepted in an `Authorization: Bearer` header —
// the bearer plugin's gate. It is a second, undeclared way to act as an
// account: nothing in the app shows it, and only signing out of the website
// revokes it. A deployment does not have it; the named replacement is the
// Connection surface (ADR-0013), so the undeclared one closes.
//
// The rule is `NODE_ENV`, stated rather than inferred. It is the fact the
// deploy already owns — the stack sets it (infra/cdk/src/arcula-stack.ts) and
// the bundle inlines it (scripts/build-lambda.sh), which is what the Secure
// cookie rule above rides on — and it says "this process is a deployment"
// instead of guessing from a URL: a laptop pointed at a remote AUTH_BASE_URL,
// or an environment whose PUBLIC_URL happens to look production-shaped, is
// still a laptop, and comparing origins would silently decide that for us.
// Only the literal `production` closes the gate; everything else (development,
// test, unset) keeps the credential the local scripts and suites authenticate
// with today. Pure so the rule has a test of its own, not just a deployed end
// to end pass.
export const bearerAuthAllowed = (nodeEnv: string | undefined): boolean =>
  nodeEnv !== "production";

// The parsed rule, the one auth.ts mounts the plugin from.
export const sessionBearerEnabled = bearerAuthAllowed(process.env.NODE_ENV);
