// The Connected-apps read model's two rules, both ours: one row per client
// (the consent table has no unique index, so the plugin's find-then-create can
// leave duplicates), and most recently acted first.
//
// The route's query cannot express the collapse — the plugin declares no
// unique key to group on — so the rule lives here and a duplicate row on the
// wire is the failure this test exists to prevent.

import { describe, expect, it } from "vitest";
import { newestPerClient } from "../src/connectionList";

const row = (id: string, clientId: string, lastActedAt: string) => ({
  id,
  clientId,
  lastActedAt: new Date(lastActedAt),
});

describe("newestPerClient", () => {
  it("keeps every client and orders them by when they last acted", () => {
    const rows = [
      row("beta-row", "beta", "2026-11-01T09:00:00.000Z"),
      row("alpha-row", "alpha", "2026-11-01T10:00:00.000Z"),
    ];

    expect(newestPerClient(rows).map((r) => r.clientId)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("collapses duplicate consent rows for one client to the newest", () => {
    const rows = [
      row("old", "alpha", "2026-11-01T09:00:00.000Z"),
      row("new", "alpha", "2026-11-01T11:00:00.000Z"),
      row("beta", "beta", "2026-11-01T10:00:00.000Z"),
    ];

    expect(newestPerClient(rows).map((r) => r.id)).toEqual(["new", "beta"]);
  });

  it("breaks a tie by client id, so the order does not depend on the query", () => {
    const rows = [
      row("zeta", "zeta", "2026-11-01T10:00:00.000Z"),
      row("alpha", "alpha", "2026-11-01T10:00:00.000Z"),
    ];

    expect(newestPerClient(rows).map((r) => r.clientId)).toEqual([
      "alpha",
      "zeta",
    ]);
  });
});
