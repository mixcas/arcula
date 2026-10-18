/**
 * The Lambda package smoke — run by `scripts/build-lambda.sh`
 * INSIDE a glibc Linux container (`node:20`, arm64). It proves the things
 * the deploy must not learn in production:
 *
 *   1. the deploy bundle (index.js) loads and answers on the target
 *      runtime — health, sign-up → /me (the DB path and the session
 *      cookie), the SPA shell, a binary asset;
 *   2. Sharp's NATIVE prebuilt works on glibc — the headline risk —
 *      driven straight through the pipeline on a real 12 MP source, with
 *      the per-photo number reported.
 *
 * No S3: the AWS-SDK storage path is pure JS and is already proven by the
 * host-side API suite against the local SeaweedFS; what is
 * runtime-specific here is the bundle and the native module. Postgres is
 * the local dev database, reached over the compose network (the smoke
 * user it creates follows the same precedent as the API suite's).
 *
 * Env comes from the build script (the root .env with DATABASE_URL
 * pointed at the compose-network `postgres` service).
 */
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fail = (msg) => {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
};

const started = Date.now();
// The deploy artifact is what loads first — a broken bundle shows here.
const { handler } = await import("./index.js");
// The pipeline, for the direct Sharp run (same source, same build flags).
const { generateVariants, orientSource, sourceDimensions } =
  await import("./smoke.js");
const loadMs = Date.now() - started;
console.log(`load (bundle init): ${loadMs}ms`);

const gw = (
  path,
  { method = "GET", body, isBase64Encoded = false, headers = {}, cookies } = {},
) => ({
  rawPath: path,
  rawQueryString: "",
  headers: { host: "smoke.local", ...headers },
  cookies,
  body,
  isBase64Encoded,
  requestContext: { http: { method, path } },
});

const expectStatus = (label, res, status) => {
  if (res.statusCode !== status) {
    fail(
      `${label}: expected ${status}, got ${res.statusCode} — ${String(res.body).slice(0, 400)}`,
    );
  }
};
const json = (res) =>
  JSON.parse(
    res.isBase64Encoded
      ? Buffer.from(res.body, "base64").toString("utf8")
      : res.body,
  );

// 1. Health — the first request after load.
let t = Date.now();
expectStatus("health", await handler(gw("/api/health")), 200);
console.log(`health (first request): ${Date.now() - t}ms`);

// 2. Sign up → /me: the DB path and the session cookie, over the gateway
//    shape.
const email = `smoke-lambda-${Date.now()}@example.test`;
const up = await handler(
  gw("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Lambda Smoke",
      email,
      password: "smoke-pass-12345",
    }),
  }),
);
expectStatus("sign-up", up, 200);
// The package is the production bundle (build-lambda.sh DEFINES
// NODE_ENV="production"), so the session cookie must be Secure and carry
// Better Auth's `__Secure-` prefix. Assert the attribute, not just the
// name: a build that loses the define ships a non-Secure prod cookie
// (the bundler inlining `process.env.NODE_ENV`) and no other check here
// would notice.
const cookie = (up.cookies ?? []).find((c) =>
  c.startsWith("__Secure-better-auth.session_token="),
);
if (!cookie) fail("sign-up returned no Secure session cookie");
if (!/;\s*Secure\b/i.test(cookie)) fail("session cookie is not marked Secure");

const me = await handler(gw("/api/v1/me", { cookies: [cookie] }));
expectStatus("/me", me, 200);
if (json(me).email !== email) fail("/me answered for the wrong user");
console.log("sign-up + /me: ok");

// 3. SPA shell + a binary asset, from a throwaway dist in the container.
const dist = join(tmpdir(), "smoke-dist");
await mkdir(join(dist, "assets"), { recursive: true });
await writeFile(join(dist, "index.html"), "<html>SMOKE-INDEX</html>");
await writeFile(join(dist, "assets/blob.bin"), "bin");
process.env.WEB_DIST = dist;

const shell = await handler(gw("/collection/smoke/artwork/x"));
expectStatus("spa fallback", shell, 200);
if (shell.body !== "<html>SMOKE-INDEX</html>") fail("SPA shell mismatch");
if (shell.headers["cache-control"] !== "no-cache")
  fail("shell must be no-cache");

const blob = await handler(gw("/assets/blob.bin"));
expectStatus("binary asset", blob, 200);
if (
  !blob.isBase64Encoded ||
  Buffer.from(blob.body, "base64").toString("latin1") !== "bin"
) {
  fail("binary asset did not round-trip");
}
console.log("spa + binary: ok");

// 4. Sharp, the headline: a real 12 MP source through the exact pipeline
//    the process route runs. Measured separately for decode+orient and
//    the five encodes.
const sharp = (await import("sharp")).default;
const W = 4000;
const H = 3000;
const sample = await sharp({
  create: {
    width: W,
    height: H,
    channels: 3,
    background: { r: 201, g: 112, b: 39 },
  },
})
  .jpeg({ quality: 90 })
  .toBuffer();
console.log(`sample: ${W}x${H} jpeg, ${sample.length} bytes`);

const dims = await sourceDimensions(new Uint8Array(sample));
if (dims.width !== W || dims.height !== H) {
  fail(`sourceDimensions: ${dims.width}x${dims.height}, expected ${W}x${H}`);
}

t = Date.now();
const oriented = await orientSource(new Uint8Array(sample));
const orientMs = Date.now() - t;

t = Date.now();
const variants = await generateVariants(oriented);
const variantsMs = Date.now() - t;

if (variants.length !== 5) fail(`expected 5 variants, got ${variants.length}`);
for (const v of variants) {
  if (v.contentType !== "image/webp" || v.buffer.length === 0) {
    fail(`variant ${v.key} is not a non-empty WebP`);
  }
  console.log(
    `  ${v.key}: ${v.width}x${v.height}, ${v.size} bytes, ${v.contentType}`,
  );
}
console.log(
  `sharp: orient ${orientMs}ms + 5 encodes ${variantsMs}ms = ${orientMs + variantsMs}ms per photo`,
);

console.log(`SMOKE OK (total ${Date.now() - started}ms)`);

// The app's DB pool keeps the process alive after the last assertion —
// exit explicitly or the container (and the build) hangs on open handles.
process.exit(0);
