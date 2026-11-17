#!/bin/sh
# Tear down the local dev stack (inverse of stack-up.sh).
#   sh scripts/stack-down.sh                  # everything
#   sh scripts/stack-down.sh postgres s3      # just the named services
#
# Volumes (postgres data, object-store state) are kept: db:reset wipes tables
# and objects, never the volumes.

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
export ROOT
. "$ROOT/scripts/services.sh"

# The API's port, read from the resolved environment file rather than sourced:
# `stack-down api` must be able to stop a server without exporting the whole
# local environment into this process.
PORT_ENV=$(sed -n 's/^PORT=//p' "$ENV_FILE" 2>/dev/null | tail -1 | tr -d '"'"'")
PORT=${PORT:-${PORT_ENV:-8000}}

if [ $# -eq 0 ] || { [ $# -eq 1 ] && [ "$1" = all ]; }; then
  WANT="$STACK_SERVICES"
else
  validate_services "$STACK_SERVICES_WITH_API" "$@"
fi

for s in $WANT; do
  case "$s" in
    postgres)
      # The project is the main checkout's, so this stops the one database a
      # worktree and its main checkout share.
      if docker-compose stop postgres 2>/dev/null; then
        echo "postgres: stopped ($COMPOSE_PROJECT)"
      else
        echo "postgres: not running (docker daemon down? colima start)"
      fi ;;
    s3)
      if [ -f "$STACK_STATE/seaweedfs.pid" ] && kill "$(cat "$STACK_STATE/seaweedfs.pid")" 2>/dev/null; then
        echo "s3 (SeaweedFS): stopped"
        rm -f "$STACK_STATE/seaweedfs.pid"
      else
        echo "s3 (SeaweedFS): not running"
      fi ;;
    mailpit)
      if brew services stop mailpit 2>/dev/null; then
        echo "mailpit: stopped"
      else
        echo "mailpit: not running"
      fi ;;
    api)
      if [ -f "$ROOT/.stack/api.pid" ] && kill "$(cat "$ROOT/.stack/api.pid")" 2>/dev/null; then
        echo "api: stopped"
        rm -f "$ROOT/.stack/api.pid"
        continue
      fi
      rm -f "$ROOT/.stack/api.pid"
      # The pid file lives in the checkout that started the API, so a removed
      # worktree leaves its server listening with nothing left to name it. The
      # port survives that: probe it, name the checkout it answers for, and
      # stop the listener — the same handle ensure-api.sh refused on.
      if ! command -v lsof >/dev/null 2>&1; then
        echo "api: not running (no pid file; lsof missing, so :$PORT was not probed)"
        continue
      fi
      LISTENERS=$(lsof -n -P -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)
      if [ -z "$LISTENERS" ]; then
        echo "api: not running"
        continue
      fi
      HEALTH=$(curl -s --noproxy '*' --max-time 2 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)
      OWNER=$(
        printf '%s' "$HEALTH" | node -e '
          let body = "";
          process.stdin.on("data", (chunk) => (body += chunk));
          process.stdin.on("end", () => {
            try {
              const health = JSON.parse(body);
              if (health.status === "ok") {
                process.stdout.write(
                  health.checkout || "an API that does not name a checkout",
                );
              }
            } catch {}
          });
        ' 2>/dev/null || true
      )
      if [ -z "$OWNER" ]; then
        echo "api: :$PORT answers something that is not an Arcula API — left alone"
        continue
      fi
      for pid in $LISTENERS; do
        kill "$pid" 2>/dev/null || true
      done
      echo "api: stopped (:$PORT, $OWNER)" ;;
  esac
done
echo "stack down: $WANT"
