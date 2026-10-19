#!/bin/sh
# Deploy production end to end.
# Usage: sh scripts/deploy-prod.sh
#
# A thin wrapper: the sequence is scripts/deploy.sh, shared with dev, so a
# fix cannot land on one environment and miss the other. See that file for
# the flow, the prereqs and the values it reads.

set -eu

exec sh "$(cd "$(dirname "$0")" && pwd)/deploy.sh" prod
