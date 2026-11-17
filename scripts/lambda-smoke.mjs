/**
 * The Lambda package smoke — run by `scripts/build-lambda.sh`
 * INSIDE a glibc Linux container (`node:24`, arm64). It proves the things
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
 * pointed at the compose-network `postgres` service), plus `SMOKE_ENV`:
 * the package cannot know which environment it was built for, and dev's
 * mapping chain gets an assertion that production must not have.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

const shell = await handler(gw("/catalogue/smoke/artwork/x"));
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
//    the six encodes.
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

// The recipe's own count (apps/api/src/media/variants.ts): six since
// `xxlarge` joined for the Catalogue PDF and the fullscreen slideshow. A
// literal, not an import — the smoke's job is to notice when the recipe and
// the package disagree, so it must not read its expectation from the recipe.
if (variants.length !== 6) fail(`expected 6 variants, got ${variants.length}`);
for (const v of variants) {
  if (v.contentType !== "image/webp" || v.buffer.length === 0) {
    fail(`variant ${v.key} is not a non-empty WebP`);
  }
  console.log(
    `  ${v.key}: ${v.width}x${v.height}, ${v.size} bytes, ${v.contentType}`,
  );
}
console.log(
  `sharp: orient ${orientMs}ms + ${variants.length} encodes ${variantsMs}ms = ${orientMs + variantsMs}ms per photo`,
);

// 5. Dev's mapping chain. The Lambda runs this bundle with
//    NODE_OPTIONS=--enable-source-maps, which reads the reference the build
//    appended and the map it names — so both must reach the package, and the
//    map must resolve THIS bundle's code back to TypeScript. A map parsed
//    from a different build passes a structural check and still breaks every
//    trace, so the last assertion resolves a token the bundle carries through
//    the map's tables and requires a frame in this repo's entry. Production
//    makes no new assertion here: the build's tree gate already proves the
//    absence of the map and the reference, and a second negative assertion
//    would only re-prove it.
if (process.env.SMOKE_ENV === "dev") {
  const bundle = await readFile("index.js", "utf8");
  if (!bundle.includes("//# sourceMappingURL=index.js.map")) {
    fail("dev bundle carries no sourceMappingURL reference to index.js.map");
  }

  let map;
  try {
    map = JSON.parse(await readFile("index.js.map", "utf8"));
  } catch (err) {
    fail(`dev's index.js.map does not parse: ${err.message}`);
  }
  if (map === null || typeof map !== "object") {
    fail(`dev's index.js.map is ${typeof map}, not a source map object`);
  }
  if (map.version !== 3) {
    fail(`dev's map is version ${map.version}, expected 3`);
  }
  if (!Array.isArray(map.sources) || map.sources.length === 0) {
    fail("dev's map lists no sources");
  }
  const entrySource = "apps/api/src/lambda.ts";
  if (!map.sources.some((source) => source.endsWith(entrySource))) {
    fail(`dev's map does not source ${entrySource}`);
  }
  if (!map.sources.some((source) => source.endsWith(".ts"))) {
    fail("dev's map resolves to no TypeScript source");
  }
  if (!Array.isArray(map.sourcesContent) || map.sourcesContent.length === 0) {
    fail("dev's map embeds no sourcesContent (the source text)");
  }

  // A token both files carry — the adapter's header builder. Its generated
  // line/column comes from the bundle exactly as the runtime computes it.
  const token = "function gatewayHeaders";
  const at = bundle.indexOf(token);
  if (at < 0)
    fail(`dev bundle carries no "${token}" to resolve through the map`);
  const tokenAt = at + "function ".length;
  const head = bundle.slice(0, tokenAt);
  const generatedLine = head.split("\n").length - 1;
  const generatedColumn = tokenAt - head.lastIndexOf("\n") - 1;

  let entry;
  try {
    const { SourceMap } = await import("node:module");
    entry = new SourceMap(map).findEntry(generatedLine, generatedColumn);
  } catch (err) {
    fail(`dev's map is not resolvable: ${err.message}`);
  }
  const position = `index.js:${generatedLine + 1}:${generatedColumn}`;
  if (!entry) {
    fail(
      `dev's map has no entry for ${position} — it does not match this bundle`,
    );
  }
  if (!entry.originalSource.endsWith(entrySource)) {
    fail(
      `dev's map resolves ${position} to ${entry.originalSource}, expected ${entrySource}`,
    );
  }
  console.log(
    `source map: ${position} → ${entry.originalSource}:${entry.originalLine + 1}:${entry.originalColumn}`,
  );
}

console.log(`SMOKE OK (total ${Date.now() - started}ms)`);

// The app's DB pool keeps the process alive after the last assertion —
// exit explicitly or the container (and the build) hangs on open handles.
process.exit(0);
