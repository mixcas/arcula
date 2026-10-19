#!/bin/sh
# Deploy the dev environment end to end.
# Usage: sh scripts/deploy-dev.sh
#
# A thin wrapper: the sequence is scripts/deploy.sh, shared with production,
# so a fix cannot land on one environment and miss the other. Dev differs
# only in knowing its own host up front (no two-step URL discovery) and in
# tolerating DNS that is still unfinished when it verifies.

set -eu

exec sh "$(cd "$(dirname "$0")" && pwd)/deploy.sh" dev
