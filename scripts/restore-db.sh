#!/bin/bash
#
# Panama Staffing — PostgreSQL restore script
#
# Usage:
#   ./scripts/restore-db.sh backups/db/panama_20260227_020000.sql.gz
#   ./scripts/restore-db.sh backups/db/panama_20260227_020000.sql.gz.gpg
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ -f "${SCRIPT_DIR}/load-env-file.sh" ]; then
  # shellcheck source=scripts/load-env-file.sh
  . "${SCRIPT_DIR}/load-env-file.sh"
  load_env_keys "${APP_DIR}/.env" DB_PASSWORD DB_HOST DB_PORT DB_USER
  if [ "${RESTORE_USE_ENV_DB:-false}" = "true" ]; then
    load_env_keys "${APP_DIR}/.env" DB_NAME
  fi
fi

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

if ! [[ "${DB_NAME}" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "ERROR: DB_NAME must contain only letters, numbers and underscores."
  exit 1
fi

echo "=== Panama DB Restore ==="
echo "  Source: ${BACKUP_FILE}"
echo "  Target: ${DB_NAME} @ ${DB_HOST}:${DB_PORT}"
echo ""

# Safety check — refuse to restore over production without explicit override
if [ "${DB_NAME}" != "panama_restore" ]; then
  if [ "${FORCE_RESTORE_DB:-false}" != "true" ]; then
    echo "WARNING: You are about to DROP and recreate '${DB_NAME}'."
    echo "This will destroy all existing data in that database."
    read -p "Type the database name to confirm: " CONFIRM
    if [ "${CONFIRM}" != "${DB_NAME}" ]; then
      echo "Aborted."
      exit 1
    fi
  fi
fi

# ── Auth — use .pgpass instead of PGPASSWORD to avoid /proc leak ─────────────

export PGPASSFILE="$(mktemp)"
echo "${DB_HOST}:${DB_PORT}:*:${DB_USER}:${DB_PASSWORD:?DB_PASSWORD is required}" > "$PGPASSFILE"
chmod 600 "$PGPASSFILE"
cleanup() {
  if [ -n "${VERIFY_DB:-}" ]; then
    dropdb -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" --if-exists "${VERIFY_DB}" >/dev/null 2>&1 || true
  fi
  rm -f "$PGPASSFILE"
}
trap cleanup EXIT

restore_backup_into() {
  local target_db="$1"
  if [[ "${BACKUP_FILE}" == *.gpg ]]; then
    gpg --batch --decrypt "${BACKUP_FILE}" | gzip -dc | psql \
      -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
      -d "${target_db}" \
      --quiet \
      --single-transaction
  else
    gzip -dc "${BACKUP_FILE}" | psql \
      -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
      -d "${target_db}" \
      --quiet \
      --single-transaction
  fi
}

table_count_for() {
  local target_db="$1"
  psql \
    -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
    -d "${target_db}" -t -c \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"
}

if [ "${DB_NAME}" != "panama_restore" ] && [ "${SKIP_PRE_RESTORE_VERIFY:-false}" != "true" ]; then
  VERIFY_DB="${DB_NAME}_restore_check_$$"
  echo "[$(date --iso-8601=seconds)] Verifying backup into temporary database ${VERIFY_DB} before touching ${DB_NAME}..."
  dropdb \
    -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
    --if-exists "${VERIFY_DB}" >/dev/null 2>&1 || true
  createdb \
    -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
    "${VERIFY_DB}"
  if ! restore_backup_into "${VERIFY_DB}"; then
    echo "ERROR: Backup failed to restore into temporary database. Target database was not modified."
    exit 1
  fi
  VERIFY_TABLES="$(table_count_for "${VERIFY_DB}" | tr -d '[:space:]')"
  if [ -z "${VERIFY_TABLES}" ] || [ "${VERIFY_TABLES}" = "0" ]; then
    echo "ERROR: Temporary restore produced no public tables. Target database was not modified."
    exit 1
  fi
  dropdb \
    -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
    --if-exists "${VERIFY_DB}" >/dev/null 2>&1 || true
  VERIFY_DB=""
fi

# ── Drop and recreate ────────────────────────────────────────────────────────

echo "[$(date --iso-8601=seconds)] Dropping ${DB_NAME} (if exists)..."
psql \
  -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
  -d postgres \
  --quiet \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" \
  > /dev/null
dropdb \
  -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
  --if-exists "${DB_NAME}"

echo "[$(date --iso-8601=seconds)] Creating ${DB_NAME}..."
createdb \
  -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
  "${DB_NAME}"

# ── Restore ───────────────────────────────────────────────────────────────────

echo "[$(date --iso-8601=seconds)] Restoring from ${BACKUP_FILE}..."
restore_backup_into "${DB_NAME}"

# ── Verify ────────────────────────────────────────────────────────────────────

echo "[$(date --iso-8601=seconds)] Verifying..."
TABLES=$(table_count_for "${DB_NAME}")

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
