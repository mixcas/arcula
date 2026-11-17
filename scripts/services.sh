#!/bin/sh
# The local stack's service names, the resolved environment and the readiness
# poll — sourced by stack-up.sh, stack-down.sh and ensure-api.sh, and by
# local-env.sh, which prints the file for a caller to source. Never run
# directly.
#
# The names live here once so `stack-up.sh postgres` and
# `stack-down.sh postgres` cannot drift apart, and so a service added to
# the stack is spelled the same in both directions.

# The stack is one per machine, owned by the main checkout.
#
# A git worktree shares the repository but holds its own working tree, and it
# has neither a .env (the file is gitignored) nor a compose project of its own
# (compose derives one from the directory name, so a worktree would create a
# second, empty database or fail to bind 5432). Both facts come from the main
# checkout instead: the environment file it holds, and the compose project
# named after it. `--git-common-dir` answers the main checkout's .git from any
# worktree, nested ones included.
: "${ROOT:?services.sh expects ROOT to be set}"
# A checkout exported outside git (a tarball) has no common dir to ask about;
# it is then its own main checkout, and everything still resolves.
MAIN_ROOT=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || MAIN_ROOT="$ROOT/.git"
MAIN_ROOT=$(dirname "$MAIN_ROOT")
ENV_FILE="$ROOT/.env"
[ -f "$ENV_FILE" ] || ENV_FILE="$MAIN_ROOT/.env"
# Where the shared services keep their state — one data dir, one pid file, one
# log dir, whichever checkout started them. The API is deliberately not here:
# it runs the checkout's own code, so its pid and log stay under $ROOT/.stack.
STACK_STATE="$MAIN_ROOT/.stack"
COMPOSE_PROJECT=$(basename "$MAIN_ROOT")
# Compose reads this, so no call site passes -p — including the one in
# db-reset.ts, which inherits it from the environment its caller sourced.
export COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT"

# require_env_file — the script that needs the values names the file it could
# not find, rather than letting `.` fail with a shell error.
require_env_file() {
  [ -f "$ENV_FILE" ] || {
    echo "missing $ENV_FILE — create the local environment file first" >&2
    exit 1
  }
}

# What the stack is, and what a plain `stack-up.sh` / `stack-down.sh`
# acts on. `api` is stack-down's alone (opt-in: the dev API started by
# `bun run dev` must survive a plain stack-down, so it is never the
# default).
STACK_SERVICES="postgres s3 mailpit"
STACK_SERVICES_WITH_API="$STACK_SERVICES api"

# validate_services <allowed> <name...> — reads $@ and sets WANT to the
# validated names, space-joined. An unknown name prints every name it does
# take and exits 2, which exits the sourcing script.
validate_services() {
  allowed=$1
  shift
  pretty=$(printf '%s' "$allowed" | sed 's/ / | /g')
  WANT=""
  for name in "$@"; do
    case " $allowed " in
      *" $name "*) WANT="$WANT $name" ;;
      *)
        printf 'unknown service: %s (%s | all)\n' "$name" "$pretty" >&2
        exit 2
        ;;
    esac
  done
  WANT=${WANT# }
}

# Wait until the probe command $1 succeeds, at most $2 seconds ($3 =
# label). The probe is a command string, not a function: it runs under
# `sh -c`.
wait_ready() {
  i=0
  while [ "$i" -lt "$2" ]; do
    if sh -c "$1" 2>/dev/null; then
      echo "$3: ready"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  echo "$3: not ready after ${2}s" >&2
  return 1
}
