#!/bin/sh
# Create a git worktree that is ready to run the gate.
#
#   sh scripts/worktree-new.sh ticket/166-review-fixes
#   sh scripts/worktree-new.sh my-branch --base dev
#
# The worktree lands beside the main checkout, at <repo>-wt/<name with / → ->,
# on branch <name>. A branch that does not exist yet is created from --base
# (default: the main checkout's HEAD). A fresh worktree has no node_modules,
# and the gate needs both the workspace install and infra/cdk's own — AGENTS.md
# requires the second before `bun run check` can resolve `aws-cdk-lib` — so both
# run here.
#
# The worktree also gets its own gitignored .env: the main checkout's values,
# with a port derived from the branch name (and moved to the next free one), so
# two checkouts can run their API and web suites at once. The local stack —
# Postgres, SeaweedFS, Mailpit and the compose project — is still the main
# checkout's, as docs/testing.md describes.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
export ROOT
. "$ROOT/scripts/services.sh"

NAME=${1:-}
if [ -z "$NAME" ]; then
  echo "usage: sh scripts/worktree-new.sh <branch> [--base <ref>]" >&2
  exit 2
fi
shift

BASE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --base)
      BASE=${2:-}
      if [ -z "$BASE" ]; then
        echo "worktree: --base needs a ref" >&2
        exit 2
      fi
      shift 2 ;;
    *)
      echo "worktree: unknown argument: $1" >&2
      exit 2 ;;
  esac
done

DIR_NAME=$(printf '%s' "$NAME" | tr '/' '-')
DIR="$(dirname "$MAIN_ROOT")/$(basename "$MAIN_ROOT")-wt/$DIR_NAME"

if [ -e "$DIR" ]; then
  echo "worktree: $DIR already exists" >&2
  exit 1
fi

if git -C "$MAIN_ROOT" show-ref --verify --quiet "refs/heads/$NAME"; then
  git -C "$MAIN_ROOT" worktree add "$DIR" "$NAME"
else
  git -C "$MAIN_ROOT" worktree add -b "$NAME" "$DIR" "${BASE:-HEAD}"
fi

# A deterministic port from the branch name, moved forward past anything
# already listening. The range keeps clear of the main checkout's 8000 and the
# Vite dev server's 3000; `lsof` may be absent, in which case the hash answer
# stands and a collision is the caller's to notice.
port_for() {
  seed=$(printf '%s' "$1" | cksum | awk '{print $1}')
  port=$((8100 + seed % 800))
  tries=0
  while [ "$tries" -lt 30 ]; do
    if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      printf '%s\n' "$port"
      return 0
    fi
    port=$((8100 + (port - 8100 + 1) % 800))
    tries=$((tries + 1))
  done
  return 1
}

if ! PORT=$(port_for "$NAME"); then
  echo "worktree: no free port in 8100-8899" >&2
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  awk -v port="$PORT" -v base="http://localhost:$PORT" '
    /^PORT=/ { print "PORT=" port; seen_port = 1; next }
    /^AUTH_BASE_URL=/ {
      print "AUTH_BASE_URL=" base "/api/auth";
      seen_auth = 1;
      next
    }
    /^VITE_API_TARGET=/ { next }
    { print }
    END {
      if (!seen_port) print "PORT=" port
      if (!seen_auth) print "AUTH_BASE_URL=" base "/api/auth"
      print "VITE_API_TARGET=" base
    }
  ' "$ENV_FILE" > "$DIR/.env"
  chmod 600 "$DIR/.env"
else
  echo "worktree: no $ENV_FILE to copy; the worktree has no local .env" >&2
fi

echo "worktree: installing dependencies (workspace and infra/cdk)..."
(
  cd "$DIR"
  bun install --frozen-lockfile
  cd infra/cdk
  bun install
)

printf 'worktree: %s\nbranch:   %s\nport:     %s\n' "$DIR" "$NAME" "$PORT"
