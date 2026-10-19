#!/bin/sh
# The local stack's service names and the readiness poll — sourced by
# stack-up.sh, stack-down.sh and ensure-api.sh, never run directly.
#
# The names live here once so `stack-up.sh postgres` and
# `stack-down.sh postgres` cannot drift apart, and so a service added to
# the stack is spelled the same in both directions.

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
