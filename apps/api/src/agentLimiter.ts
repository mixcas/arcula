// The agent surface's per-account write limiter: the arithmetic, and the two
// claims that spend it.
//
// Keyed by the token's verified subject, never by address: a hosted agent's
// calls arrive from one cloud, so an address bucket would be one bucket for
// every account in the product (ADR-0014).
//
// Reads are never metered. A write spends one token from a rolling window of
// `AGENT_WRITE_CAPACITY` over `AGENT_WRITE_WINDOW_SECONDS` — capacity 20
// refilled at one per second, expressed as the rolling sum of whole-second
// rows, which is the shape `accountWriteWindows` stores. An import additionally
// spends one token from a fixed hourly window; `import_artworks` spends it on
// top of the write the dispatcher has already claimed.
//
// The module owns policy and the claim; the description of each tool is where
// the agent is told what a refusal means.

import { and, eq, lt, lte, sql } from "drizzle-orm";
import { accountWriteWindows as windowsTable } from "@arcula/db";
import { db } from "./db";
import { ApiError } from "./errors";

const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;

/** Writes allowed in any rolling window. */
export const AGENT_WRITE_CAPACITY = 20;

/** The rolling window's length, in seconds. */
const AGENT_WRITE_WINDOW_SECONDS = 20;

/** Imports allowed per account per hour. */
export const AGENT_IMPORT_CAPACITY = 5;

/** The import window's length, in seconds, as the refusal names it. */
const AGENT_IMPORT_WINDOW_SECONDS = HOUR_MS / SECOND_MS;

/**
 * The whole-second row a write at `now` spends.
 *
 * The row's start is the window's meaning — one row per account, bucket and
 * second — so a write at 12:00:00.750 belongs to the row named 12:00:00.
 */
export const agentWriteWindowStart = (now: Date): Date =>
  new Date(Math.floor(now.getTime() / SECOND_MS) * SECOND_MS);

/**
 * The start of the hour an import at `now` spends. Fixed, not rolling: one
 * row names the whole hour, as the unlock throttle's ten-minute window does.
 */
export const agentImportWindowStart = (now: Date): Date =>
  new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);

/**
 * The rolling write window's lower bound: a row whose `windowStart` is
 * strictly later is inside the window that ends at `now`.
 *
 * At `now` = 12:00:20.000 the boundary is 12:00:00.000, so the rows summed are
 * the twenty seconds 12:00:01 through 12:00:20 — exactly "twenty writes in any
 * rolling twenty seconds".
 */
export const agentWriteWindowBoundary = (now: Date): Date =>
  new Date(now.getTime() - AGENT_WRITE_WINDOW_SECONDS * SECOND_MS);

/** Whether a row is inside the window ended by `now`. */
export const agentWriteWindowHolds = (windowStart: Date, now: Date): boolean =>
  windowStart.getTime() > agentWriteWindowBoundary(now).getTime();

/** The refusal both claims answer, with the allowance and the window named in
 *  the words the agent relays. No `Retry-After`: the product's one precedent
 *  (`too-many-attempts`) omits it, and the sentence says enough. */
const rateLimited = (
  allowance: number,
  windowSeconds: number,
  windowLabel: string,
  noun: string,
): ApiError =>
  new ApiError(
    "rate-limited",
    `This account may make ${allowance} ${noun} in ${windowLabel}; try again shortly.`,
    { allowance, windowSeconds },
  );

/**
 * Spend one write for this account, or refuse.
 *
 * The claim is spent before the caller's write, and an over-allowance call
 * still lands in the current second's row — the count is spent before the
 * guarded work, exactly as the unlock throttle's is. Rows older than the
 * window are pruned by the same call, so the table stays bounded at about one
 * row per second of activity.
 */
export async function claimAgentWrite(
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .insert(windowsTable)
    .values({
      userId,
      bucket: "write",
      windowStart: agentWriteWindowStart(now),
      count: 1,
    })
    .onConflictDoUpdate({
      target: [
        windowsTable.userId,
        windowsTable.bucket,
        windowsTable.windowStart,
      ],
      set: { count: sql`${windowsTable.count} + 1` },
    });

  const rows = await db
    .select({
      windowStart: windowsTable.windowStart,
      count: windowsTable.count,
    })
    .from(windowsTable)
    .where(
      and(eq(windowsTable.userId, userId), eq(windowsTable.bucket, "write")),
    );

  // Prune before the verdict: a stale row is outside every future window, and
  // deleting it costs the sum nothing.
  await db
    .delete(windowsTable)
    .where(
      and(
        eq(windowsTable.userId, userId),
        eq(windowsTable.bucket, "write"),
        lte(windowsTable.windowStart, agentWriteWindowBoundary(now)),
      ),
    );

  const spent = rows
    .filter((row) => agentWriteWindowHolds(row.windowStart, now))
    .reduce((total, row) => total + row.count, 0);
  if (spent > AGENT_WRITE_CAPACITY) {
    throw rateLimited(
      AGENT_WRITE_CAPACITY,
      AGENT_WRITE_WINDOW_SECONDS,
      `${AGENT_WRITE_WINDOW_SECONDS} seconds`,
      "writes",
    );
  }
}

/**
 * Spend one import for this account, or refuse: five per account per UTC
 * hour, on top of the write the import also costs.
 *
 * `import_artworks` is the one caller: the dispatcher has already spent the
 * write before the tool runs, and the tool claims this before it writes a row.
 */
export async function claimAgentImport(
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const windowStart = agentImportWindowStart(now);
  const [row] = await db
    .insert(windowsTable)
    .values({ userId, bucket: "import", windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [
        windowsTable.userId,
        windowsTable.bucket,
        windowsTable.windowStart,
      ],
      set: { count: sql`${windowsTable.count} + 1` },
    })
    .returning({ count: windowsTable.count });

  // An earlier hour can never be spent again; keep only the current row.
  await db
    .delete(windowsTable)
    .where(
      and(
        eq(windowsTable.userId, userId),
        eq(windowsTable.bucket, "import"),
        lt(windowsTable.windowStart, windowStart),
      ),
    );

  if ((row?.count ?? 1) > AGENT_IMPORT_CAPACITY) {
    throw rateLimited(
      AGENT_IMPORT_CAPACITY,
      AGENT_IMPORT_WINDOW_SECONDS,
      "an hour",
      "imports",
    );
  }
}
