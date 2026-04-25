#!/bin/bash
#
# Panama Staffing — Backup verification script
#
# Restores the latest backup to a temporary DB, compares row counts
# against the live database, and reports pass/fail.
#
# Usage:
#   ./scripts/verify-backup.sh                             # verify latest backup
#   BACKUP_FILE=path/to.sql.gz ./scripts/verify-backup.sh  # verify specific backup
#
# Cron (weekly at 3am Sunday, after 2am daily backup):
#   0 3 * * 0 /var/www/panama-staffing/scripts/verify-backup.sh >> /var/log/panama-verify.log 2>&1
#
# Optional: set HEALTHCHECK_URL for Healthchecks.io ping on success/failure
#   HEALTHCHECK_URL=https://hc-ping.com/your-uuid-here
#
# Requires: psql, gzip, pg_dump (via restore-db.sh)

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

BACKUP_DIR="${BACKUP_DIR:-./backups/db}"
VERIFY_DB="panama_verify_$$"  # PID-suffixed to avoid collisions

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-panama_dev}"
DB_USER="${DB_USER:-panama}"

# Max allowed drift between live and restored counts (percentage)
MAX_DRIFT_PCT="${MAX_DRIFT_PCT:-5}"

# Tables to compare (core tables that must exist and have data)
TABLES=(
  staff homes shift_overrides training_records supervisions appraisals
  incidents complaints maintenance ipc_audits risk_register policy_reviews
  payroll_runs payroll_lines
)

# ── Auth ──────────────────────────────────────────────────────────────────────

export PGPASSFILE="$(mktemp)"
echo "${DB_HOST}:${DB_PORT}:*:${DB_USER}:${DB_PASSWORD:?DB_PASSWORD is required}" > "$PGPASSFILE"
chmod 600 "$PGPASSFILE"

cleanup() {
  echo "[$(date --iso-8601=seconds)] Cleaning up..."
  dropdb -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" --if-exists "${VERIFY_DB}" 2>/dev/null || true
  rm -f "$PGPASSFILE"
}
trap cleanup EXIT

# ── Find latest backup ───────────────────────────────────────────────────────

if [ -n "${BACKUP_FILE:-}" ]; then
  LATEST="${BACKUP_FILE}"
else
  LATEST=$(ls -t "${BACKUP_DIR}"/panama_*.sql.gz 2>/dev/null | head -1)
fi

if [ -z "${LATEST}" ] || [ ! -f "${LATEST}" ]; then
  echo "[$(date --iso-8601=seconds)] FAIL: No backup file found in ${BACKUP_DIR}"
  [ -n "${HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 "${HEALTHCHECK_URL}/fail" -d "No backup file found" || true
  exit 1
fi

echo "[$(date --iso-8601=seconds)] Verifying backup: ${LATEST}"
echo "[$(date --iso-8601=seconds)] Restore target: ${VERIFY_DB}"

# ── Restore to temporary DB ──────────────────────────────────────────────────

createdb -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" "${VERIFY_DB}"

gzip -dc "${LATEST}" | psql \
  -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
  -d "${VERIFY_DB}" \
  --quiet --single-transaction 2>/dev/null

echo "[$(date --iso-8601=seconds)] Restore complete, comparing counts..."

# ── Compare row counts ───────────────────────────────────────────────────────

FAILURES=0
REPORT=""

for TABLE in "${TABLES[@]}"; do
  # Get live count (skip if table doesn't exist yet)
  LIVE=$(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
    -d "${DB_NAME}" -t -A -c \
    "SELECT COUNT(*) FROM ${TABLE}" 2>/dev/null) || continue

  # Get restored count
  RESTORED=$(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
    -d "${VERIFY_DB}" -t -A -c \
    "SELECT COUNT(*) FROM ${TABLE}" 2>/dev/null) || { RESTORED=0; }

  # Calculate drift
  if [ "${LIVE}" -eq 0 ] && [ "${RESTORED}" -eq 0 ]; then
    DRIFT=0
  elif [ "${LIVE}" -eq 0 ]; then
    DRIFT=100
  else
    DRIFT=$(( (LIVE - RESTORED) * 100 / LIVE ))
    # Absolute value
    [ "${DRIFT}" -lt 0 ] && DRIFT=$(( -DRIFT ))
  fi

  STATUS="OK"
  if [ "${DRIFT}" -gt "${MAX_DRIFT_PCT}" ]; then
    STATUS="DRIFT"
    FAILURES=$((FAILURES + 1))
  fi

  LINE="${TABLE}: live=${LIVE} restored=${RESTORED} drift=${DRIFT}% [${STATUS}]"
  REPORT="${REPORT}${LINE}\n"
  echo "[$(date --iso-8601=seconds)] ${LINE}"
done

# ── Check migration version ──────────────────────────────────────────────────

LIVE_MIG=$(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
  -d "${DB_NAME}" -t -A -c \
  "SELECT MAX(id) FROM migrations" 2>/dev/null) || LIVE_MIG="?"

RESTORED_MIG=$(psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
  -d "${VERIFY_DB}" -t -A -c \
  "SELECT MAX(id) FROM migrations" 2>/dev/null) || RESTORED_MIG="?"

echo "[$(date --iso-8601=seconds)] Migrations: live=${LIVE_MIG} restored=${RESTORED_MIG}"

if [ "${LIVE_MIG}" != "${RESTORED_MIG}" ] && [ "${LIVE_MIG}" != "?" ]; then
  echo "[$(date --iso-8601=seconds)] WARNING: Migration version mismatch (backup may be from before a deploy)"
fi

# ── Result ────────────────────────────────────────────────────────────────────

echo ""
if [ "${FAILURES}" -eq 0 ]; then
  echo "[$(date --iso-8601=seconds)] PASS: Backup verified (${LATEST})"
  [ -n "${HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 "${HEALTHCHECK_URL}" -d "Verified: ${LATEST}" || true
  exit 0
else
  echo "[$(date --iso-8601=seconds)] FAIL: ${FAILURES} table(s) exceeded ${MAX_DRIFT_PCT}% drift"
  [ -n "${HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 "${HEALTHCHECK_URL}/fail" -d "${FAILURES} tables drifted" || true
  exit 1
fi
