#!/bin/bash
#
# Panama Staffing — PostgreSQL backup script
#
# Usage:
#   ./scripts/backup-db.sh                    # backup with defaults
#   BACKUP_DIR=/mnt/nas ./scripts/backup-db.sh  # custom backup directory
#
# Cron (daily at 2am):
#   0 2 * * * /var/www/panama/scripts/backup-db.sh >> /var/log/panama-backup.log 2>&1
#
# Requires: pg_dump, gzip
# Optional: aws CLI (for S3 offsite), or rclone, or scp to NAS

set -euo pipefail

: "${DB_PASSWORD:?DB_PASSWORD is required}"

# ── Configuration ─────────────────────────────────────────────────────────────

BACKUP_DIR="${BACKUP_DIR:-./backups/db}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="panama_${TIMESTAMP}.sql.gz"

# Database connection — reads from environment or defaults
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-panama_dev}"
DB_USER="${DB_USER:-panama}"

# ── Setup ─────────────────────────────────────────────────────────────────────

mkdir -p "${BACKUP_DIR}"

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
  | gzip > "${BACKUP_DIR}/${FILENAME}"

SIZE=$(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1)
echo "[$(date --iso-8601=seconds)] Backup complete: ${FILENAME} (${SIZE})"

# ── Verify ────────────────────────────────────────────────────────────────────

# Quick integrity check — decompress and count lines
LINES=$(gzip -dc "${BACKUP_DIR}/${FILENAME}" | wc -l)
if [ "${LINES}" -lt 100 ]; then
  echo "[$(date --iso-8601=seconds)] WARNING: Backup suspiciously small (${LINES} lines). Check DB connectivity."
  exit 1
fi
echo "[$(date --iso-8601=seconds)] Verified: ${LINES} lines"

# ── Offsite upload (uncomment one) ────────────────────────────────────────────

# AWS S3:
# aws s3 cp "${BACKUP_DIR}/${FILENAME}" "s3://panama-backups/${FILENAME}"

# Backblaze B2:
# b2 upload-file panama-backups "${BACKUP_DIR}/${FILENAME}" "${FILENAME}"

# SCP to NAS:
# scp "${BACKUP_DIR}/${FILENAME}" backup@nas:/backups/panama/

# ── Retention — prune old local backups ───────────────────────────────────────

DELETED=$(find "${BACKUP_DIR}" -name "panama_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete -print | wc -l)
if [ "${DELETED}" -gt 0 ]; then
  echo "[$(date --iso-8601=seconds)] Pruned ${DELETED} backups older than ${RETENTION_DAYS} days"
fi

echo "[$(date --iso-8601=seconds)] Done"
