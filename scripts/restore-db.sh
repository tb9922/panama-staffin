#!/bin/bash
#
# Panama Staffing — PostgreSQL restore script
#
# Usage:
#   ./scripts/restore-db.sh backups/db/panama_20260227_020000.sql.gz
#   DB_NAME=panama_restore ./scripts/restore-db.sh backups/db/panama_20260227_020000.sql.gz
#
# IMPORTANT: This drops and recreates the target database.
# Test restorations should use a separate DB name (e.g. panama_restore).
#
# Monthly restore test checklist:
#   1. ./scripts/restore-db.sh backup.sql.gz          (restore to panama_restore)
#   2. DB_NAME=panama_restore node scripts/migrate.js  (verify migrations)
#   3. Spot-check: psql panama_restore -c "SELECT COUNT(*) FROM staff"
#   4. dropdb panama_restore                            (cleanup)

set -euo pipefail

# ── Validate input ────────────────────────────────────────────────────────────

BACKUP_FILE="${1:?Usage: restore-db.sh <backup-file.sql.gz>}"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "ERROR: File not found: ${BACKUP_FILE}"
  exit 1
fi

# ── Configuration ─────────────────────────────────────────────────────────────

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-panama_restore}"
DB_USER="${DB_USER:-panama}"

echo "=== Panama DB Restore ==="
echo "  Source: ${BACKUP_FILE}"
echo "  Target: ${DB_NAME} @ ${DB_HOST}:${DB_PORT}"
echo ""

# Safety check — refuse to restore over production without explicit override
if [ "${DB_NAME}" = "panama_dev" ] || [ "${DB_NAME}" = "panama_prod" ]; then
  echo "WARNING: You are about to DROP and recreate '${DB_NAME}'."
  echo "This will destroy all existing data in that database."
  read -p "Type the database name to confirm: " CONFIRM
  if [ "${CONFIRM}" != "${DB_NAME}" ]; then
    echo "Aborted."
    exit 1
  fi
fi

# ── Auth — use .pgpass instead of PGPASSWORD to avoid /proc leak ─────────────

export PGPASSFILE="$(mktemp)"
echo "${DB_HOST}:${DB_PORT}:*:${DB_USER}:${DB_PASSWORD:?DB_PASSWORD is required}" > "$PGPASSFILE"
chmod 600 "$PGPASSFILE"
trap 'rm -f "$PGPASSFILE"' EXIT

# ── Drop and recreate ────────────────────────────────────────────────────────

echo "[$(date --iso-8601=seconds)] Dropping ${DB_NAME} (if exists)..."
dropdb \
  -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
  --if-exists "${DB_NAME}"

echo "[$(date --iso-8601=seconds)] Creating ${DB_NAME}..."
createdb \
  -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
  "${DB_NAME}"

# ── Restore ───────────────────────────────────────────────────────────────────

echo "[$(date --iso-8601=seconds)] Restoring from ${BACKUP_FILE}..."
gzip -dc "${BACKUP_FILE}" | psql \
  -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --quiet \
  --single-transaction

# ── Verify ────────────────────────────────────────────────────────────────────

echo "[$(date --iso-8601=seconds)] Verifying..."
TABLES=$(psql \
  -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
  -d "${DB_NAME}" -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'")

STAFF=$(psql \
  -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
  -d "${DB_NAME}" -t -c \
  "SELECT COUNT(*) FROM staff" 2>/dev/null || echo "  0")

echo "[$(date --iso-8601=seconds)] Restore complete:"
echo "  Tables: ${TABLES}"
echo "  Staff records: ${STAFF}"
echo ""
echo "Next steps:"
echo "  1. Run migrations: DB_NAME=${DB_NAME} node scripts/migrate.js"
echo "  2. Spot-check data: psql ${DB_NAME} -c \"SELECT id, name FROM homes\""
echo "  3. Cleanup test DB: dropdb ${DB_NAME}"
