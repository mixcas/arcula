#!/bin/sh
# Write this environment's deploy file from the values a run was given.
# Usage: sh scripts/write-env-file.sh <prod|dev>
#
# A laptop writes infra/cdk/.env.<env> by hand. A CI run is handed the same
# values as environment variables — the GitHub Environment's secrets and
# variables — and writes the file here, so the workflow holds no heredoc and
# no quoting rules. The list below is the one place the file's contents are
# defined, the dev-only key included; a workflow still binds each value to a
# name, because that is how GitHub hands a secret to a step.
#
# Empty values are written as empty (`DOMAIN=`) rather than omitted: an
# unset GitHub variable is a normal state before an environment is
# configured, and the deploy's own require_env is what decides fatal.
#
# `DEPLOYED_COMMIT` is written for dev alone — it is what makes dev's
# `/api/health` answer "is my change live?", and production's body carries
# no such key.

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENV="${1:-}"
case "$ENV" in
  prod | dev) ;;
  *)
    echo "usage: sh scripts/write-env-file.sh <prod|dev>" >&2
    exit 2
    ;;
esac

OUT="$ROOT/infra/cdk/.env.$ENV"
: > "$OUT"

# `printenv` keeps the value byte-for-byte — a secret may hold spaces or
# shell metacharacters. The value is written shell-quoted, because the
# deploy scripts *source* this file: unquoted, a `$` or a backtick in a
# secret would be expanded (or executed) on the way in.
quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

write() {
  printf '%s=%s\n' "$1" "$(quote "$(printenv "$1" 2>/dev/null || true)")" >> "$OUT"
}

for name in \
  DATABASE_URL AUTH_SECRET RESEND_API_KEY \
  DOMAIN CERT_ARN EMAIL_FROM EMAIL_REPLY_TO \
  SEED_EMAIL SEED_PASSWORD SEED_NAME
do
  write "$name"
done

if [ "$ENV" = dev ]; then
  write DEPLOYED_COMMIT
fi

chmod 600 "$OUT"
echo "==> wrote $OUT"
