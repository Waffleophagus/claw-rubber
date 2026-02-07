#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: bun run test:integration <base_url> [bearer_token]"
  echo "Example: bun run test:integration https://proxy.example.com"
  exit 1
fi

BASE_URL="$1"
TOKEN="${2:-}"

export CLAWRUBBER_INTEGRATION_BASE_URL="$BASE_URL"
if [ -n "$TOKEN" ]; then
  export CLAWRUBBER_INTEGRATION_BEARER_TOKEN="$TOKEN"
fi

exec bun test \
  ./test/integration/health.integration.ts \
  ./test/integration/search-fetch.integration.ts \
  ./test/integration/web-fetch.integration.ts \
  ./test/integration/routing.integration.ts
