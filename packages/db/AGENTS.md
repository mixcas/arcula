# packages/db — agent notes

Read [the package README](README.md) for the tables, the migration catalogue and
the hand-edit cases, and [the architecture map](../../docs/architecture.md) for
how the schema sits under the API. This file carries only the deltas.

- **Generated and applied, never reversed.** `bunx drizzle-kit generate` writes
  the SQL and `db:migrate` applies it; nothing in the tooling un-migrates, so
  the schema's shape is what the running code has to tolerate.
- **Exactly three hand edits exist:** a data backfill appended after
  generation, the add-nullable → backfill → set-not-null sequence for a column
  that cannot be added `NOT NULL`, and the guarded grant revoke drizzle-kit
  cannot model. `0006_enable_rls` carries the third; `README.md` catalogues all
  three, and nothing else is edited by hand.
- **The additive-table shape** is `0012_account_write_windows` and
  `0013_agent_access`: generate the `CREATE TABLE`, keys, constraints and
  indexes, then append the guarded `DO` block revoking `anon` and
  `authenticated`, because a migration can only lock down the tables it can see.
- **The adapter test is the contract with Better Auth.**
  [apps/api/tests/adapter.test.ts](../../apps/api/tests/adapter.test.ts)
  asserts every model and field the plugin declares through `getAuthTables()`
  exists in `src/index.ts`; a plugin upgrade fails there, and the fix is the
  schema, not the assertion.
- **`db:reset` is local only** and refuses production without
  `ALLOW_DB_RESET=true`. One database serves every worktree, so a branch
  carrying a migration owns the local schema while it is under test — a sibling
  checkout must not assume the shape it expected ([mechanics](../../docs/testing.md)).
