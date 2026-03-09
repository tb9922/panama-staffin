# Monthly Backup Verification Drill

Run this drill monthly to confirm backups are working and restorable.

---

## Drill Record

| Field | Value |
|-------|-------|
| Date | |
| Operator | |
| Environment | Production / Staging |
| Result | PASS / FAIL |

---

## Steps

### 1. Verify backup script is running

```bash
# Check crontab entry exists
crontab -l | grep backup

# Check most recent backup file
ls -la backups/*.sql.gz | tail -1
```

- [ ] Backup file exists from within last 24 hours
- [ ] File size is reasonable (not 0 bytes, not drastically different from previous)

### 2. Run verify-backup script

```bash
scripts/verify-backup.sh
```

- [ ] Script exits 0
- [ ] Output shows row counts for key tables (staff, homes, audit_log)

### 3. Check migration version match

```bash
# Current DB migration version
psql -c "SELECT MAX(id) FROM migrations;"

# Health endpoint version
curl -s http://localhost:3001/health | jq '.migrationVersion'
```

- [ ] Both values match

### 4. Test restore to scratch database (quarterly)

Perform this step at least once per quarter:

```bash
# Create temporary database
createdb panama_drill_test

# Restore latest backup
gunzip -c backups/$(ls -t backups/*.sql.gz | head -1) | psql panama_drill_test

# Run migrations
DATABASE_URL=postgresql://localhost/panama_drill_test node scripts/migrate.js

# Verify row counts
psql panama_drill_test -c "SELECT 'staff' AS t, count(*) FROM staff UNION ALL SELECT 'homes', count(*) FROM homes UNION ALL SELECT 'audit_log', count(*) FROM audit_log;"

# Clean up
dropdb panama_drill_test
```

- [ ] Restore completed without errors
- [ ] Migrations applied cleanly
- [ ] Row counts match production (within reason)
- [ ] Temporary database dropped

---

## Notes

Record any anomalies, failures, or observations:

```
(Write notes here)
```
