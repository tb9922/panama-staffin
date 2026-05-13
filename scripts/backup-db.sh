#!/bin/bash
#
# Panama Staffing — PostgreSQL backup script
#
# Usage:
#   ./scripts/backup-db.sh                    # backup with defaults
#   BACKUP_DIR=/mnt/nas ./scripts/backup-db.sh  # custom backup directory
#
# Cron (daily at 2am, Monday-Saturday):
#   0 2 * * 1-6 cd /var/www/panama-staffing && ./scripts/backup-db.sh >> /var/log/panama-backup.log 2>&1
#
# Cron (Sunday at 2am, with full restore verification):
#   0 2 * * 0 cd /var/www/panama-staffing && VERIFY_AFTER_BACKUP=true ./scripts/backup-db.sh >> /var/log/panama-backup.log 2>&1
#
# Requires: pg_dump, gzip
# Optional: aws CLI (for S3 offsite), or rclone, or scp to NAS

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ -f "${SCRIPT_DIR}/load-env-file.sh" ]; then
  # shellcheck source=scripts/load-env-file.sh
  . "${SCRIPT_DIR}/load-env-file.sh"
  load_env_keys "${APP_DIR}/.env" \
    DB_PASSWORD DB_NAME DB_HOST DB_PORT DB_USER \
    BACKUP_S3_BUCKET BACKUP_SCP_TARGET HEALTHCHECK_URL \
    BACKUP_GPG_RECIPIENT BACKUP_REQUIRE_ENCRYPTION BACKUP_KEEP_PLAINTEXT \
    NODE_ENV BACKUP_REQUIRE_OFFSITE BACKUP_ALLOW_LOCAL_ONLY
fi

: "${DB_PASSWORD:?DB_PASSWORD is required}"
: "${DB_NAME:?DB_NAME is required (e.g. panama_dev or panama_prod)}"

# ── Configuration ─────────────────────────────────────────────────────────────

BACKUP_DIR="${BACKUP_DIR:-${APP_DIR}/backups/db}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="panama_${TIMESTAMP}.sql.gz"
BACKUP_FILE="${BACKUP_DIR}/${FILENAME}"

# Database connection — reads from environment or defaults
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-panama}"

# ── Setup ─────────────────────────────────────────────────────────────────────

mkdir -p "${BACKUP_DIR}"

if [ -z "${BACKUP_GPG_RECIPIENT:-}" ] && {
  [ "${BACKUP_REQUIRE_ENCRYPTION:-false}" = "true" ] || {
    [ "${NODE_ENV:-}" = "production" ] && [ "${BACKUP_ALLOW_LOCAL_ONLY:-false}" != "true" ];
  };
}; then
  echo "[$(date --iso-8601=seconds)] ERROR: BACKUP_GPG_RECIPIENT is required for encrypted regulated backups."
  exit 1
fi

echo "[$(date --iso-8601=seconds)] Starting backup: ${FILENAME}"

# ── Dump ──────────────────────────────────────────────────────────────────────

export PGPASSFILE="$(mktemp)"
echo "${DB_HOST}:${DB_PORT}:${DB_NAME}:${DB_USER}:${DB_PASSWORD}" > "$PGPASSFILE"
chmod 600 "$PGPASSFILE"
trap 'rm -f "$PGPASSFILE"' EXIT

pg_dump \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --no-owner \
  --no-privileges \
  --format=plain \
  | gzip > "${BACKUP_FILE}"

SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "[$(date --iso-8601=seconds)] Backup complete: ${FILENAME} (${SIZE})"

# ── Verify ────────────────────────────────────────────────────────────────────

# Quick integrity check — decompress and count lines
LINES=$(gzip -dc "${BACKUP_FILE}" | wc -l)
if [ "${LINES}" -lt 100 ]; then
  echo "[$(date --iso-8601=seconds)] WARNING: Backup suspiciously small (${LINES} lines). Check DB connectivity."
  exit 1
fi
echo "[$(date --iso-8601=seconds)] Verified: ${LINES} lines"

FINAL_BACKUP_FILE="${BACKUP_FILE}"
FINAL_FILENAME="${FILENAME}"
if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  FINAL_BACKUP_FILE="${BACKUP_FILE}.gpg"
  FINAL_FILENAME="${FILENAME}.gpg"
  echo "[$(date --iso-8601=seconds)] Encrypting backup for ${BACKUP_GPG_RECIPIENT}"
  gpg --batch --yes --trust-model always \
    --output "${FINAL_BACKUP_FILE}" \
    --encrypt --recipient "${BACKUP_GPG_RECIPIENT}" \
    "${BACKUP_FILE}"
  if [ "${BACKUP_KEEP_PLAINTEXT:-false}" != "true" ]; then
    rm -f "${BACKUP_FILE}"
    echo "[$(date --iso-8601=seconds)] Removed plaintext local backup after encryption"
  fi
elif [ "${BACKUP_REQUIRE_ENCRYPTION:-false}" = "true" ] || { [ "${NODE_ENV:-}" = "production" ] && [ "${BACKUP_ALLOW_LOCAL_ONLY:-false}" != "true" ]; }; then
  echo "[$(date --iso-8601=seconds)] ERROR: BACKUP_GPG_RECIPIENT is required for encrypted regulated backups."
  exit 1
fi

# ── Checksum ────────────────────────────────────────────────────────────────

sha256sum "${FINAL_BACKUP_FILE}" > "${FINAL_BACKUP_FILE}.sha256"
echo "[$(date --iso-8601=seconds)] Checksum: ${FINAL_BACKUP_FILE}.sha256"

# ── Full restore verification (optional) ────────────────────────────────────

if [ "${VERIFY_AFTER_BACKUP:-false}" = "true" ] && [ -f "${SCRIPT_DIR}/verify-backup.sh" ]; then
  echo "[$(date --iso-8601=seconds)] Running restore verification..."
  BACKUP_FILE="${FINAL_BACKUP_FILE}" bash "${SCRIPT_DIR}/verify-backup.sh"
  echo "[$(date --iso-8601=seconds)] Restore verification passed"
fi

# ── Offsite upload (auto-detected from env vars) ──────────────────────────────

OFFSITE_CONFIGURED=false
if [ -n "${BACKUP_S3_BUCKET:-}" ] || [ -n "${BACKUP_SCP_TARGET:-}" ]; then
  OFFSITE_CONFIGURED=true
fi

if [ "${OFFSITE_CONFIGURED}" != "true" ]; then
  if [ "${BACKUP_REQUIRE_OFFSITE:-false}" = "true" ]; then
    echo "[$(date --iso-8601=seconds)] ERROR: BACKUP_REQUIRE_OFFSITE=true but BACKUP_S3_BUCKET/BACKUP_SCP_TARGET is not configured."
    exit 1
  fi
  if [ "${NODE_ENV:-}" = "production" ] && [ "${BACKUP_ALLOW_LOCAL_ONLY:-false}" != "true" ]; then
    echo "[$(date --iso-8601=seconds)] WARNING: Production backup has no offsite target. Configure BACKUP_S3_BUCKET or BACKUP_SCP_TARGET, or set BACKUP_REQUIRE_OFFSITE=true to make this a hard release gate."
  fi
fi

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  echo "[$(date --iso-8601=seconds)] Uploading DB backup to S3: ${BACKUP_S3_BUCKET}"
  aws s3 cp "${FINAL_BACKUP_FILE}" "s3://${BACKUP_S3_BUCKET}/${FINAL_FILENAME}"
  aws s3 cp "${FINAL_BACKUP_FILE}.sha256" "s3://${BACKUP_S3_BUCKET}/${FINAL_FILENAME}.sha256"
  echo "[$(date --iso-8601=seconds)] S3 upload complete"
elif [ -n "${BACKUP_SCP_TARGET:-}" ]; then
  echo "[$(date --iso-8601=seconds)] Uploading DB backup via SCP: ${BACKUP_SCP_TARGET}"
  scp "${FINAL_BACKUP_FILE}" "${BACKUP_SCP_TARGET}/"
  scp "${FINAL_BACKUP_FILE}.sha256" "${BACKUP_SCP_TARGET}/"
  echo "[$(date --iso-8601=seconds)] SCP upload complete"
fi

# ── Attachments backup (uploads directory) ────────────────────────────────────

UPLOAD_DIR="${UPLOAD_DIR:-${APP_DIR}/uploads}"
if [ -d "${UPLOAD_DIR}" ] && [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  echo "[$(date --iso-8601=seconds)] Syncing attachments to S3: ${BACKUP_S3_BUCKET}/uploads/"
  aws s3 sync "${UPLOAD_DIR}" "s3://${BACKUP_S3_BUCKET}/uploads/" --quiet
  echo "[$(date --iso-8601=seconds)] Attachments sync complete"
elif [ -d "${UPLOAD_DIR}" ] && [ -n "${BACKUP_SCP_TARGET:-}" ]; then
  echo "[$(date --iso-8601=seconds)] Syncing attachments via rsync: ${BACKUP_SCP_TARGET}/uploads/"
  rsync -az --delete "${UPLOAD_DIR}/" "${BACKUP_SCP_TARGET}/uploads/"
  echo "[$(date --iso-8601=seconds)] Attachments sync complete"
fi

# ── Retention — prune old local backups ───────────────────────────────────────

DELETED=$(find "${BACKUP_DIR}" \( -name "panama_*.sql.gz" -o -name "panama_*.sql.gz.sha256" -o -name "panama_*.sql.gz.gpg" -o -name "panama_*.sql.gz.gpg.sha256" \) -mtime "+${RETENTION_DAYS}" -delete -print | wc -l)
if [ "${DELETED}" -gt 0 ]; then
  echo "[$(date --iso-8601=seconds)] Pruned ${DELETED} backups older than ${RETENTION_DAYS} days"
fi

echo "[$(date --iso-8601=seconds)] Done"
