import { defineConfig } from "drizzle-kit";

// `generate` is offline (schema → migrations/); `migrate`/`studio` use
// `DATABASE_URL`. The root scripts source the repo `.env` before invoking
// drizzle-kit, so this default only ever serves a hand-run from this
// directory.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/index.ts",
  out: "./migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://arcula:arcula@localhost:5432/arcula",
  },
});
