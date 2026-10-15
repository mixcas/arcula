#!/bin/sh
# Deploy the beta stack (Phase 6 S5; §10.4's "every later deploy" flow).
# Usage: sh scripts/deploy-prod.sh
#
# Prereqs: aws configured (us-east-1); infra/cdk/.env populated
# (DATABASE_URL, RESEND_API_KEY, AUTH_SECRET — see the S5 handoff);
# a Lambda package present (sh scripts/build-lambda.sh — checked below,
# not rebuilt here). The local stack may be up or down: db-seed's own
# stack-up check is idempotent.
#
# Flow: build the CDK app → bootstrap (idempotent) → deploy 1 (real
# values, placeholder PUBLIC_URL) → read the live API URL → db:migrate +
# db:seed against the prod DATABASE_URL (the seed creates the owner
# account from the root .env's SEED_* — prod is an empty DB, so seeding
# IS the bootstrap) → deploy 2 (PUBLIC_URL = the live URL — the Lambda
# is stateless, so the re-deploy is free) → prod-verify against it.
#
# Values are read from infra/cdk/.env and never echoed.

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE="$ROOT/infra/cdk/.env"
STACK_NAME="Arcula"

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE (DATABASE_URL, RESEND_API_KEY, AUTH_SECRET)"; exit 1; }
set -a
. "$ENV_FILE"
set +a
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL is empty in $ENV_FILE"; exit 1; }
[ -n "$RESEND_API_KEY" ] || { echo "RESEND_API_KEY is empty in $ENV_FILE"; exit 1; }
[ -n "$AUTH_SECRET" ] || { echo "AUTH_SECRET is empty in $ENV_FILE"; exit 1; }
[ -f "$ROOT/dist/lambda/arcula-api.zip" ] || {
  echo "missing dist/lambda/arcula-api.zip — run: sh scripts/build-lambda.sh"; exit 1;
}

# Keep the prod values under their own names: the seed subshell sources
# the root .env (for SEED_*), which would otherwise shadow them.
PROD_DATABASE_URL="$DATABASE_URL"
PROD_AUTH_SECRET="$AUTH_SECRET"
PROD_RESEND_KEY="$RESEND_API_KEY"

CTX="-c DATABASE_URL=$DATABASE_URL -c AUTH_SECRET=$AUTH_SECRET -c RESEND_API_KEY=$RESEND_API_KEY"
[ -n "${EMAIL_FROM:-}" ] && CTX="$CTX -c EMAIL_FROM=$EMAIL_FROM"
# Phase 7 custom domain (§10.3): only carried when both are set, and
# CERT_ARN is required when DOMAIN is — the stack hard-fails synth
# otherwise. They live in infra/cdk/.env; the cert ARN is added there
# only after the ACM cert has been validated.
[ -n "${DOMAIN:-}" ] && CTX="$CTX -c DOMAIN=$DOMAIN"
[ -n "${CERT_ARN:-}" ] && CTX="$CTX -c CERT_ARN=$CERT_ARN"

cd "$ROOT/infra/cdk"

echo "==> cdk build + bootstrap (idempotent)"
bun run build
npx cdk bootstrap --region us-east-1

echo "==> deploy 1 (values in, PUBLIC_URL placeholder)"
npx cdk deploy --region us-east-1 --require-approval never $CTX

BUCKET=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='MediaBucket'].OutputValue | [0]" --output text)
if [ -n "${DOMAIN:-}" ]; then
  # Custom domain (§10.3): the public origin is the domain itself — its
  # cert is validated before this deploy runs — so the seed's mail links
  # and the deploy-2 PUBLIC_URL both point at it.
  URL="https://${DOMAIN}"
  # The domain does not resolve until the apex ALIAS + www CNAME are
  # published (their target — the regional endpoint — only exists now that
  # this deploy provisioned the DomainName). prod-verify runs against the
  # host, so the rest of the flow (migrate/seed/deploy-2/verify) must not
  # start until it actually routes. Gate on it: the first run prints the
  # Porkbun records and exits; a re-run once they resolve continues.
  RD_NAME=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='ApiRegionalDomainName'].OutputValue | [0]" --output text)
  RD_ZONE=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='ApiRegionalHostedZone'].OutputValue | [0]" --output text)
  # www is its OWN DomainName, so it has its own regional endpoint — never
  # reuse the apex target here, or the CNAME resolves to a host that 403s.
  RD_NAME_WWW=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='ApiRegionalDomainNameForwww'].OutputValue | [0]" --output text)
  if ! { dig +short A "$DOMAIN" || dig +short CNAME "$DOMAIN"; } | grep -q .; then
    echo "!! $DOMAIN does not resolve yet — publish these Porkbun records, then re-run:"
    echo "     apex  $DOMAIN        ALIAS  -> $RD_NAME   (hosted zone $RD_ZONE)"
    echo "     www   www.$DOMAIN    CNAME  -> $RD_NAME_WWW"
    exit 0
  fi
else
  URL=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='ExecuteApiUrl'].OutputValue | [0]" --output text)
  [ "$URL" != "None" ] && [ -n "$URL" ] || { echo "no ExecuteApiUrl output — deploy failed?"; exit 1; }
fi
echo "live URL: $URL"

echo "==> db:migrate against prod"
( cd "$ROOT/packages/db" && DATABASE_URL="$PROD_DATABASE_URL" bunx drizzle-kit migrate )

echo "==> db:seed (owner account from SEED_* — idempotent)"
(
  cd "$ROOT/apps/api"
  set -a
  . "$ROOT/.env" # SEED_* lives here; the prod overrides below win
  set +a
  DATABASE_URL="$PROD_DATABASE_URL" \
  AUTH_SECRET="$PROD_AUTH_SECRET" \
  AUTH_BASE_URL="$URL" \
  CLIENT_ORIGIN="$URL" \
  CORS_ORIGINS="$URL" \
  EMAIL_PROVIDER="resend" \
  RESEND_API_KEY="$PROD_RESEND_KEY" \
  S3_ENDPOINT="https://s3.us-east-1.amazonaws.com" \
  S3_REGION="us-east-1" \
  S3_BUCKET="$BUCKET" \
  bun scripts/db-seed.ts
)

echo "==> deploy 2 (PUBLIC_URL = $URL)"
npx cdk deploy --region us-east-1 --require-approval never $CTX -c PUBLIC_URL="$URL"

echo "==> verify"
( cd "$ROOT/apps/api" && bun scripts/prod-verify.ts "$URL" )

echo "==> done. The beta is live at: $URL"
