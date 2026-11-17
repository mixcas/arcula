// The Connected-apps read model.
//
// A Connection is the consent row the MCP guard reads on every call — one per
// (account, client) in the plugin's design, but the table declares no unique
// index and the plugin finds then creates, so two approvals racing can leave
// two rows for one client. Revoke deletes every row for the pair; the list
// therefore shows one row per client too, or a second Revoke would name a row
// the guard no longer admits anything for.
//
// The route reads the rows and this collapses them; keeping it pure is what
// makes "one row per client, newest first" testable without the database.

export interface ConnectionCandidate {
  /** The consent row; Revoke names this id. */
  id: string;
  clientId: string;
  /** The consent row's `updatedAt` — the guard's touch, at most a minute old. */
  lastActedAt: Date;
}

/**
 * One row per client, most recently acted first. A duplicate's older row is
 * the one dropped; the surviving id is the newest, which is the row the guard
 * touched last. The client id is the tie-break so two connections touched in
 * the same instant keep a stable order whatever order the query answered in.
 */
export function newestPerClient<T extends ConnectionCandidate>(
  rows: readonly T[],
): T[] {
  const newest = new Map<string, T>();
  for (const row of rows) {
    const seen = newest.get(row.clientId);
    if (!seen || row.lastActedAt.getTime() > seen.lastActedAt.getTime()) {
      newest.set(row.clientId, row);
    }
  }
  return [...newest.values()].sort(
    (a, b) =>
      b.lastActedAt.getTime() - a.lastActedAt.getTime() ||
      a.clientId.localeCompare(b.clientId),
  );
}
