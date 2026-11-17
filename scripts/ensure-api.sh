#!/bin/sh
# Ensure the API dev server is up — the one stack service that test:web
# needs but stack-up.sh deliberately does not own: the dev workflow starts
# it alongside Vite via `bun run dev`, and a test run must not kill or
# fight that. Idempotent: an API already listening on PORT is left alone
# (including one started by `bun run dev`), otherwise a plain
# `bun src/main.ts` is nohup'd and the script polls /api/health until it
# answers. The API process env is the resolved local .env (services.sh: this
# checkout's, or the main checkout's from a worktree), sourced here — bun does
# not walk up parent directories for .env, so sourcing is mandatory.
#
# The port does not belong to a checkout: a dev server in the main checkout
# keeps answering after a worktree sets its suites running, and a suite that
# never noticed would test another branch's code. So a listening API is also
# asked which checkout it serves — it answers on /api/health, from the
# ARCULA_CHECKOUT this script (and apps/api's `dev`) put in its environment —
# and a stranger is refused rather than reused.
#
#   sh scripts/ensure-api.sh
#
# Stop it: sh scripts/stack-down.sh api

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
. "$ROOT/scripts/services.sh"
require_env_file
set -a
. "$ENV_FILE"
set +a

PORT=${PORT:-8000}
# One probe, used for the check now and for the poll below. `wait_ready`
# takes a command string — it runs under `sh -c` — so this is a command and
# not the function it used to be.
API_PROBE="curl -s --noproxy '*' -o /dev/null --max-time 2 -w '%{http_code}' http://127.0.0.1:$PORT/api/health | grep -q 200"

if sh -c "$API_PROBE" 2>/dev/null; then
  ANSWERED=$(
    PORT="$PORT" node -e '
      fetch(`http://127.0.0.1:${process.env.PORT}/api/health`)
        .then((r) => r.json())
        .then((b) => process.stdout.write(b.checkout ?? ""))
        .catch(() => {});
    '
  )
  if [ "$ANSWERED" != "$ROOT" ]; then
    echo "api: :$PORT is served by ${ANSWERED:-an API that does not name a checkout}" >&2
    echo "     — not this checkout ($ROOT). A suite must not test another branch's code." >&2
    echo "     Stop it with \`sh scripts/stack-down.sh api\` from any checkout (it finds" >&2
    echo "     the server on :$PORT), or run this checkout's on its own port — PORT," >&2
    echo "     AUTH_BASE_URL and CORS_ORIGINS move together." >&2
    exit 1
  fi
  echo "api: already up ($PORT, this checkout)"
  exit 0
fi

echo "api: starting (bun src/main.ts, nohup)..."
mkdir -p "$ROOT/.stack/logs"
cd "$ROOT/apps/api"
ARCULA_CHECKOUT="$ROOT" nohup bun src/main.ts >"$ROOT/.stack/logs/api.log" 2>&1 &
echo $! >"$ROOT/.stack/api.pid"

if ! wait_ready "$API_PROBE" 30 "api ($PORT)"; then
  echo "api: see .stack/logs/api.log" >&2
  exit 1
fi
