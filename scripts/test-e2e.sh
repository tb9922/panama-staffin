#!/usr/bin/env bash
# Run Playwright E2E tests against a disposable, fully migrated Postgres DB.
set -euo pipefail

COMPOSE_FILE="docker-compose.test.yml"

cleanup() {
  echo "Stopping E2E test database..."
  docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true
}
trap cleanup EXIT

echo "Starting E2E test database on port 5433..."
docker compose -f "$COMPOSE_FILE" up -d --wait

export DB_HOST=localhost
export DB_PORT=5433
export DB_NAME=panama_test
export DB_USER=panama
export DB_PASSWORD=test_password
export DB_SSL=false
export JWT_SECRET=ci_test_jwt_secret_not_used_in_prod_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export ADMIN_PASSWORD_HASH='$2b$12$placeholder_not_used_in_e2e_tests_xxxxxxxxxxxxxx'
export VIEWER_PASSWORD_HASH='$2b$12$placeholder_not_used_in_e2e_tests_xxxxxxxxxxxxxx'
export ALLOWED_ORIGIN="${E2E_BASE_URL:-http://localhost:5173}"

echo "Running migrations..."
node scripts/migrate.js

echo "Running Playwright E2E tests..."
npx playwright test "$@"

echo "E2E done."
