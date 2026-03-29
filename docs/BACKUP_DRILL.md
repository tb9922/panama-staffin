# Monthly Backup Verification Drill

Run this drill monthly to confirm backups are working and restorable.

This drill complements the production hardening baseline in
[HARDENING_SUMMARY_2026-03-29.md](HARDENING_SUMMARY_2026-03-29.md).

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
crontab -l | grep backup
ls -la backups/*.sql.gz | tail -1
```

- [ ] Backup file exists from within last 24 hours
- [ ] File size is reasonable

### 2. Run verify-backup script

```bash
scripts/verify-backup.sh
```

- [ ] Script exits 0
- [ ] Output shows row counts for key tables

### 3. Check migration version and app health

```bash
psql -c "SELECT MAX(id) FROM migrations;"
curl -s http://localhost:3001/health | jq .
```

- [ ] Migration version matches expectation
- [ ] Health endpoint returns `status: "ok"` and `db: "ok"`

### 4. Test restore to a scratch database (quarterly)

```bash
createdb panama_drill_test
gunzip -c $(ls -t backups/*.sql.gz | head -1) | psql panama_drill_test
DATABASE_URL=postgresql://localhost/panama_drill_test node scripts/migrate.js
psql panama_drill_test -c "SELECT 'staff' AS t, count(*) FROM staff UNION ALL SELECT 'homes', count(*) FROM homes UNION ALL SELECT 'audit_log', count(*) FROM audit_log;"
dropdb panama_drill_test
```

- [ ] Restore completed without errors
- [ ] Migrations applied cleanly
- [ ] Row counts broadly match production
- [ ] Temporary database dropped

---

## Notes

Record any anomalies, failures, or observations:

```text
(Write notes here)
```
