// The Better Auth React client (plan §5: "the client keeps the useAuth()
// contract"). Two 1.7.7 deltas against the plan's wording, recorded in
// §15: the client is the `better-auth/react` subpath of the same package
// the API runs (so the web app depends on `better-auth` at the API's
// version, and there is no `@better-auth/react` package to pin), and it is
// nanostores-based — `@tanstack/react-query` turned out to be unnecessary.
//
// Locally the API is a different origin (Vite on :3000, Hono on :8000), so
// fetches must carry the session cookie cross-origin. In prod the base is
// the §10.3 host (https://api.arcula.art), supplied as VITE_API_BASE_URL.
import { createAuthClient } from "better-auth/react";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export const authClient = createAuthClient({
  baseURL: apiBase,
  basePath: "/api/auth",
  fetchOptions: {
    credentials: "include",
  },
});
