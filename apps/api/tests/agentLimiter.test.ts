// The per-account write limiter's policy, with a fake clock: where a write's
// second starts, where an import's hour starts, and which rows a rolling
// twenty-second window still sums.
//
// The counting itself lives in `agentLimiter.ts` over the real table; the
// integration half — a refused write, a second account unaffected — is
// `mcpCatalogueWrite.test.ts`'s, and the import window's is below. What is
// tested here is the arithmetic, because "at most twenty writes in any rolling
// twenty seconds" is a claim about dates, and dates are the one part a fake
// clock can pin exactly.

import { afterAll, describe, expect, it } from "vitest";
import {
  AGENT_IMPORT_CAPACITY,
  agentImportWindowStart,
  agentWriteWindowBoundary,
  agentWriteWindowHolds,
  agentWriteWindowStart,
  claimAgentImport,
} from "../src/agentLimiter";
import { closeDb } from "../src/db";
import { uuid } from "./helpers/api";

describe("the write window's arithmetic", () => {
  it("floors a write to the whole second its row names", () => {
    // 12:00:00.750 belongs to the row at 12:00:00.000: a rolling window sums
    // one row per second, so the row's start has to be the second's.
    expect(agentWriteWindowStart(new Date("2026-01-01T12:00:00.750Z"))).toEqual(
      new Date("2026-01-01T12:00:00.000Z"),
    );
    const boundary = new Date("2026-01-01T12:00:01.000Z");
    expect(agentWriteWindowStart(boundary)).toEqual(boundary);
  });

  it("keeps exactly the twenty rows a rolling twenty-second window holds", () => {
    const now = new Date("2026-01-01T12:00:20.000Z");
    // The window is the rows whose second starts strictly after now - 20s:
    // 12:00:00 excluded, 12:00:01 through 12:00:20 included.
    expect(agentWriteWindowBoundary(now)).toEqual(
      new Date("2026-01-01T12:00:00.000Z"),
    );
    expect(
      agentWriteWindowHolds(new Date("2026-01-01T12:00:00.000Z"), now),
    ).toBe(false);
    expect(
      agentWriteWindowHolds(new Date("2026-01-01T12:00:00.001Z"), now),
    ).toBe(true);
    expect(
      agentWriteWindowHolds(new Date("2026-01-01T12:00:19.999Z"), now),
    ).toBe(true);
    expect(
      agentWriteWindowHolds(new Date("2026-01-01T12:00:20.000Z"), now),
    ).toBe(true);
  });

  it("is rolling, not fixed: the same row falls out a second later", () => {
    const row = new Date("2026-01-01T12:00:00.000Z");
    expect(
      agentWriteWindowHolds(row, new Date("2026-01-01T12:00:19.999Z")),
    ).toBe(true);
    expect(
      agentWriteWindowHolds(row, new Date("2026-01-01T12:00:20.000Z")),
    ).toBe(false);
  });
});

describe("the import window's arithmetic", () => {
  it("floors an import to the start of its UTC hour", () => {
    // Fixed, like the unlock throttle's window: one row per account and hour,
    // and the row is the whole state.
    expect(
      agentImportWindowStart(new Date("2026-01-01T12:59:59.999Z")),
    ).toEqual(new Date("2026-01-01T12:00:00.000Z"));
    expect(
      agentImportWindowStart(new Date("2026-01-01T13:00:00.000Z")),
    ).toEqual(new Date("2026-01-01T13:00:00.000Z"));
  });
});

describe("the import window", () => {
  const noon = new Date("2026-01-01T12:30:00.000Z");

  it("allows five imports in an hour and refuses the sixth, naming it", async () => {
    const userId = uuid();
    for (let i = 0; i < AGENT_IMPORT_CAPACITY; i += 1) {
      await claimAgentImport(userId, noon);
    }
    // The refusal carries the allowance and the window the import tool will
    // relay; five an hour is the spec's number.
    await expect(claimAgentImport(userId, noon)).rejects.toMatchObject({
      code: "rate-limited",
      details: { allowance: 5, windowSeconds: 3600 },
    });
  });

  it("opens a fresh allowance in the next hour", async () => {
    const userId = uuid();
    for (let i = 0; i < AGENT_IMPORT_CAPACITY; i += 1) {
      await claimAgentImport(userId, noon);
    }
    await expect(claimAgentImport(userId, noon)).rejects.toMatchObject({
      code: "rate-limited",
    });
    // One second after the hour turns, the fixed window is a new row.
    await expect(
      claimAgentImport(userId, new Date("2026-01-01T13:00:00.000Z")),
    ).resolves.toBeUndefined();
  });
});

afterAll(async () => {
  await closeDb();
});
