// Canonical-host redirect: a deployment's configured origin (CLIENT_ORIGIN)
// has exactly one alias — `www.<its host>` — and every alias request is
// 308-redirected to the origin before any route runs. Driven in-process with
// app.request() against the real app, and asserted against the configured
// origin rather than a literal, so a hostname hardcoded in the middleware
// fails here.

import { app } from "../src/app";
import { clientOrigin } from "../src/env";
import { describe, expect, it } from "vitest";

const origin = new URL(clientOrigin);
const aliasHost = `www.${origin.hostname}`;

describe("the configured origin's www alias", () => {
  it("308-redirects to the origin, preserving path, query and method", async () => {
    // POST on purpose: a 308 re-issues the same method, where a 301/302
    // would let a client downgrade the body to a GET.
    const res = await app.request("/collections/flores-solares?a=1&b=2", {
      method: "POST",
      headers: { Host: aliasHost },
    });
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(
      `${clientOrigin}/collections/flores-solares?a=1&b=2`,
    );
  });

  it("redirects the SPA shell at /", async () => {
    const res = await app.request("/", { headers: { Host: aliasHost } });
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`${clientOrigin}/`);
  });

  it("treats the alias host's port as irrelevant", async () => {
    const res = await app.request("/", {
      headers: { Host: `${aliasHost}:443` },
    });
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`${clientOrigin}/`);
  });
});

describe("a host that is not the alias", () => {
  it("leaves the origin's own host alone — a real request passes through", async () => {
    const res = await app.request("/api/health", {
      headers: { Host: origin.host },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("leaves another www host alone — it is not this origin's alias", async () => {
    // The proof the middleware consults the configured origin: a rule that
    // named a literal hostname would redirect www.arcula.art here, but the
    // configured origin is CLIENT_ORIGIN.
    const res = await app.request("/", {
      headers: { Host: "www.arcula.art" },
    });
    expect(res.headers.get("location")).toBeNull();
  });
});
