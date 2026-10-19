// API integration: static SPA serving — the same
// process that serves /api/v1 and /api/auth serves the built app: file
// hits, the client-route fallback, the traversal refusal, the cache
// header table, and inertness when there is no dist tree.
//
// Driven in-process with app.request() against the real app, exactly as
// the other API suites; the dist tree is a throwaway fixture, so the
// suite is deterministic whether or not a real build exists on disk.

import { closeDb } from "../src/db";
import { app } from "../src/app";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const INDEX = "<html>FIXTURE-INDEX</html>";
const JS = "console.log('fixture');";
const CSS = "body{}";

let distDir: string;

beforeAll(async () => {
  distDir = await mkdtemp(join(tmpdir(), "arcula-spa-"));
  await mkdir(join(distDir, "assets"), { recursive: true });
  await writeFile(join(distDir, "index.html"), INDEX);
  await writeFile(join(distDir, "assets/index-abc.js"), JS);
  await writeFile(join(distDir, "assets/style-def.css"), CSS);
  await writeFile(join(distDir, "assets/blob.bin"), "bin");
  await writeFile(join(distDir, "manifest.json"), '{"name":"fixture"}');
  process.env.WEB_DIST = distDir;
});

afterAll(async () => {
  delete process.env.WEB_DIST;
  await rm(distDir, { recursive: true, force: true });
  await closeDb();
});

describe("the built SPA", () => {
  it("serves the app shell at /, never cached", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(INDEX);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("falls back to the app shell for a client route", async () => {
    const res = await app.request(
      "/collection/flores-solares-cce9e196/artwork/art1",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(INDEX);
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("serves a hashed asset with its bytes, type, and the immutable header", async () => {
    const res = await app.request("/assets/index-abc.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JS);
    expect(res.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("serves a root-level static with the short-lived header", async () => {
    const res = await app.request("/manifest.json");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"name":"fixture"}');
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("answers an unknown extension with octet-stream", async () => {
    const res = await app.request("/assets/blob.bin");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("gives a non-file path to the shell — the in-app 404 is the router's", async () => {
    const res = await app.request("/no-such-page-at-all");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(INDEX);
  });

  it("refuses a traversal path — a 404, never the shell, never a read", async () => {
    // The URL keeps the encoding intact, so this is how an encoded
    // traversal arrives; a literal /../ is normalized away by the URL
    // itself before it could reach this layer.
    const res = await app.request("/..%2f..%2fetc%2fpasswd");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toBe(INDEX);
  });

  it("leaves the API untouched: /api/health answers, /api/unknown is a 404", async () => {
    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    // The SPA fallback must not swallow API misses: a wrong /api path
    // gets the API's 404, not the app shell.
    const unknown = await app.request("/api/v1/definitely-not-a-route");
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).not.toBe(INDEX);
  });
});

describe("with no dist tree", () => {
  it("is inert: / is a plain 404 and the API is unaffected", async () => {
    process.env.WEB_DIST = join(distDir, "does-not-exist");
    try {
      const res = await app.request("/");
      expect(res.status).toBe(404);
      expect(await res.text()).not.toBe(INDEX);

      const health = await app.request("/api/health");
      expect(health.status).toBe(200);
    } finally {
      process.env.WEB_DIST = distDir;
    }
  });
});
