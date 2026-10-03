// Parsed environment shared by the app and the auth instance.
//
// The root .env is the single source (§9); scripts source it before
// running. Values here are read once at import time.

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
