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

// Dev-only: keep this environment out of search indexes. Unset everywhere
// else, where both the header and the robots path behave exactly as they
// always have.
export const noindexFlag = process.env.NOINDEX;

// Whether cookies the API sets are marked `Secure`. The session cookie's rule
// and the Access grant's are the same one, kept here rather than written twice:
// production is https, where a `Secure` cookie is the safe default; local dev
// is plain http, where a browser rejects it.
export const useSecureCookies = process.env.NODE_ENV === "production";
