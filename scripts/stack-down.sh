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

if [ $# -eq 0 ] || { [ $# -eq 1 ] && [ "$1" = all ]; }; then
  WANT="$STACK_SERVICES"
else
  validate_services "$STACK_SERVICES_WITH_API" "$@"
fi

for s in $WANT; do
  case "$s" in
    postgres)
      if docker-compose stop postgres 2>/dev/null; then
        echo "postgres: stopped"
      else
        echo "postgres: not running (docker daemon down? colima start)"
      fi ;;
    s3)
      if [ -f "$ROOT/.stack/seaweedfs.pid" ] && kill "$(cat "$ROOT/.stack/seaweedfs.pid")" 2>/dev/null; then
        echo "s3 (SeaweedFS): stopped"
        rm -f "$ROOT/.stack/seaweedfs.pid"
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
      else
        echo "api: not running"
      fi ;;
  esac
done
echo "stack down: $WANT"
