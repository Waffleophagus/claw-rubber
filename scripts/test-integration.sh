#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ge 1 ]; then
  export CLAWRUBBER_INTEGRATION_BASE_URL="$1"
fi
if [ "$#" -ge 2 ]; then
  export CLAWRUBBER_INTEGRATION_BEARER_TOKEN="$2"
fi

exec bun test \
  ./test/integration/health.integration.ts \
  ./test/integration/search-fetch.integration.ts \
  ./test/integration/routing.integration.ts \
  ./test/integration/web-fetch.integration.ts
