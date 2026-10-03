// Apply pending Drizzle migrations (packages/db/migrations → the local
// compose Postgres). No wipe: this is the everyday `db:migrate`.
//
// The root db:* scripts source the repo .env, so DATABASE_URL is set here;
// drizzle.config.ts in packages/db reads it.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// An absolute cwd: a relative one (or one that resolves to a missing path)
// makes this environment's posix_spawn fail with ENOENT on /bin/sh.
// The script lives at apps/api/scripts/, so the repo root is three up.
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

execSync("bunx drizzle-kit migrate", {
  stdio: "inherit",
  cwd: `${repoRoot}packages/db`,
});
console.log("db:migrate — pending migrations applied");
