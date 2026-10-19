// /api/health when a deployment configured a commit: the body carries it, so
// "is my change live?" is one request rather than a guess. The no-commit body
// — the local and production case — is pinned in spa.api.test.ts.
//
// `deployedCommit` is read once at import (env.ts), so this file sets it
// before the app's module graph is loaded. Both source imports are dynamic for
// that reason: a static import of anything reaching env.ts would evaluate it
// first and freeze the commit at "". A fresh module graph per test file keeps
// the value from reaching the other suites, and the cleanup below keeps it
// from reaching a file this worker runs next.

import { afterAll, describe, expect, it } from "vitest";

process.env.DEPLOYED_COMMIT = "commit-under-test";

const { app } = await import("../src/app");
const { closeDb } = await import("../src/db");

afterAll(async () => {
  delete process.env.DEPLOYED_COMMIT;
  await closeDb();
});

describe("health with a configured commit", () => {
  it("carries the deployed commit beside status", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      commit: "commit-under-test",
    });
  });
});
