# Panama Staffing — Rollback Procedures

## Quick Rollback (Code Only)

If a deployment breaks the application but the database is fine:

```bash
cd /var/www/panama

# Find the previous working commit
git log --oneline -5

# Revert to it
git checkout <commit-hash> -- .
npm ci --omit=dev
npm run build
pm2 restart panama

# Verify
curl -s https://panama.yourdomain.com/health | jq .
```

**Time to recover:** ~2 minutes

---

## Database Rollback (Migration)

If a new migration caused issues:

```bash
# Find the problematic migration number
ls migrations/

# Run the DOWN section (drops the table/changes)
node scripts/migrate.js --down 067

# Revert code to before the migration was added
git checkout <previous-commit> -- .
npm ci --omit=dev
npm run build
pm2 restart panama
```

**Time to recover:** ~3 minutes

---

## Full Database Restore

If data is corrupted or lost:

```bash
# List available backups
ls -lt backups/db/

# Restore to a test database first (verify before overwriting production)
DB_NAME=panama_restore ./scripts/restore-db.sh backups/db/panama_20260227_020000.sql.gz

# Verify the restored data
DB_NAME=panama_restore node scripts/migrate.js
psql panama_restore -c "SELECT id, name FROM homes"
psql panama_restore -c "SELECT COUNT(*) FROM staff"

# If verified OK, restore to production
# WARNING: This drops the production database
./scripts/restore-db.sh backups/db/panama_20260227_020000.sql.gz

# Run any migrations added after the backup
node scripts/migrate.js

# Restart application
pm2 restart panama
```

**Time to recover:** ~10 minutes (depends on DB size)

**Maximum data loss:** Up to 24 hours (daily backup schedule). Consider more frequent backups for critical periods (e.g. payroll week).

---

## Emergency: Application Won't Start

```bash
# 1. Check PM2 status and logs
pm2 status
pm2 logs panama --lines 50

# 2. Check if port is in use
lsof -i :3001

# 3. Check database connectivity
psql -h localhost -U panama -d panama_dev -c "SELECT 1"
# Or: docker compose ps   (if using Docker)

# 4. Check disk space
df -h

# 5. Check memory
free -h

# 6. If database container is down
docker compose up -d
sleep 10
pm2 restart panama
```

---

## Emergency: Database Container Won't Start

```bash
# Check container logs
docker compose logs db

# If volume is corrupted, restore from backup
docker compose down -v          # WARNING: destroys data volume
docker compose up -d
sleep 10
node scripts/migrate.js
./scripts/restore-db.sh backups/db/<latest-backup>.sql.gz
node scripts/migrate.js         # apply any migrations after backup
pm2 restart panama
```

---

## Recovery Time Objectives

| Scenario | RTO | RPO |
|----------|-----|-----|
| Code rollback | 2 min | 0 (no data loss) |
| Migration rollback | 3 min | 0 (no data loss) |
| DB restore from backup | 10 min | Up to 24h |
| Full server rebuild | 1 hour | Up to 24h |

RTO = Recovery Time Objective (how long to fix)
RPO = Recovery Point Objective (how much data could be lost)

---

## Contact

If recovery fails, escalate to the development team. All infrastructure is documented in this repo under `docs/`, `ecosystem.config.cjs`, `nginx.conf`, and `docker-compose.yml`.
