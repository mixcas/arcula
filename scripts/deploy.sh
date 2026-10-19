#!/bin/sh
# Deploy one environment end to end. Usage: sh scripts/deploy.sh <prod|dev>
#
# The sequence lives here once; scripts/deploy-prod.sh and
# scripts/deploy-dev.sh are thin wrappers with memorable names, so a fix
# cannot land on one environment and miss the other.
#
# Prereqs: aws configured (us-east-1); this environment's file populated
# (infra/cdk/.env.<env>, or infra/cdk/.env for production); a Lambda
# package present (sh scripts/build-lambda.sh <env> — checked below, not
# rebuilt here). The local stack may be up or down: db-seed's own stack-up
# check is idempotent, and CI skips it entirely.
#
# Flow: build the CDK app → bootstrap (idempotent) → deploy 1 (real values,
# placeholder PUBLIC_URL) → resolve the URL → db:migrate + db:seed against
# this environment's DATABASE_URL (the seed creates the owner account from
# SEED_*; a fresh environment is seeded, not restored) → deploy 2
# (PUBLIC_URL = the live URL — the Lambda is stateless, so the re-deploy is
# free) → the deploy-verify end-to-end pass.
#
# The two environments differ in exactly two script-visible ways, both of
# them about the URL. Production discovers its URL and its domain must route
# before the database is touched. Dev knows its host up front, so it needs
# no discovery, and its verify step is the one that tolerates DNS still
# being unfinished — the first dev deploy is not stuck behind a console
# step.
#
# Values are read from this environment's file and never echoed.
#
# The app selects an environment by context and synthesises exactly one
# stack, and the deploy still names its stack: an unattended deploy can only
# ever touch the environment it was asked for.

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENV="${1:-}"
case "$ENV" in
  prod | dev) ;;
  *)
    echo "usage: sh scripts/deploy.sh <prod|dev>" >&2
    exit 2
    ;;
esac
. "$ROOT/scripts/environment.sh"

# ---- this environment's values ------------------------------------------
load_env
require_env DATABASE_URL "${DATABASE_URL:-}"
require_env AUTH_SECRET "${AUTH_SECRET:-}"
require_env RESEND_API_KEY "${RESEND_API_KEY:-}"

[ -f "$ROOT/dist/lambda/$LAMBDA_ARTIFACT" ] || {
  echo "missing $ROOT/dist/lambda/$LAMBDA_ARTIFACT — run: sh scripts/build-lambda.sh $ENV" >&2
  exit 1
}

# The CDK context, one array of arguments rather than one string.
#
# `-c KEY=VALUE` pairs used to be accumulated in a variable and expanded
# unquoted, so every value was word-split: a sender with a display name
# (`Arcula dev <noreply@…>`) arrived as three arguments and a value with a
# glob in it expanded against the working directory. Positional parameters
# keep each value exactly one argument, whatever it holds.
#
# `set --` is safe here: ENV was read off $1 above and nothing below reads
# the script's own arguments again.
set -- -c "ENV=$ENV" \
  -c "DATABASE_URL=$DATABASE_URL" \
  -c "AUTH_SECRET=$AUTH_SECRET" \
  -c "RESEND_API_KEY=$RESEND_API_KEY"
if [ -n "${EMAIL_FROM:-}" ]; then
  set -- "$@" -c "EMAIL_FROM=$EMAIL_FROM"
fi
# Custom domain: only carried when both are set, and CERT_ARN is required
# when DOMAIN is — the stack hard-fails synth otherwise. They live in this
# environment's file; the cert ARN is added there only after the ACM cert
# has been validated (scripts/provision-cert.mjs).
if [ -n "${DOMAIN:-}" ]; then
  set -- "$@" -c "DOMAIN=$DOMAIN"
fi
if [ -n "${CERT_ARN:-}" ]; then
  set -- "$@" -c "CERT_ARN=$CERT_ARN"
fi
# Dev reports the commit it is running (/api/health); production leaves it
# unset and its health body carries no such key.
if [ -n "${DEPLOYED_COMMIT:-}" ]; then
  set -- "$@" -c "DEPLOYED_COMMIT=$DEPLOYED_COMMIT"
fi

# ---- helpers ------------------------------------------------------------
# A host that answers A or CNAME. A custom domain does not route until the
# records below are published.
#
# `dig` is a real dependency: without it every lookup "fails", and a dev
# deploy would take the unfinished-DNS path — printing records and exiting 0
# — while claiming a verification it never ran. A CI runner that lacks it
# stops here instead.
host_resolves() {
  command -v dig >/dev/null 2>&1 || {
    echo "dig is required to tell whether $1 routes (install dnsutils)" >&2
    exit 1
  }
  { dig +short A "$1" || dig +short CNAME "$1"; } | grep -q .
}

# The records a custom domain needs, as the DNS console wants them. Their
# targets only exist now that the deploy created the DomainName. Every
# DomainName gets its OWN regional endpoint (`d-…`): the www CNAME must
# point at www's, never the apex's, or API Gateway answers `403` before the
# Lambda runs. www is printed only when the stack has its own pair.
print_dns_records() {
  RD_NAME=$(stack_output ApiRegionalDomainName)
  RD_ZONE=$(stack_output ApiRegionalHostedZone)
  RD_NAME_WWW=$(stack_output ApiRegionalDomainNameForwww)
  echo "!! $DOMAIN does not resolve yet — publish these Porkbun records, then re-run:"
  echo "     apex  $DOMAIN        ALIAS  -> $RD_NAME   (hosted zone $RD_ZONE)"
  if [ "$RD_NAME_WWW" != "None" ] && [ -n "$RD_NAME_WWW" ]; then
    echo "     www   www.$DOMAIN    CNAME  -> $RD_NAME_WWW"
  fi
}

# ---- deploy -------------------------------------------------------------
cd "$ROOT/infra/cdk"

echo "==> cdk build"
# Bootstrapping the account is a one-time operator step with admin
# credentials, not part of a deploy: `cdk bootstrap` runs straight against
# CloudFormation, SSM, S3 and ECR, while the deploy identity may only assume
# the cdk-* bootstrap roles (`provision-oidc.mjs`). It lived here once, and
# the first dev deploy failed on cloudformation:DescribeStacks against the
# CDKToolkit stack — the line had only ever run under an admin identity.
# An account that is not bootstrapped yet gets CDK's own message, which names
# the command to run (infra/cdk/README.md, "First run").
bun run build

echo "==> deploy 1 (values in, PUBLIC_URL placeholder)"
npx cdk deploy "$STACK_NAME" --region "$REGION" --require-approval never "$@"

# The one public origin: the API, the SPA and the mail links all live on it
# (same-origin by design — no CORS to configure). A custom domain is stable
# and known here; without one, the HTTP API's generated URL is read off the
# stack. Dev always has a domain, so it never needs the read-back.
DOMAIN="${DOMAIN:-}"
if [ -n "$DOMAIN" ]; then
  URL="https://$DOMAIN"
else
  URL=$(stack_output ExecuteApiUrl)
  [ "$URL" != "None" ] && [ -n "$URL" ] || {
    echo "no ExecuteApiUrl output on $STACK_NAME — the deploy failed?" >&2
    exit 1
  }
fi

# Production's custom domain must route before the database is touched: the
# migrate and seed below write a new environment's data, and the verify
# pass has to reach the host. Publish the records and run again.
if [ "$ENV" = prod ] && [ -n "$DOMAIN" ] && ! host_resolves "$DOMAIN"; then
  print_dns_records
  exit 0
fi
echo "live URL: $URL"

# The seed's configuration is the deployed function's environment, so its
# name is read here rather than derived from the construct id.
FUNCTION_NAME=$(stack_output ApiFunctionName)
[ "$FUNCTION_NAME" != "None" ] && [ -n "$FUNCTION_NAME" ] || {
  echo "no ApiFunctionName output on $STACK_NAME — the deploy failed?" >&2
  exit 1
}

echo "==> db:migrate against $ENV"
( cd "$ROOT/packages/db" && DATABASE_URL="$DATABASE_URL" bunx drizzle-kit migrate )

echo "==> db:seed (owner account from SEED_* — idempotent)"
(
  cd "$ROOT/apps/api"
  # SEED_* comes from this environment's file, with the root .env as the
  # local fallback; either may be absent (CI has no root .env).
  set -a
  [ -f "$ROOT/.env" ] && . "$ROOT/.env"
  [ -f "$ENV_FILE" ] && . "$ENV_FILE"
  set +a
  # This environment's configuration is written once, in arcula-stack.ts
  # (the Lambda's environment), so it is read back rather than restated — a
  # variable added to the stack cannot be forgotten here. Only the public
  # origin is overridden: deploy 2 bakes the real one in, and the mail
  # links the seed may send have to land on it.
  FUNCTION_ENV=$(mktemp)
  SEED_ENV=$(mktemp)
  trap 'rm -f "$FUNCTION_ENV" "$SEED_ENV"' EXIT INT TERM
  aws lambda get-function-configuration --function-name "$FUNCTION_NAME" \
    --region "$REGION" --query 'Environment.Variables' --output json > "$FUNCTION_ENV"
  node "$ROOT/scripts/lambda-env-to-dotenv.mjs" "$FUNCTION_ENV" > "$SEED_ENV"
  set -a
  . "$SEED_ENV"
  set +a
  AUTH_BASE_URL="$URL" CLIENT_ORIGIN="$URL" CORS_ORIGINS="$URL" \
    bun scripts/db-seed.ts
)

echo "==> deploy 2 (PUBLIC_URL = $URL)"
npx cdk deploy "$STACK_NAME" --region "$REGION" --require-approval never "$@" \
  -c "PUBLIC_URL=$URL"

echo "==> verify"
# A host whose DNS is still unfinished is dev's case (production gated
# above): print the records it waits on and finish successfully, so the
# first deploy of an environment is not blocked by a console step.
if [ -n "$DOMAIN" ] && ! host_resolves "$DOMAIN"; then
  print_dns_records
  echo "==> $ENV deployed; verification waits on those records"
  exit 0
fi
( cd "$ROOT/apps/api" && bun scripts/deploy-verify.ts "$URL" )

echo "==> done. $ENV is live at: $URL"
