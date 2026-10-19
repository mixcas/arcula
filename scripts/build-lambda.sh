#!/bin/sh
# Build the Lambda deploy package and smoke it on a glibc Linux runtime.
# Usage: sh scripts/build-lambda.sh
#
# Produces dist/lambda/arcula-api.zip — the code bundle, Sharp's native
# prebuilt, and the built SPA (web/dist, served by spa.ts with
# WEB_DIST=/var/task/web/dist) — with the handler at `index.handler`
# (index.js). The smoke runs the package INSIDE the container, so a
# broken bundle or a Sharp prebuilt that does not load stops the build
# instead of shipping.
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

STAGE=dist/lambda/stage
OUT=dist/lambda
rm -rf "$STAGE" "$OUT/arcula-api.zip"
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

echo "==> bundling"
bun build apps/api/src/lambda.ts --target node --format esm --external sharp --define "$DEFINE_NODE_ENV" --outdir "$STAGE"
mv "$STAGE/lambda.js" "$STAGE/index.js"

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
cp scripts/lambda-smoke.mjs "$STAGE/lambda-smoke.mjs"
TMP_ENV=$(mktemp)
trap 'rm -f "$TMP_ENV"' EXIT
sed -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://arcula:arcula@postgres:5432/arcula|" \
    "$ROOT/.env" > "$TMP_ENV"

echo "==> smoke (node:24, glibc, arm64, compose network)"
docker run --rm --platform linux/arm64 \
  --network arcula_default --env-file "$TMP_ENV" \
  -v "$ROOT/$STAGE":/app -w /app node:24 \
  sh -c "npm install --omit=dev --no-audit --no-fund && node lambda-smoke.mjs"

# 5. Zip the package (the smoke files are not part of the deploy).
rm "$STAGE/lambda-smoke.mjs" "$STAGE/smoke.js"
echo "==> zipping"
(cd "$STAGE" && zip -qr "../arcula-api.zip" .)
du -h "$OUT/arcula-api.zip"
echo "==> done: $OUT/arcula-api.zip (handler: index.handler)"
