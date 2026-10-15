// db:seed — seed only, no wipe. Idempotent: an account that already exists
// is reported, not an error.
//
// A failed better-auth .api call THROWS an APIError ({ status, body:
// { message, code } }); a success resolves the endpoint body. (Verified
// against the live adapter.)
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// An absolute cwd: a relative one makes this environment's posix_spawn fail
// with ENOENT on /bin/sh. The script lives at apps/api/scripts/, so the
// repo root is three up.
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

execSync("sh scripts/stack-up.sh postgres", {
  stdio: "inherit",
  cwd: repoRoot,
});

const { auth } = await import("../src/auth");
const { closeDb } = await import("../src/db");
const email = process.env.SEED_EMAIL;
const password = process.env.SEED_PASSWORD;
if (!email || !password) {
  throw new Error("SEED_EMAIL / SEED_PASSWORD are required in the root .env");
}

try {
  const res = (await auth.api.signUpEmail({
    body: { email, password, name: process.env.SEED_NAME ?? "Owner" },
  })) as { user?: { email: string } };
  console.log(`seed: owner account ${res.user?.email ?? email} created`);
} catch (e) {
  const code = (e as { body?: { code?: string } }).body?.code;
  if (code?.startsWith("USER_ALREADY_EXISTS")) {
    console.log(`seed: ${email} already exists — nothing to do`);
  } else {
    console.error(
      `seed failed: ${JSON.stringify((e as { body?: unknown }).body ?? e)}`,
    );
    process.exit(1);
  }
}
await closeDb();
