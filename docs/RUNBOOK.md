# Incident Runbook

Operational procedures for common failure scenarios. For deployment procedures,
see [DEPLOYMENT.md](DEPLOYMENT.md). For rollback, see [ROLLBACK.md](ROLLBACK.md).

## 1. Auth Outage

**Symptoms:** All login attempts fail or authenticated requests start returning `503`.

**Diagnosis:**

```bash
# Check if server is responding
curl -s http://localhost:3001/health | jq .

# Check recent auth errors
pm2 logs panama --lines 50 | grep -i "auth\|login\|jwt\|token"

# Check account lockout state
psql -c "SELECT username, locked_until FROM users WHERE locked_until > NOW();"
```

**Resolution**

| Cause | Fix |
|-------|-----|
| Server down | `pm2 restart panama` |
| DB connection failure | Check PostgreSQL: `pg_isready -h localhost` |
| JWT secret changed/missing | Verify `.env` has the correct `JWT_SECRET` and restart |
| Mass lockout | `UPDATE users SET locked_until = NULL, failed_login_count = 0;` |
| Token deny-list issue | Check DB connectivity and `token_denylist` table health, then restart to resync cache |

## 2. Database Pressure

**Symptoms:** Slow page loads, `/metrics` shows elevated `panama_db_pool_waiting`, or users report intermittent timeouts.

**Diagnosis:**

```bash
# Metrics endpoint (if enabled)
curl -s -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:3001/metrics | grep "panama_db_pool"

# Active connections
psql -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';"

# Long-running queries
psql -c "SELECT pid, now() - query_start AS duration, query
         FROM pg_stat_activity
         WHERE state = 'active'
           AND query_start < now() - interval '10 seconds'
         ORDER BY duration DESC;"

# Idle transactions that should be killed by timeout
psql -c "SELECT pid, now() - xact_start AS duration, state, query
         FROM pg_stat_activity
         WHERE state LIKE 'idle in transaction%';"
```

**Resolution**

| Cause | Fix |
|-------|-----|
| Pool exhaustion | Kill long queries, then review `DB_POOL_MAX` and PM2 worker count |
| Slow query | Run `EXPLAIN ANALYZE` and add indexes or reduce scan size |
| Disk full | Clear old backups/logs and check PostgreSQL WAL growth |
| Too many connections | Rebalance with `PM2 workers * DB_POOL_MAX <= max_connections - reserve` |

**Notes**

- Runtime defaults assume `DB_POOL_MAX=20`.
- With PM2 `instances=4`, that is an 80-connection app budget.
- `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` defaults to 60000 and should terminate stuck idle transactions automatically.

## 3. Deploy Rollback

**Symptoms:** A new deploy introduced a bug and needs to be reverted.

**Procedure**

1. Identify the last known-good commit: `git log --oneline -10`
2. Restore the code: `git checkout <commit> -- .`
3. Reinstall: `npm ci --omit=dev && npm run build`
4. Restart: `pm2 restart panama`
5. Verify: `curl -s http://localhost:3001/health | jq .`

If a migration was applied, prefer a forward corrective migration. For emergency
rollback of a specific migration, follow [ROLLBACK.md](ROLLBACK.md).

## 4. Data Corruption / Restore From Backup

**Symptoms:** Missing or incorrect data is reported by users.

**Diagnosis:**

```bash
# Check recent audit entries
psql -c "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 20;"

# Check backup freshness
ls -la backups/*.sql.gz | tail -5

# Verify backup integrity
scripts/verify-backup.sh
```

**Restore Procedure**

1. Stop the app: `pm2 stop panama`
2. Snapshot current state: `pg_dump panama_prod > pre_restore_$(date +%Y%m%d_%H%M%S).sql`
3. Restore the chosen backup:
   ```bash
   gunzip -c backups/YYYY-MM-DD_HH-MM-SS.sql.gz | psql panama_prod
   ```
4. Run migrations: `node scripts/migrate.js`
5. Restart: `pm2 start panama`
6. Verify: health, login, and the affected data area

**Offsite Backup Expectations**

- Prefer setting `BACKUP_S3_BUCKET` or `BACKUP_SCP_TARGET`
- Use `VERIFY_AFTER_BACKUP=true` on at least one scheduled verification run each week
- Set `HEALTHCHECK_URL` so verification failures trigger an external alert

## 5. Observability Checklist

For a healthy production install:

- `SENTRY_DSN` set if you want backend error reporting
- `SENTRY_TRACES_SAMPLE_RATE` set above `0` if you want backend latency traces
- `VITE_SENTRY_DSN` set if you want frontend reporting
- `VITE_SENTRY_TRACES_SAMPLE_RATE` set above `0` if you want frontend traces
- `METRICS_TOKEN` set if you want `/metrics`

## General Escalation

If you cannot resolve an issue within 30 minutes:

1. Document what you tried and what symptoms persist
2. Check PM2 logs: `pm2 logs panama --lines 200`
3. Check PostgreSQL logs: `journalctl -u postgresql --since "1 hour ago"`
4. Take a database snapshot before attempting further fixes
