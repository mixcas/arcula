// The Hono app (`Bun.serve({ port, fetch: app.fetch })` in main.ts).
//
// Exported as a value, not a server, so the API test suite drives the
// real handler in-process with `app.request()` — real routes, real
// middleware, real DB and mail underneath; no second server process.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import {
  canonicalRedirect,
  healthBody,
  noindexEnabled,
} from "./responsePolicy";
import { errorResponse } from "./errors";
import { clientOrigin, corsOrigins, deployedCommit, noindexFlag } from "./env";
import { accessRoutes } from "./routes/access";
import { artworkMediaRoutes } from "./routes/artworkMedia";
import { artworkRoutes } from "./routes/artworks";
import { collectionRoutes } from "./routes/collections";
import { invitationRoutes } from "./routes/invitations";
import { meRoutes } from "./routes/me";
import { mediaRoutes } from "./routes/media";
import { spaMiddleware } from "./spa";

export const app = new Hono();

// One envelope for everything we throw. Better Auth's responses
// never reach here — its handler already produced a Response, and Hono
// only forwards thrown errors.
app.onError((err, c) => {
  const { body, status } = errorResponse(err);
  return c.json(body, status);
});

// The configured origin's `www` alias is canonicalised to the origin
// before anything else runs — one canonical host, www never serves the SPA
// or the API directly. The origin is `CLIENT_ORIGIN`, so no environment's
// hostname is written into the source; on production the derived value is
// the same host this middleware always redirected to. `x-forwarded-host` is
// what API Gateway sets over TLS; fall back to the plain host header. 308
// preserves the method + body, so a POST to www/api/v1/… lands as a POST at
// the origin. Registered first so it short-circuits every route.
app.use("*", async (c, next) => {
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "";
  const target = canonicalRedirect(host, clientOrigin, c.req.url);
  if (target) return c.redirect(target, 308);
  await next();
});

// Locally the web client is a different origin (Vite on 3000, the api on
// 8000); the same-origin prod deployment needs no CORS. `credentials`
// keeps the session cookie flowing cross-origin in dev.
app.use("/api/*", cors({ origin: corsOrigins, credentials: true }));

// Liveness. Unversioned on purpose — it is not a resource. The body carries
// the deployed commit only when the environment configured one.
app.get("/api/health", (c) => c.json(healthBody(deployedCommit)));

// /api/auth/* — Better Auth, native. The handler produces Better Auth's
// own response shape, which is what @better-auth/react consumes; the
// error envelope applies to /api/v1/* only.
app.route(
  "/api/auth",
  new Hono().all("*", (c) => auth.handler(c.req.raw)),
);

// /api/v1/* — the resource API. Each route module mounts at /api/v1
// under its own paths.
app.route("/api/v1", meRoutes);
app.route("/api/v1", mediaRoutes);
app.route("/api/v1", collectionRoutes);
app.route("/api/v1", accessRoutes);
app.route("/api/v1", invitationRoutes);
app.route("/api/v1", artworkMediaRoutes);
app.route("/api/v1", artworkRoutes);

// Dev-only indexing guard, after every API mount so it wraps only the SPA.
// When the flag is set, `/robots.txt` answers a disallow-all document rather
// than the app shell, and every other SPA response carries `X-Robots-Tag:
// noindex`. With the flag unset — local and production — both paths are
// exactly what they are without this middleware.
app.use("*", async (c, next) => {
  if (!noindexEnabled(noindexFlag)) return next();
  if (c.req.path === "/robots.txt") {
    return c.text("User-agent: *\nDisallow: /\n");
  }
  await next();
  if (!c.req.path.startsWith("/api")) {
    c.res.headers.set("X-Robots-Tag", "noindex");
  }
});

// The built SPA, after every API mount: a request the API
// already answered never reaches here, and the middleware guards /api
// itself, so this stays correct even if a route above moves.
app.use("*", spaMiddleware);
