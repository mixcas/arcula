#!/bin/sh
# Print the local environment's file, so a caller can source it:
#
#   set -a; . "$(sh scripts/local-env.sh)"; set +a
#   sh ../../scripts/local-env.sh            # just the path
#
# The resolution lives in services.sh, which answers "this checkout's .env, or
# the main checkout's when this is a worktree": the local stack is one per
# machine, and a worktree has no secrets of its own to point at a second one.
#
# Executable rather than sourced: `$0` is then this file's own path, which is
# what makes the repository root findable from a package script whose working
# directory is the package.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
export ROOT
. "$ROOT/scripts/services.sh"

require_env_file

printf '%s\n' "$ENV_FILE"
