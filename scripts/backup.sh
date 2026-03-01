#!/usr/bin/env bash
# Panama Staffing — PostgreSQL backup script
#
# Usage:
#   ./scripts/backup.sh
#
# Crontab (runs at 2am daily):
#   0 2 * * * /var/www/panama-staffing/scripts/backup.sh >> /var/log/panama-backup.log 2>&1
#
# Restore from a backup:
#   pg_restore -d $DATABASE_URL /var/backups/panama/panama_YYYYMMDD_HHMMSS.dump
#   -- or --
#   pg_restore -h localhost -U panama -d panama_dev /var/backups/panama/panama_YYYYMMDD_HHMMSS.dump
#
# Test the restore procedure (do this before going live with a second home):
#   1. Run this script to create a fresh backup
#   2. Create a test database: createdb panama_restore_test
#   3. pg_restore -d panama_restore_test /path/to/latest.dump
#   4. Verify: psql panama_restore_test -c "SELECT COUNT(*) FROM homes;"
#   5. Drop test database: dropdb panama_restore_test

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/panama}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/panama_$TIMESTAMP.dump"

# Load .env if present and DATABASE_URL not already set
if [ -z "${DATABASE_URL:-}" ] && [ -f "$(dirname "$0")/../.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$(dirname "$0")/../.env"
  set +a
fi

# Construct connection string from individual vars if DATABASE_URL not set
if [ -z "${DATABASE_URL:-}" ]; then
  DB_HOST="${DB_HOST:-localhost}"
  DB_PORT="${DB_PORT:-5432}"
  DB_NAME="${DB_NAME:-panama_dev}"
  DB_USER="${DB_USER:-panama}"
  export PGPASSFILE="$(mktemp)"
  echo "${DB_HOST}:${DB_PORT}:${DB_NAME}:${DB_USER}:${DB_PASSWORD:?DB_PASSWORD is required}" > "$PGPASSFILE"
  chmod 600 "$PGPASSFILE"
  trap 'rm -f "$PGPASSFILE"' EXIT
  PG_ARGS="-h $DB_HOST -p $DB_PORT -U $DB_USER $DB_NAME"
else
  PG_ARGS="$DATABASE_URL"
fi

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting backup → $BACKUP_FILE"

pg_dump $PG_ARGS -Fc -f "$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup complete: $SIZE"

# Delete backups older than RETAIN_DAYS
DELETED=$(find "$BACKUP_DIR" -name "panama_*.dump" -mtime +"$RETAIN_DAYS" -print -delete | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pruned $DELETED backup(s) older than ${RETAIN_DAYS} days"
fi

TOTAL=$(find "$BACKUP_DIR" -name "panama_*.dump" | wc -l)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup directory contains $TOTAL file(s)"
