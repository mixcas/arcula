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
# handler at `index.handler` (index.js). The smoke runs the package INSIDE
# the container, so a broken bundle or a Sharp prebuilt that does not load
# stops the build instead of shipping.
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
bun build apps/api/src/lambda.ts --target node --format esm --external sharp --define "$DEFINE_NODE_ENV" --outdir "$STAGE"
mv "$STAGE/lambda.js" "$STAGE/index.js"

# 1b. The Collection PDF's fallback face travels beside the bundle: the
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
echo "==> building web"
bun run build
rm -rf "$STAGE/web"
mkdir -p "$STAGE/web"
cp -R apps/web/dist "$STAGE/web/dist"

# 3. The package manifest: only sharp is a runtime dependency (it is
#    native; everything else is in the bundle).
cat > "$STAGE/package.json" <<'EOF'
{
  "name": "arcula-api-lambda",
  "private": true,
  "type": "module",
  "dependencies": {
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

# 5. Zip the package (the smoke files are not part of the deploy).
rm -f "$STAGE/lambda-smoke.mjs" "$STAGE/smoke.js"
echo "==> zipping"
(cd "$STAGE" && zip -qr "$ROOT/$OUT" .)
du -h "$OUT"
echo "==> done: $OUT (handler: index.handler)"
