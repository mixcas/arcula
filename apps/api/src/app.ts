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
import { errorResponse } from "./errors";
import { corsOrigins } from "./env";
import { artworkMediaRoutes } from "./routes/artworkMedia";
import { artworkRoutes } from "./routes/artworks";
import { collectionRoutes } from "./routes/collections";
import { meRoutes } from "./routes/me";
import { mediaRoutes } from "./routes/media";

export const app = new Hono();

// One envelope for everything we throw (§7). Better Auth's responses
// never reach here — its handler already produced a Response, and Hono
// only forwards thrown errors.
app.onError((err, c) => {
  const { body, status } = errorResponse(err);
  return c.json(body, status);
});

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

// /api/v1/* — the resource API (§7). Later phases add their route
// modules here, mounted at /api/v1 with their own paths.
app.route("/api/v1", meRoutes);
app.route("/api/v1", mediaRoutes);
app.route("/api/v1", collectionRoutes);
app.route("/api/v1", artworkMediaRoutes);
app.route("/api/v1", artworkRoutes);
