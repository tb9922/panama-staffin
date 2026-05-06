#!/usr/bin/env bash
# Run staffing-focused integration tests against a disposable Postgres container.
set -euo pipefail

COMPOSE_FILE="docker-compose.test.yml"
COMPOSE_ENV_FILE="docker-compose.test.env"
COMPOSE=(docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE")

cleanup() {
  echo "Stopping test database..."
  "${COMPOSE[@]}" down -v 2>/dev/null || true
}
trap cleanup EXIT

echo "Starting test database on port 5433..."
"${COMPOSE[@]}" up -d --wait

export DB_HOST=localhost
export DB_PORT=5433
export DB_NAME=panama_test
export DB_USER=panama
export DB_PASSWORD=test_password
export DB_SSL=false
export JWT_SECRET=ci_test_jwt_secret_not_used_in_prod_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export ADMIN_PASSWORD_HASH='$2b$12$placeholder_not_used_in_unit_tests_xxxxxxxxxxx'
export VIEWER_PASSWORD_HASH='$2b$12$placeholder_not_used_in_unit_tests_xxxxxxxxxxx'
export ALLOWED_ORIGIN=http://localhost:5173

echo "Running migrations..."
node scripts/migrate.js

echo "Running staffing integration tests..."
npx vitest run \
  tests/integration/staff.test.js \
  tests/integration/onboarding.test.js \
  tests/integration/import.test.js \
  tests/integration/staffAuth.test.js \
  tests/integration/staffPortal.test.js \
  tests/integration/training.test.js \
  tests/integration/trainingRoutes.test.js \
  tests/integration/attachmentDownloadSafety.test.js \
  tests/integration/gdpr.test.js

echo "Done."
