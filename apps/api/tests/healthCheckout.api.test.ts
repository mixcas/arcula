// /api/health when the process was started from a working tree: the body
// names that checkout, so a caller holding one port can tell this checkout's
// API from another worktree's. The no-checkout body — production, and a
// hand-started API — stays exactly `{ "status": "ok" }`, pinned in
// spa.api.test.ts.
//
// `checkout` is read once at import (env.ts), so this file sets it before the
// app's module graph is loaded; the imports are dynamic for that reason, and
// the cleanup keeps the value from reaching a file this worker runs next.

import { afterAll, describe, expect, it } from "vitest";

process.env.ARCULA_CHECKOUT = "/src/arcula-worktree";

const { app } = await import("../src/app");
const { closeDb } = await import("../src/db");

afterAll(async () => {
  delete process.env.ARCULA_CHECKOUT;
  await closeDb();
});

describe("health from a working tree", () => {
  it("names the checkout beside status", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      checkout: "/src/arcula-worktree",
    });
  });
});
