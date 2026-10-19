#!/bin/sh
# Reset the dev environment: drop its schema and empty its media bucket.
# Usage: sh scripts/reset-dev.sh --yes
#
# Destructive, and only meaningful for the disposable environment: it reads
# infra/cdk/.env.dev and the dev stack, and refuses to run at all without the
# explicit --yes. It cannot touch production — the file and the stack it
# names are both dev's — but a wipe by reflex is still a wipe.
#
# The next dev deploy re-applies the migrations and re-seeds the owner
# account, so a reset leaves a database that is empty, not broken.

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENV=dev

# The confirmation is the first gate: nothing below it runs — not even
# reading the environment's file — until the caller has asked for the wipe.
[ "${1:-}" = "--yes" ] || {
  echo "refusing: reset-dev drops the dev schema and empties the dev bucket" >&2
  echo "          re-run with --yes if that is what you want" >&2
  exit 1
}

. "$ROOT/scripts/environment.sh"

load_env
require_env DATABASE_URL "${DATABASE_URL:-}"

echo "==> dropping the schema over dev's database"
( cd "$ROOT/apps/api" && DATABASE_URL="$DATABASE_URL" bun scripts/db-drop.ts )

# The bucket is read off the stack rather than restated: the deploy creates
# it, and its name is an output, not a value anyone wrote down.
echo "==> emptying dev's media bucket"
BUCKET=$(stack_output MediaBucket)
[ "$BUCKET" != "None" ] && [ -n "$BUCKET" ] || {
  echo "no MediaBucket output on $STACK_NAME — has dev been deployed?" >&2
  exit 1
}
aws s3 rm "s3://$BUCKET" --recursive --region "$REGION"

echo "==> dev reset: schema dropped, s3://$BUCKET emptied"
echo "    the next dev deploy migrates and seeds it again"
