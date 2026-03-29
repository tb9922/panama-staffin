# Release Checklist

## Pre-Deploy

- [ ] All changes committed and pushed
- [ ] `npm test` — all backend tests pass
- [ ] `npm run test:frontend` — all frontend tests pass
- [ ] `npx eslint .` — 0 errors, 0 warnings
- [ ] `npm run audit:routes` — exit 0
- [ ] New migrations reviewed (if any)
- [ ] CLAUDE.md updated (if schema/API/test counts changed)
- [ ] Backup confirmed: `scripts/backup-db.sh` ran successfully within last hour
- [ ] No open critical/blocking issues

## Deploy

```bash
cd /var/www/panama-staffing
git pull origin main
npm ci --omit=dev
npm run build
node scripts/migrate.js        # Apply pending migrations
pm2 restart panama              # Or: systemctl restart panama
```

## Post-Deploy Verification

- [ ] Health check: `curl -s http://localhost:3001/health | jq .`
  - `status: "ok"`, `db: "ok"`
- [ ] Metrics check when enabled: `curl -s -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:3001/metrics | grep panama_db_pool_waiting`
  - `panama_db_pool_waiting` is `0`
- [ ] Login test: admin + viewer credentials both work
- [ ] Data loads: navigate to Dashboard, confirm data renders
- [ ] PM2 status: `pm2 status` shows `online`, no restart loops
- [ ] Verify backup: `scripts/verify-backup.sh` passes

## Emergency Rollback

See [ROLLBACK.md](ROLLBACK.md) for full procedure including RTO/RPO targets.

Quick reference:
```bash
git log --oneline -5             # Find previous commit
git checkout <commit> -- .       # Revert files
node scripts/migrate.js          # Re-run migrations (forward-only)
pm2 restart panama
```

**If a migration must be reversed**, follow the manual rollback procedure in ROLLBACK.md.
