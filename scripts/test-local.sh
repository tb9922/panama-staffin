#!/bin/bash
#
# Run the full test suite locally.
#
# Prerequisites:
#   - Docker Desktop running with postgres:16-alpine via docker compose
#   - npm ci already run
#
# Usage:
#   ./scripts/test-local.sh           # run all tests
#   ./scripts/test-local.sh backend   # backend only
#   ./scripts/test-local.sh frontend  # frontend only

set -euo pipefail

# Load test environment
set -a
source .env.test
set +a

echo "=== Running migrations ==="
node scripts/migrate.js

if [ "${1:-all}" = "frontend" ]; then
  echo "=== Running frontend tests ==="
  npm run test:frontend
elif [ "${1:-all}" = "backend" ]; then
  echo "=== Running backend tests ==="
  npm test
else
  echo "=== Running backend tests ==="
  npm test

  echo "=== Running frontend tests ==="
  npm run test:frontend

  echo "=== Running route audit ==="
  npm run audit:routes
fi

echo "=== All tests passed ==="
