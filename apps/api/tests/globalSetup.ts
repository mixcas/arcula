// One row before any worker starts: the OAuth provider's protected-resource
// seed.
//
// `@better-auth/oauth-provider` inserts its configured `oauthResource` at
// auth-context init, guarded by "find first, insert if absent". That is
// race-safe only when the insert's unique violation is caught — the plugin
// tests the error *message* for `unique|duplicate`, and Drizzle's wrapper says
// `Failed query: insert into "oauthResource" …` with the constraint error in
// `cause`, so the race surfaces as a rejected context instead of a skipped
// row. Vitest runs the suite's files in parallel workers, each with its own
// auth context, so a fresh database reliably loses that race.
//
// Seeding here — once, in the main process, before workers fork — means every
// worker's `findOne` finds the row and the insert never runs. The same insert
// is what the plugin itself would do; doing it earlier is the whole change.
// Production's own cold starts are unaffected by this file.

export default async function setup(): Promise<void> {
  const { oauthResource } = await import("@arcula/db");
  const { db, closeDb } = await import("../src/db");
  const { mcpResource } = await import("../src/env");
  const { mintId } = await import("../src/ids");

  await db
    .insert(oauthResource)
    .values({ id: mintId(), identifier: mcpResource, name: mcpResource })
    .onConflictDoNothing({ target: oauthResource.identifier });

  await closeDb();
}
