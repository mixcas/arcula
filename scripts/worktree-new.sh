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
# run here. Nothing local is copied: the local stack borrows the main
# checkout's .env, compose project and services (docs/testing.md).
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

echo "worktree: installing dependencies (workspace and infra/cdk)..."
(
  cd "$DIR"
  bun install --frozen-lockfile
  cd infra/cdk
  bun install
)

printf 'worktree: %s\nbranch:   %s\n' "$DIR" "$NAME"
