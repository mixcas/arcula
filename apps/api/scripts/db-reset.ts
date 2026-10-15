// db:reset: one script — drop all tables, re-apply migrations, clear both
// object prefixes in the S3 stand-in, seed the owner account through the
// same Better Auth instance the app signs in with, and prove sign-in
// through the adapter.
//
// Refuses to run in prod unless ALLOW_DB_RESET=true.

import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (
  process.env.NODE_ENV === "production" &&
  process.env.ALLOW_DB_RESET !== "true"
) {
  console.error(
    "db:reset refuses to run in production (set ALLOW_DB_RESET=true to override)",
  );
  process.exit(1);
}

// An absolute cwd: a relative one makes this environment's posix_spawn fail
// with ENOENT on /bin/sh. The script lives at apps/api/scripts/, so the
// repo root is three up.
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

// 1. The services this script needs (idempotent: already-up are left alone).
execSync("sh scripts/stack-up.sh postgres s3", {
  stdio: "inherit",
  cwd: repoRoot,
});

// 2. Wipe the schema — every table, no survivors. The `drizzle` schema is
// dropped too: drizzle-orm 0.45 keeps its migration bookkeeping in a
// dedicated `drizzle` schema by default, and a surviving bookkeeping row
// makes the re-apply below a silent no-op (the migration "succeeds"
// without writing a single table).
execSync(
  "docker-compose exec -T postgres psql -U arcula -d arcula " +
    '-c "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"',
  { stdio: "inherit", cwd: repoRoot },
);

// 3. Re-apply the migrations.
execSync("bunx drizzle-kit migrate", {
  stdio: "inherit",
  cwd: `${repoRoot}packages/db`,
});

// 4. Clear both object prefixes: staging/ and the final artworks/ tree.
const s3Endpoint = process.env.S3_ENDPOINT;
const s3Key = process.env.S3_ACCESS_KEY;
const s3Secret = process.env.S3_SECRET_KEY;
if (!s3Endpoint || !s3Key || !s3Secret) {
  throw new Error(
    "S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY are required in the root .env",
  );
}
const s3 = new S3Client({
  endpoint: s3Endpoint,
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: s3Key, secretAccessKey: s3Secret },
});
const bucket = process.env.S3_BUCKET ?? "arcula";

try {
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`s3: created bucket ${bucket}`);
} catch (e) {
  if ((e as { name?: string }).name !== "BucketAlreadyOwnedByYou") throw e;
  console.log(`s3: bucket ${bucket} already exists`);
}

for (const prefix of ["staging/", "artworks/"]) {
  const keys: { Key: string }[] = [];
  let token: string | undefined;
  for (;;) {
    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of list.Contents ?? [])
      if (obj.Key) keys.push({ Key: obj.Key });
    if (!list.IsTruncated) break;
    token = list.NextContinuationToken;
  }
  // S3 caps DeleteObjects at 1000 keys per request, and the listing above is
  // unbounded — test runs leave staged objects behind, so a busy dev bucket
  // easily crosses the cap and the 400 "up to 1000 keys" aborts the reset.
  // Chunk, and check the per-key errors: a partial failure answers inside a
  // 200, so a wipe that "succeeds" with survivors is the same as none at all.
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const res = await s3.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch } }),
    );
    const errors = res.Errors;
    if (errors && errors.length > 0) {
      throw new Error(
        `s3: ${errors.length} key(s) survived the wipe of ${prefix}: ` +
          errors
            .map((e) => `${e.Key} (${e.Code})`)
            .slice(0, 5)
            .join(", "),
      );
    }
  }
  console.log(
    `s3: cleared ${prefix}(${keys.length} object${keys.length === 1 ? "" : "s"})`,
  );
}

// 5. Seed the owner account through the app's own auth instance, then
// 6. prove sign-in through the adapter.
// A failed .api call THROWS an APIError ({ status, body: { message, code } });
// a success resolves the endpoint body — so the guards below are checks on
// a resolved body, and a real failure aborts the script with the thrown error.
const { auth } = await import("../src/auth");
const { closeDb } = await import("../src/db");
const email = process.env.SEED_EMAIL;
const password = process.env.SEED_PASSWORD;
if (!email || !password) {
  throw new Error("SEED_EMAIL / SEED_PASSWORD are required in the root .env");
}

const signedUp = (await auth.api.signUpEmail({
  body: { email, password, name: process.env.SEED_NAME ?? "Owner" },
})) as { user?: { email: string; tier?: string } };
if (!signedUp.user) {
  throw new Error("seed sign-up returned no user");
}
console.log(
  `seed: owner account ${signedUp.user.email} (tier ${signedUp.user.tier ?? "free"})`,
);

const signedIn = (await auth.api.signInEmail({
  body: { email, password },
})) as { token?: string };
if (!signedIn.token) {
  throw new Error("sign-in through the adapter returned no session token");
}
console.log(`sign-in: OK (session ${signedIn.token.slice(0, 8)}…)`);

await closeDb();
console.log("db:reset complete");
