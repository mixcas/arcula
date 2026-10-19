/**
 * The SQL that empties an Arcula database's application state, shared by
 * both reset paths: the local `db:reset` (over docker exec) and the dev
 * reset's `db-drop.ts` (over the environment's own connection string).
 *
 * Both schemas go. `public` holds the product's tables, and drizzle-orm
 * keeps its migration bookkeeping in a dedicated `drizzle` schema — a
 * surviving bookkeeping row makes the next migrate a silent no-op (it
 * "succeeds" without writing a single table). `public` is recreated because
 * the migrations expect it to exist.
 */
export const DROP_APP_SCHEMAS_SQL =
  "DROP SCHEMA IF EXISTS public CASCADE; " +
  "DROP SCHEMA IF EXISTS drizzle CASCADE; " +
  "CREATE SCHEMA public;";
