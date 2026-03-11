# Incident Runbook

Operational procedures for common failure scenarios. For deployment procedures, see [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md). For rollback, see [ROLLBACK.md](ROLLBACK.md).

---

## 1. Auth Outage (Users Cannot Log In)

**Symptoms:** All login attempts fail. Multiple users reporting simultaneously.

**Diagnosis:**
```bash
# Check if server is responding
curl -s http://localhost:3001/health | jq .

# Check recent auth errors in PM2 logs
pm2 logs panama --lines 50 | grep -i "auth\|login\|jwt\|token"

# Check if account lockout is widespread
psql -c "SELECT username, locked_until FROM users WHERE locked_until > NOW();"
```

**Resolution:**

| Cause | Fix |
|-------|-----|
| Server down | `pm2 restart panama` |
| DB connection failure | Check PostgreSQL: `pg_isready -h localhost` |
| JWT_SECRET changed/missing | Verify `.env` has correct `JWT_SECRET` (min 32 chars). Restart server. |
| Mass lockout (brute force) | Unlock users: `UPDATE users SET locked_until = NULL, failed_login_count = 0;` |
| Token deny list corrupted | Restart server (deny list is in-memory, rebuilds from DB on start) |

**Escalation:** If DB is unreachable after restart, check disk space (`df -h`) and PostgreSQL logs (`journalctl -u postgresql`).

---

## 2. Database Pressure

**Symptoms:** Slow page loads, health endpoint shows `pool.waiting > 0`, `queryMs > 500`.

**Diagnosis:**
```bash
# Health endpoint pool stats
curl -s http://localhost:3001/health | jq '.pool, .queryMs'

# Active connections
psql -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';"

# Long-running queries
psql -c "SELECT pid, now() - pg_stat_activity.query_start AS duration, query
         FROM pg_stat_activity WHERE state = 'active' AND query_start < now() - interval '10 seconds'
         ORDER BY duration DESC;"

# Disk usage
df -h /var/lib/postgresql
```

**Resolution:**

| Cause | Fix |
|-------|-----|
| Pool exhaustion (waiting > 5) | Kill long queries: `SELECT pg_terminate_backend(pid);` Increase `DB_POOL_MAX` if recurring. |
| Slow query (no index) | Add index. Check `EXPLAIN ANALYZE` on the slow query. |
| Disk full | Clear old backups: `ls -la backups/`. Purge old audit entries: `DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '7 years';` |
| Too many connections | Check for connection leaks. Restart server to release pool. |

**Escalation:** If disk is >90% full, immediately clear old backups and WAL files. Consider expanding disk.

---

## 3. Deploy Rollback

**Symptoms:** New deploy introduced a bug. Need to revert.

**Procedure:** See [ROLLBACK.md](ROLLBACK.md) for full procedure with RTO/RPO targets.

**Quick steps:**
1. Identify the last known-good commit: `git log --oneline -10`
2. Revert: `git checkout <commit> -- .`
3. Reinstall: `npm ci --omit=dev && npm run build`
4. Restart: `pm2 restart panama`
5. Verify: `curl -s http://localhost:3001/health | jq .`

**If a migration was applied:** Migrations are forward-only. You must write a new corrective migration rather than rolling back the schema change.

---

## 4. Data Corruption / Restore from Backup

**Symptoms:** Missing or incorrect data reported by users. Audit log shows unexpected changes.

**Diagnosis:**
```bash
# Check recent audit entries for suspicious activity
psql -c "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 20;"

# Check backup freshness
ls -la backups/*.sql.gz | tail -5

# Verify backup integrity
scripts/verify-backup.sh
```

**Restore procedure:**
1. **Stop the application:** `pm2 stop panama`
2. **Take a snapshot of current state:** `pg_dump panama_prod > pre_restore_$(date +%Y%m%d_%H%M%S).sql`
3. **Restore from backup:**
   ```bash
   gunzip -c backups/YYYY-MM-DD_HH-MM-SS.sql.gz | psql panama_prod
   ```
4. **Run migrations:** `node scripts/migrate.js` (backup may be behind current schema)
5. **Restart:** `pm2 start panama`
6. **Verify:** Check health endpoint, login, spot-check affected data

**Escalation:** If backup is also corrupted, check if automated backup script has been failing silently. Review `crontab -l` for backup schedule.

---

## General Escalation

If you cannot resolve an issue within 30 minutes:
1. Document what you've tried and what symptoms persist
2. Check PM2 logs: `pm2 logs panama --lines 200`
3. Check PostgreSQL logs: `journalctl -u postgresql --since "1 hour ago"`
4. Take a database snapshot before attempting further fixes
