#!/usr/bin/env bash
# Run integration tests against a disposable Postgres container.
# Usage: bash scripts/test-integration.sh
set -euo pipefail

COMPOSE_FILE="docker-compose.test.yml"

cleanup() {
  echo "Stopping test database..."
  docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true
}
trap cleanup EXIT

echo "Starting test database on port 5433..."
docker compose -f "$COMPOSE_FILE" up -d --wait

export DB_HOST=localhost
export DB_PORT=5433
export DB_NAME=panama_test
export DB_USER=panama
export DB_PASSWORD=test_password
export JWT_SECRET=ci_test_jwt_secret_not_used_in_prod_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export ADMIN_PASSWORD_HASH='$2b$12$placeholder_not_used_in_unit_tests_xxxxxxxxxxx'
export VIEWER_PASSWORD_HASH='$2b$12$placeholder_not_used_in_unit_tests_xxxxxxxxxxx'
export ALLOWED_ORIGIN=http://localhost:5173

echo "Running migrations..."
node scripts/migrate.js

echo "Running all tests (unit + integration)..."
npx vitest run

echo "Done."
