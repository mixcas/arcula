// The Hono app (plan §9.4: `Bun.serve({ port, fetch: app.fetch })` in
// main.ts).
//
// Exported as a value, not a server, so the API test suite drives the
// real handler in-process with `app.request()` — real routes, real
// middleware, real DB and mail underneath; no second server process
// (§11, G8; decision recorded in §15).

import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import { corsOrigins } from "./env";

export const app = new Hono();

// Locally the web client is a different origin (Vite on 3000, the api on
// 8000); the same-origin prod deployment needs no CORS. `credentials`
// keeps the session cookie flowing cross-origin in dev.
app.use("/api/*", cors({ origin: corsOrigins, credentials: true }));

// Liveness (§7). Unversioned on purpose — it is not a resource.
app.get("/api/health", (c) => c.json({ status: "ok" }));

// /api/auth/* — Better Auth, native (§5). The handler produces Better
// Auth's own response shape, which is what @better-auth/react consumes;
// the §7 error envelope applies to /api/v1/* only (decision, §15).
app.route(
  "/api/auth",
  new Hono().all("*", (c) => auth.handler(c.req.raw)),
);
