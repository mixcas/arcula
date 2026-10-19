#!/bin/sh
# The per-environment facts and helpers the build and deploy scripts share.
# Sourced, never run directly: the caller sets ROOT (the repo root) and a
# validated ENV (prod | dev) before sourcing it, and reads back STACK_NAME,
# LAMBDA_ARTIFACT, ENV_FILE and REGION.
#
# The stack name and the artifact name are read off the CDK app's own table
# (infra/cdk/src/environments.ts) rather than restated here, so the shell
# cannot drift from the stack it deploys. What is shell-only — which file
# holds this environment's values, and how to read it — lives here.

: "${ROOT:?environment.sh expects ROOT to be set}"

REGION=us-east-1

# `eval`'d shell assignments, not JSON: there is no jq in this toolbox, and
# the values (a stack name, a filename) are plain words.
eval "$(
  ARCULA_ROOT="$ROOT" ENV_NAME="$ENV" bun -e '
    const { ENVIRONMENTS } = await import(
      `${process.env.ARCULA_ROOT}/infra/cdk/src/environments.ts`
    );
    const config = ENVIRONMENTS[process.env.ENV_NAME];
    if (!config) {
      console.error(`unknown environment: ${process.env.ENV_NAME}`);
      process.exit(2);
    }
    process.stdout.write(
      `STACK_NAME=${config.stackName}\nLAMBDA_ARTIFACT=${config.lambdaArtifact}\n`,
    );
  '
)"
[ -n "${STACK_NAME:-}" ] || {
  echo "could not resolve ENV '${ENV:-}' from infra/cdk/src/environments.ts" >&2
  exit 1
}

# This environment's values live in infra/cdk/.env.<env>. Production also
# accepts the shared infra/cdk/.env, the only file it has ever had. Dev has
# no fallback on purpose: falling back would put production's database URL
# and auth secret into a dev deploy, which is the one thing the two
# environments must never share.
#
# Whether the file exists is the caller's check, not this file's: a build
# needs the environment's identity but not its secrets.
ENV_FILE="$ROOT/infra/cdk/.env.$ENV"
if [ "$ENV" = prod ] && [ ! -f "$ENV_FILE" ] && [ -f "$ROOT/infra/cdk/.env" ]; then
  ENV_FILE="$ROOT/infra/cdk/.env"
fi

# load_env — source this environment's file, exported, or stop. The script
# that needs the values is the one that says so.
load_env() {
  [ -f "$ENV_FILE" ] || {
    echo "missing $ENV_FILE" >&2
    exit 1
  }
  set -a
  . "$ENV_FILE"
  set +a
}

# require_env NAME VALUE — a value the environment's file must have
# supplied, or a name to the error.
require_env() {
  [ -n "$2" ] || {
    echo "$1 is empty in $ENV_FILE" >&2
    exit 1
  }
}

# stack_output KEY — one CloudFormation output off this environment's stack.
# Every deploy reads back what it created rather than restating it.
stack_output() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text
}
