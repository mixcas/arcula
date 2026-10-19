// Canonical-host redirect: `www.arcula.art` is an alias of
// `arcula.art`, so every www request is 308-redirected to the apex before
// any route runs. Driven in-process with app.request() against the real
// app — real middleware, no second server.

import { app } from "../src/app";
import { describe, expect, it } from "vitest";

const www = { headers: { Host: "www.arcula.art" } };
const wwwPort = { headers: { Host: "www.arcula.art:443" } };

describe("www.arcula.art → apex canonical redirect", () => {
  it("308-redirects a www path, host swapped to the apex", async () => {
    const res = await app.request("/collections/flores-solares", www);
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(
      "https://arcula.art/collections/flores-solares",
    );
  });

  it("redirects the SPA shell at / on www", async () => {
    const res = await app.request("/", www);
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://arcula.art/");
  });

  it("preserves the query string and drops the host port", async () => {
    const res = await app.request("/api/v1/collections?x=1&y=2", wwwPort);
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(
      "https://arcula.art/api/v1/collections?x=1&y=2",
    );
  });

  it("does not touch the apex host — a real request passes through", async () => {
    // Known-good route under the canonical host, default (localhost) host.
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("ignores a differently- www host (only www.arcula.art redirects)", async () => {
    // www elsewhere on the domain is not our alias; it must not be
    // redirected by this rule.
    const res = await app.request("/", {
      headers: { Host: "www.other-art.example" },
    });
    expect(res.headers.get("location")).toBeNull();
  });
});
