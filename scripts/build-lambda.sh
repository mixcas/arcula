#!/bin/sh
# Build one environment's Lambda deploy package and smoke it on a glibc
# Linux runtime. Usage: sh scripts/build-lambda.sh <prod|dev>
#
# Produces dist/lambda/<artifact> — `arcula-api.zip` for production,
# `arcula-api-dev.zip` for dev, the name the CDK stack reads for that
# environment. Each environment stages into its own directory and writes
# its own file, so a dev build never disturbs production's artifact. That
# package is the code bundle, Sharp's native prebuilt and the built SPA
# (web/dist, served by spa.ts with WEB_DIST=/var/task/web/dist) — with the
# handler at `index.handler` (index.js). Dev's package also carries the
# bundle's external map (index.js.map, with the reference appended by this
# script) and the SPA's maps, which the dev function reads with
# NODE_OPTIONS=--enable-source-maps; production's carries neither, because a
# map publishes the source. Step 5 refuses to zip an artifact that breaks
# either half. The smoke runs the package INSIDE the container, so a broken
# bundle or a Sharp prebuilt that does not load stops the build instead of
# shipping.
#
# Runtime note: the target is the Lambda Node.js 24 runtime — the stack
# pins `NODEJS_24_X` (glibc, arm64). The AWS public ECR images are not
# reachable from this machine's docker registry, so the smoke runs on
# Docker Hub's `node:24` (Debian glibc, arm64): the same Node major and the
# same libc as the runtime, which is what the Sharp prebuilt and the bundle
# depend on. The Lambda runtime itself is verified by the real deploy.
#
# Postgres: the local dev database, reached over the compose network
# (`arcula_default`, service `postgres`) — the same database the API
# suite tests against. SeaweedFS needs no involvement: the storage path
# is pure JS, proven host-side, and the smoke drives Sharp directly.
#
# The stack must be up: sh scripts/stack-up.sh

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

ENV="${1:-}"
case "$ENV" in
  prod | dev) ;;
  *)
    echo "usage: sh scripts/build-lambda.sh <prod|dev>" >&2
    exit 2
    ;;
esac
. "$ROOT/scripts/environment.sh"

STAGE="dist/lambda/stage-$ENV"
OUT="dist/lambda/$LAMBDA_ARTIFACT"
rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE"

# 1. Bundle the deploy entry for Node. Everything is inlined except sharp
#    — the native part arrives from node_modules inside the package.
#
#    `NODE_ENV` is DEFINED, not left to the runtime: `bun build` statically
#    replaces dot-access `process.env.NODE_ENV` with the BUILD machine's value
#    (unset here, so "development") and that literal is what ships. Any bundled
#    code that gates on it — auth.ts's `useSecureCookies`, a dependency's
#    dev-only branch — would then be baked wrong, and the Lambda's own
#    `NODE_ENV` env var could not correct it (the read is gone). The bundle is
#    always production, so say so. Bracket/dynamic reads survive untouched and
#    still see the runtime env at the Lambda.
DEFINE_NODE_ENV='process.env.NODE_ENV="production"'

echo "==> bundling ($ENV)"
#    `harfbuzzjs` is external for the same class of reason as sharp: its wasm
#    is a runtime asset, not code. Bundling it makes `bun build` emit the wasm
#    beside the bundle while leaving an ABSOLUTE build-machine path in the
#    `require.resolve` that loads it, which resolves to nothing in /var/task.
#    External, the subsetter resolves `harfbuzzjs/…` through the package that
#    step 3 installs — the same mechanism that ships Sharp.
#
#    Source maps are the mirror image of the SPA's: dev's package carries the
#    bundle's external map so a CloudWatch trace names the TypeScript file and
#    line (the stack switches the reading on with NODE_OPTIONS), and
#    production's carries none, because a map publishes the source. Bun writes
#    the map beside the bundle but omits the `sourceMappingURL` reference, so
#    dev's reference is appended by hand; inline maps are rejected (one 17 MB
#    unreadable file, and the dev/prod difference stops being visible in a
#    listing). The gate in step 5 is what makes this a fact.
if [ "$ENV" = prod ]; then
  bun build apps/api/src/lambda.ts --target node --format esm --external sharp --external harfbuzzjs --define "$DEFINE_NODE_ENV" --outdir "$STAGE"
else
  bun build apps/api/src/lambda.ts --target node --format esm --external sharp --external harfbuzzjs --define "$DEFINE_NODE_ENV" --sourcemap=external --outdir "$STAGE"
fi
mv "$STAGE/lambda.js" "$STAGE/index.js"
if [ "$ENV" = dev ]; then
  mv "$STAGE/lambda.js.map" "$STAGE/index.js.map"
  printf '\n//# sourceMappingURL=index.js.map\n' >>"$STAGE/index.js"
fi

# 1b. The Catalogue PDF's fallback face travels beside the bundle: the
#     bundle is one index.js, so the module's import.meta.url-relative
#     resolve (`./assets/fonts/…`) would otherwise point at nothing in
#     production. It is an asset, not a runtime npm dependency.
mkdir -p "$STAGE/assets/fonts"
cp -R apps/api/src/assets/fonts/. "$STAGE/assets/fonts/"

# The smoke's pipeline access (never part of the package).
bun build apps/api/scripts/lambda-smoke-entry.ts --target node --format esm --external sharp --define "$DEFINE_NODE_ENV" --outdir "$STAGE"
mv "$STAGE/lambda-smoke-entry.js" "$STAGE/smoke.js"

# 2. The SPA the Lambda serves (spa.ts reads WEB_DIST, which the deploy
#    sets to /var/task/web/dist). A fresh build: a stale dist would
#    ship an old app under the new API.
#
#    Session replay is production-only, and the SPA is built per
#    environment, so the switch is the environment's: prod's bundle
#    enables it, dev's is built with it off and never initialises the
#    recorder. Vite inlines the VITE_-prefixed value at build time.
#
#    Source maps are the mirror image: everywhere except production. They
#    are what makes dev's bundle readable in DevTools, and publishing them
#    on arcula.art would publish the source — so prod is the one exception,
#    and dev says so explicitly rather than inheriting the default. Not
#    VITE_-prefixed for the opposite reason to the line above: a VITE_
#    value is inlined into the bundle, and this is a build instruction, not
#    client configuration.
if [ "$ENV" = prod ]; then
  export VITE_LOGROCKET_ENABLED=true
  export ARCULA_SOURCE_MAPS=off
else
  export VITE_LOGROCKET_ENABLED=false
  export ARCULA_SOURCE_MAPS=on
fi
echo "==> building web"
bun run build
rm -rf "$STAGE/web"
mkdir -p "$STAGE/web"
cp -R apps/web/dist "$STAGE/web/dist"

# 3. The package manifest: only the runtime dependencies that are not
#    bundleable — sharp (native) and harfbuzzjs (wasm, see step 1) —
#    are here; everything else is in the bundle.
cat > "$STAGE/package.json" <<'EOF'
{
  "name": "arcula-api-lambda",
  "private": true,
  "type": "module",
  "dependencies": {
    "harfbuzzjs": "^1.6.4",
    "sharp": "^0.35.5"
  }
}
EOF

# 4. Install Sharp for the TARGET platform (the host would pick darwin
#    prebuilts) and run the smoke in the same container, on Node, on the
#    compose network so `postgres` resolves to the dev database.
#
#    The smoke runs the bundle against the local stand-ins, so its config is
#    the repo-root .env — the S3 endpoint, the mail sink and the rest that
#    only a dev machine has. The deployed environment's file is not a
#    substitute: it names the real bucket, not the stand-in. DATABASE_URL is
#    repointed at the compose service, which the container reaches by
#    service name rather than localhost.
#
#    A CI runner has no compose network and no root .env, so a deploy
#    workflow sets SKIP_LAMBDA_SMOKE=1. The install still happens — it is
#    what puts the target platform's Sharp into the package — and only the
#    smoke's assertions are skipped. Their equivalent on the runner is the
#    deploy's own end-to-end pass, which drives this same pipeline through
#    the deployed Lambda (a real 12 MP photo is part of it).
#
#    Skipping is a runner's privilege, not a switch: `CI` has to be set, so
#    a stray `SKIP_LAMBDA_SMOKE=1` on a laptop cannot disarm the build. (The
#    same guard, for the same reason, is what keeps db-seed from starting a
#    stack in CI.)
if [ -n "${CI:-}" ] && [ "${SKIP_LAMBDA_SMOKE:-}" = "1" ]; then
  echo "==> smoke skipped on CI (SKIP_LAMBDA_SMOKE=1): installing the target package only"
  docker run --rm --platform linux/arm64 \
    -v "$ROOT/$STAGE":/app -w /app node:24 \
    sh -c "npm install --omit=dev --no-audit --no-fund"
else
  cp scripts/lambda-smoke.mjs "$STAGE/lambda-smoke.mjs"
  [ -f "$ROOT/.env" ] || {
    echo "missing $ROOT/.env — the smoke needs the local stand-ins' config" >&2
    exit 1
  }
  TMP_ENV=$(mktemp)
  trap 'rm -f "$TMP_ENV"' EXIT
  sed -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://arcula:arcula@postgres:5432/arcula|" \
      "$ROOT/.env" > "$TMP_ENV"

  echo "==> smoke (node:24, glibc, arm64, compose network)"
  docker run --rm --platform linux/arm64 \
    --network arcula_default --env-file "$TMP_ENV" \
    -v "$ROOT/$STAGE":/app -w /app node:24 \
    sh -c "npm install --omit=dev --no-audit --no-fund && node lambda-smoke.mjs"
fi

# 5. Gate the staged tree, then zip it. The smoke files are not part of the
#    deploy, so they go first: what is checked is exactly what ships.
#
#    This is the same doctrine the bundle already applies to NODE_ENV: the
#    property is defined and checked, not inherited from a default. Production
#    must carry no map file and no reference to one, in the bundle or in the
#    SPA it serves — a map on arcula.art would publish the source. Dev must
#    carry the bundle's map, the reference the build appended, and the SPA's
#    maps, or "dev is debuggable" is a hope rather than a fact. Reading the
#    staged tree (not the inputs) means an upstream change that drops either
#    half fails here, before anything can be zipped or deployed by hand.
echo "==> checking the staged artifact"
gate_fail() {
  echo "artifact gate ($ENV): $1" >&2
  echo "refusing to zip $OUT — see the source-map rules in this script" >&2
  exit 1
}
rm -f "$STAGE/lambda-smoke.mjs" "$STAGE/smoke.js"
if [ "$ENV" = prod ]; then
  [ -z "$(find "$STAGE" -maxdepth 1 -name '*.map' -print)" ] ||
    gate_fail "a map file reached the bundle root: $(find "$STAGE" -maxdepth 1 -name '*.map' -print)"
  [ -z "$(find "$STAGE/web/dist" -name '*.map' -print)" ] ||
    gate_fail "a map file reached the served SPA: $(find "$STAGE/web/dist" -name '*.map' -print | head -3)"
  if grep -rlF 'sourceMappingURL' "$STAGE/index.js" "$STAGE/web/dist" >/dev/null; then
    gate_fail "a sourceMappingURL reference reached the artifact: $(grep -rlF 'sourceMappingURL' "$STAGE/index.js" "$STAGE/web/dist" | head -3)"
  fi
else
  [ -f "$STAGE/index.js.map" ] ||
    gate_fail "the bundle's external map is missing (index.js.map)"
  grep -qF 'sourceMappingURL=index.js.map' "$STAGE/index.js" ||
    gate_fail "the bundle carries no sourceMappingURL reference to index.js.map"
  [ -n "$(find "$STAGE/web/dist/assets" -name '*.js.map' -print)" ] ||
    gate_fail "the served SPA carries no .js.map (the build did not emit source maps)"
  for js in "$STAGE"/web/dist/assets/*.js; do
    grep -qF 'sourceMappingURL=' "$js" ||
      gate_fail "the served SPA script $js names no source map"
  done
fi

echo "==> zipping"
(cd "$STAGE" && zip -qr "$ROOT/$OUT" .)
du -h "$OUT"
echo "==> done: $OUT (handler: index.handler)"
