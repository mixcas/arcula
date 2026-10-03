// The api's single database driver (plan §2: one schema, no drift).
//
// `postgres()` is lazy — no connection happens until the first query — so
// importing this module with no DATABASE_URL (a test environment) is safe.
// The URL itself comes from the root .env, which the db:* scripts source;
// the fallback is the compose default, for a bare hand-run.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema } from "@arcula/db";

export const client = postgres(
  process.env.DATABASE_URL ?? "postgres://arcula:arcula@localhost:5432/arcula",
  { max: 10 },
);
export const db = drizzle(client, { schema });
export const closeDb = () => client.end({ timeout: 5 });
