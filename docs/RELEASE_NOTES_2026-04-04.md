# Release Notes: 2026-04-04

## Summary

This release adds document and evidence workflows across onboarding and key compliance modules, and tightens several supporting behaviors that were noisy or incomplete in staging.

## Included Changes

- Added onboarding section document uploads, downloads, deletes, and per-section history
- Added onboarding blocking checks for health declaration and nurse qualification verification
- Added training record evidence attachments
- Added attachment support for incidents, complaints, IPC audits, and maintenance records
- Hardened `StaffPicker` and `CoverageAlertBanner` so aborted fetches do not surface noisy false errors
- Extended GDPR subject-access and erasure coverage for the new onboarding and training staff attachment data
- Hotfixed onboarding attachment deletion so `/api/onboarding/files/:id` is routed correctly in production

## Migrations

Apply these migrations during deploy:

- `migrations/132_create_onboarding_file_attachments.sql`
- `migrations/133_create_onboarding_history.sql`
- `migrations/134_create_training_file_attachments.sql`
- `migrations/135_create_record_file_attachments.sql`

## Deploy Notes

Run on the application server:

```bash
cd /var/www/panama-staffing
git pull --ff-only origin main
export PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH
npm ci --include=dev
npm run build
node scripts/migrate.js
pm2 restart panama --update-env
pm2 restart panama-ui --update-env
```

## Verification Scope

Verify after deploy:

- `curl -s http://127.0.0.1:3001/health`
- `curl -s http://127.0.0.1:3001/readiness`
- onboarding section modal shows documents and history
- onboarding document upload, download, and delete all work against the live API
- training record modal shows attachment panel
- incident, complaint, IPC, and maintenance edit modals show attachment panel
- login, home switching, and baseline data loads still work

## Rollback Notes

If rollback is needed, revert to the previous `main` commit, re-run migrations only if required by the rollback plan, and restart `panama` plus `panama-ui`. See `docs/ROLLBACK.md`.
