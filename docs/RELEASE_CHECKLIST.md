# Release Checklist

Current expected baseline is documented in
[HARDENING_SUMMARY_2026-03-29.md](HARDENING_SUMMARY_2026-03-29.md).

## Pre-Deploy

- [ ] All changes committed and pushed
- [ ] `scripts/verify-baseline.sh` with VPS variables confirms local, `origin/main`, and VPS all match
- [ ] `npm run lint` - lint passes
- [ ] `npm run build` - production build passes
- [ ] `npm run test:frontend` - frontend-focused suite passes
- [ ] `npm run test:release` - full release gate passes against a local dev/test database
- [ ] `npm run test:golden` - golden journey and role matrix pass
- [ ] `npm run test:e2e` or the agreed targeted smoke slice passes
- [ ] `npm run test:integration` passes for route, auth, migration, compliance, payroll, HR, GDPR, CQC, incident, or cross-module changes
- [ ] `npm run audit:routes` - exit 0
- [ ] `npm run verify:action-backfill`, `npm run verify:v1-operational`, and `npm run test:v1-scale` pass
- [ ] HR encryption gates pass after HR migrations:
  `npm run backfill:hr-edi-encryption`, `npm run verify:hr-edi-encryption`,
  `npm run backfill:hr-health-encryption`, `npm run verify:hr-health-encryption`
- [ ] `npm audit --omit=dev --json` - 0 production vulnerabilities
- [ ] New migrations reviewed (if any)
- [ ] `CLAUDE.md` updated if schema/API/test counts changed
- [ ] `docs/CURRENT_BASELINE.md` and `docs/MAINLINE.md` updated if the baseline or release gate changed
- [ ] Backup confirmed: `scripts/backup-db.sh` ran successfully within last hour
- [ ] No open critical/blocking issues

## Deploy

```bash
cd /var/www/panama-staffing
EXPECTED_COMMIT=<github-sha>
git fetch --prune origin main
git checkout main
git merge --ff-only "$EXPECTED_COMMIT"
test "$(git rev-parse HEAD)" = "$EXPECTED_COMMIT"
npm ci
npm run build
pm2 stop panama
node scripts/migrate.js
npm run backfill:hr-edi-encryption
npm run verify:hr-edi-encryption
npm run backfill:hr-health-encryption
npm run verify:hr-health-encryption
npm prune --omit=dev
pm2 restart panama
npm run verify:hr-edi-encryption
npm run verify:hr-health-encryption
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
- [ ] `scripts/verify-baseline.sh` with VPS variables confirms VPS HEAD is the deployed GitHub SHA

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
