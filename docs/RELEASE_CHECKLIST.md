# Release Checklist

Current expected baseline is documented in
[HARDENING_SUMMARY_2026-03-29.md](HARDENING_SUMMARY_2026-03-29.md).

## Pre-Deploy

- [ ] All changes committed and pushed
- [ ] `npm test` - backend and integration suite passes
- [ ] `npm run test:frontend` - frontend-focused suite passes
- [ ] `npm run test:e2e` or the agreed targeted smoke slice passes
- [ ] `npx eslint .` - 0 errors, 0 warnings
- [ ] `npm run audit:routes` - exit 0
- [ ] `npm audit --omit=dev --json` - 0 production vulnerabilities
- [ ] New migrations reviewed (if any)
- [ ] `CLAUDE.md` updated if schema/API/test counts changed
- [ ] `docs/HARDENING_SUMMARY_2026-03-29.md` updated if the baseline changed
- [ ] Backup confirmed: `scripts/backup-db.sh` ran successfully within last hour
- [ ] No open critical/blocking issues

## Deploy

```bash
cd /var/www/panama-staffing
git pull origin main
npm ci --omit=dev
npm run build
node scripts/migrate.js
pm2 restart panama
```

## Post-Deploy Verification

- [ ] Health check: `curl -s http://localhost:3001/health | jq .`
  - `status: "ok"`, `db: "ok"`
- [ ] Metrics check when enabled:
  - `curl -s -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:3001/metrics | grep panama_db_pool_waiting`
  - `panama_db_pool_waiting` is `0`
- [ ] Request logging includes `reqId` for a sample request in PM2 logs
- [ ] Login test: admin + viewer credentials both work
- [ ] Data loads: navigate to Dashboard and one finance/payroll screen, confirm data renders
- [ ] PM2 status: `pm2 status` shows `online`, no restart loops
- [ ] Verify backup: `scripts/verify-backup.sh` passes

## Emergency Rollback

See [ROLLBACK.md](ROLLBACK.md) for full procedure including RTO/RPO targets.

Quick reference:

```bash
git log --oneline -5
git checkout <commit> -- .
node scripts/migrate.js
pm2 restart panama
```

If a migration must be reversed, follow the manual rollback procedure in
[ROLLBACK.md](ROLLBACK.md).
