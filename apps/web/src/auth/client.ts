// The Better Auth React client, built to keep the useAuth() contract. It is
// the `better-auth/react` subpath of the same package the API runs (so the
// web app depends on `better-auth` at the API's version, and there is no
// `@better-auth/react` package to pin), and it is nanostores-based —
// `@tanstack/react-query` is unnecessary.
//
// The client is deliberately created **without a baseURL**. When no base is
// given, `getBaseURL` (better-auth/dist/utils/url.mjs) falls back to
// `window.location.origin` in the browser — i.e. every fetch is relative to
// the page's own origin, with `/api/auth` appended:
//
// - dev: the page is served by Vite on :3000, which proxies `/api` to the
//   API on :8000 (vite.config.ts). Cookies, Origin and everything else flow
//   same-origin through the proxy.
// - prod: the API task serves the built SPA at `/`, so `/api` is
//   same-origin by construction and no env var is baked into the bundle.
// - tests: the page origin is jsdom's default (`http://localhost:3000`),
//   and tests/helpers/stackFetch.ts emulates the dev proxy.
//
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  fetchOptions: {
    credentials: "include",
  },
});
