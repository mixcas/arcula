/**
 * Static SPA serving: the same process that serves
 * /api/v1 and /api/auth also serves the built app, so a deploy is one
 * artifact behind one origin — no second hosting stack in beta.
 *
 * Path logic, in order:
 *  1. /api (and everything under it) is never the SPA's — the guard below
 *     keeps that true even if a future route refactor reorders the mounts.
 *  2. A file that exists in the dist tree is served, containment-checked:
 *     the resolved path must stay inside the dist root, so a traversal
 *     path is a 404, never a read and never the app shell.
 *  3. Anything else is a client route (/collection/x, /manage/profile, a
 *     pasted /reset-password/<token>): serve index.html and let the
 *     router decide. A mistyped URL gets the shell too — the in-app
 *     404 is the SPA's to show, not this layer's.
 *
 * With no dist tree at all (a dev checkout before the first build) the
 * middleware is inert and hands the request back to Hono's 404 — Vite
 * remains the SPA origin in dev, and there is no env-var branching.
 *
 * The cache headers are the load-bearing part of a single-origin deploy:
 * index.html must never be cached (a new deploy ships new hashed asset
 * names, and a stale shell 404s on assets that no longer exist), hashed
 * assets are immutable, everything else is short-lived.
 *
 * Runtime-agnostic on purpose: node:fs/path/url only, so the same file
 * runs under Bun (local dev, `bun run start`) and Node (the Lambda
 * package). `WEB_DIST` is the one knob: the container and
 * the Lambda set it explicitly; the default is the repo layout (this
 * file lives in apps/api/src, the dist in apps/web/dist).
 */
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context, Next } from "hono";

const DEFAULT_DIST = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../web/dist",
);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

function distRoot(): string {
  return process.env.WEB_DIST || DEFAULT_DIST;
}

function cacheControl(path: string): string {
  // Only the hashed build output may be cached indefinitely. index.html
  // is the one file whose staleness breaks the whole app after a deploy,
  // so it (and every shell fallback) is never cached.
  if (path === "/index.html") return "no-cache";
  if (path.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=3600";
}

export const spaMiddleware = async (c: Context, next: Next) => {
  const path = c.req.path;

  // The API is never the SPA, regardless of mount order above.
  if (path === "/api" || path.startsWith("/api/")) {
    await next();
    return;
  }

  const root = distRoot();

  // A normalized relative path that starts outside the root is a bad
  // path, not a route: 404. (Percent-encoded forms arrive with the
  // encoding intact, so `..` here also catches `..%2f…`.)
  const rel = normalize(path).replace(/^[\\/]+/, "");
  if (rel === ".." || rel.startsWith("..")) {
    return c.notFound();
  }

  if (rel !== "") {
    const file = resolve(root, rel);
    // The containment check is what makes the refusal total: anything
    // that resolved outside the root is never read.
    if (file.startsWith(root + sep)) {
      try {
        const data = await readFile(file); // directories throw EISDIR → fall through
        const type =
          CONTENT_TYPES[extname(file).toLowerCase()] ??
          "application/octet-stream";
        return c.body(new Uint8Array(data), 200, {
          "Content-Type": type,
          "Cache-Control": cacheControl(path),
        });
      } catch {
        // Not a servable file — fall to the client-route case below.
      }
    }
  }

  // A client route (or "/"): the app shell, never cached.
  try {
    const index = await readFile(join(root, "index.html"));
    return c.body(new Uint8Array(index), 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
  } catch {
    // No dist tree (dev before the first build): stay inert and let
    // Hono answer 404 the way it always has.
    await next();
  }
};
