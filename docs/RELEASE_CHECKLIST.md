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
- [ ] `npm run verify:action-backfill`, `npm run verify:v1-operational -- --strict`, and `npm run test:v1-scale` pass, with Teddy and external CQC/quality signoffs recorded where required
- [ ] HR encryption gates pass after HR migrations:
  `npm run backfill:hr-edi-encryption`, `npm run verify:hr-edi-encryption`,
  `npm run backfill:hr-health-encryption`, `npm run verify:hr-health-encryption`
- [ ] `npm audit --omit=dev --json` - 0 production vulnerabilities
- [ ] New migrations reviewed (if any)
- [ ] `CLAUDE.md` updated if schema/API/test counts changed
- [ ] `docs/CURRENT_BASELINE.md` and `docs/MAINLINE.md` updated if the baseline or release gate changed
- [ ] Backup confirmed: `scripts/backup-db.sh` ran successfully within last hour
- [ ] Offsite backup target is configured for production (`BACKUP_S3_BUCKET` or `BACKUP_SCP_TARGET`); set `BACKUP_REQUIRE_OFFSITE=true` once this is enforced
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
node ./scripts/verify-v1-operational-gates.js --strict
bash ./scripts/backup-db.sh
PRE_MIGRATION_BACKUP=$(ls -t backups/db/panama_*.sql.gz | head -1)
test -n "$PRE_MIGRATION_BACKUP"
pm2 stop panama panama-webhooks || true
node scripts/migrate.js
npm run verify:action-backfill
npm run verify:v1-operational -- --strict
npm run backfill:hr-edi-encryption
npm run verify:hr-edi-encryption
npm run backfill:hr-health-encryption
npm run verify:hr-health-encryption
npm prune --omit=dev
pm2 startOrReload ecosystem.config.cjs --env production --update-env
BASE_URL="${SMOKE_BASE_URL:-http://localhost:3001}" \
HOME_SLUG="${SMOKE_HOME_SLUG:?required}" \
SMOKE_USERNAME="${SMOKE_USERNAME:?required}" \
SMOKE_PASSWORD="${SMOKE_PASSWORD:?required}" \
  bash ./scripts/smoke-vps.sh
npm run verify:hr-edi-encryption
npm run verify:hr-health-encryption
```

If migration or post-deploy verification fails, restore the pre-migration backup
with `RESTORE_USE_ENV_DB=true FORCE_RESTORE_DB=true ./scripts/restore-db.sh "$PRE_MIGRATION_BACKUP"`,
checkout the previous known-good commit, rebuild, and reload both PM2 processes.

## Post-Deploy Verification

- [ ] Health check: `curl -s http://localhost:3001/health | jq .`
  - `status: "ok"`, `db: "ok"`
- [ ] Metrics check when enabled:
  - `curl -s -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:3001/metrics | grep panama_db_pool_waiting`
  - `panama_db_pool_waiting` is `0`
- [ ] Request logging includes `reqId` for a sample request in PM2 logs
- [ ] Login test: admin + viewer credentials both work
- [ ] Data loads: navigate to Dashboard and one finance/payroll screen, confirm data renders
- [ ] PM2 status: `pm2 status` shows `panama` and `panama-webhooks` online with no restart loops
- [ ] Verify backup: `scripts/verify-backup.sh` passes
- [ ] Live smoke: `scripts/smoke-vps.sh` passes, including frontend shell and V1 read-only APIs
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
