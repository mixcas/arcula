#!/bin/sh
# Ensure the API dev server is up — the one stack service that test:web
# needs but stack-up.sh deliberately does not own: the dev workflow starts
# it alongside Vite via `bun run dev`, and a test run must not kill or
# fight that. Idempotent: an API already listening on PORT is left alone
# (including one started by `bun run dev`), otherwise a plain
# `bun src/main.ts` is nohup'd and the script polls /api/health until it
# answers. The API process env is the repo-root .env, sourced here — bun
# does not walk up parent directories for .env, so sourcing is mandatory.
#
#   sh scripts/ensure-api.sh
#
# Stop it: sh scripts/stack-down.sh api

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
set -a
. "$ROOT/.env"
set +a

PORT=${PORT:-8000}
probe() {
  curl -s --noproxy "*" -o /dev/null --max-time 2 -w '%{http_code}' \
    "http://127.0.0.1:$PORT/api/health"
}

if [ "$(probe)" = "200" ]; then
  echo "api: already up ($PORT)"
  exit 0
fi

echo "api: starting (bun src/main.ts, nohup)..."
mkdir -p "$ROOT/.stack/logs"
cd "$ROOT/apps/api"
nohup bun src/main.ts >"$ROOT/.stack/logs/api.log" 2>&1 &
echo $! >"$ROOT/.stack/api.pid"

i=0
while [ "$i" -lt 30 ]; do
  if [ "$(probe)" = "200" ]; then
    echo "api: ready ($PORT)"
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done
echo "api: not ready after 30s (log: .stack/logs/api.log)" >&2
exit 1
