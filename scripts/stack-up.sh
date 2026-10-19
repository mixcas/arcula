#!/bin/sh
# Bring up the local dev stack, idempotently: services that are
# already up are left alone.
#
#   sh scripts/stack-up.sh                  # everything: postgres s3 mailpit
#   sh scripts/stack-up.sh postgres s3      # just the named services
#
# Postgres runs as a docker (colima) container — the only stack service the
# docker registry reachable from this machine actually hosts. The S3
# stand-in (SeaweedFS) and Mailpit run natively: seaweedfs as a nohup'd
# binary, mailpit as a brew service. Credentials come from the repo-root
# .env (sourced and exported below). Nothing in this file is production.

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
export ROOT
. "$ROOT/scripts/services.sh"

if [ $# -eq 0 ] || { [ $# -eq 1 ] && [ "$1" = all ]; }; then
  WANT="$STACK_SERVICES"
else
  validate_services "$STACK_SERVICES" "$@"
fi

set -a
. "$ROOT/.env"
set +a

ensure_postgres() {
  if docker-compose exec -T postgres pg_isready -U arcula -d arcula >/dev/null 2>&1; then
    echo "postgres: already up (5432)"
    return 0
  fi
  echo "postgres: starting (docker container)..."
  docker-compose up -d postgres
  wait_ready 'docker-compose exec -T postgres pg_isready -U arcula -d arcula' 60 postgres
}

ensure_s3() {
  # Unauthenticated SeaweedFS answers the S3 ListAllMyBuckets request at
  # the service root — 200 means the S3 API is up.
  if [ "$(curl -s --noproxy "*" -o /dev/null --max-time 2 -w '%{http_code}' http://127.0.0.1:9000/)" = "200" ]; then
    echo "s3 (SeaweedFS): already up (9000)"
    return 0
  fi
  WEED_BIN=$(command -v weed) || {
    echo "seaweedfs: not installed — run: brew install seaweedfs" >&2
    return 1
  }
  echo "s3 (SeaweedFS): starting (native binary)..."
  mkdir -p "$ROOT/.stack/seaweedfs" "$ROOT/.stack/logs"
  # -volume.port: 8080 is often already taken on a dev machine, so the
  # volume server binds 8090 — only the S3 API on 9000 is used here.
  nohup "$WEED_BIN" server -dir="$ROOT/.stack/seaweedfs" -s3 \
    -s3.ip.bind 127.0.0.1 -s3.port 9000 \
    -volume.port 8090 \
    >"$ROOT/.stack/logs/seaweedfs.log" 2>&1 &
  echo $! >"$ROOT/.stack/seaweedfs.pid"
  wait_ready 'curl -s --noproxy "*" -o /dev/null --max-time 2 -w "%{http_code}" http://127.0.0.1:9000/ | grep -q 200' 30 "s3 (SeaweedFS)"
}

ensure_mailpit() {
  if node "$ROOT/scripts/port-open.js" 1025 2>/dev/null; then
    echo "mailpit: already up (1025 SMTP / 8025 UI)"
    return 0
  fi
  command -v mailpit >/dev/null 2>&1 || {
    echo "mailpit: not installed — run: brew install mailpit" >&2
    return 1
  }
  echo "mailpit: starting (brew service)..."
  brew services start mailpit
  wait_ready "node \"$ROOT/scripts/port-open.js\" 1025" 30 mailpit
}

for s in $WANT; do
  case "$s" in
    postgres) ensure_postgres ;;
    s3)       ensure_s3 ;;
    mailpit)  ensure_mailpit ;;
  esac
done
echo "stack up: $WANT"
