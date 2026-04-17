# Platform Hardening Summary - 2026-03-29

This note captures the major hardening and cleanup work completed across the
recent review passes so the current platform state is documented in one place.

## Current Baseline

Verified locally in this branch:

- `npm test`: 134 files, 2533 tests passed
- `npm run build`: passed
- `npm run audit:routes`: passed
- `npm audit --omit=dev --json`: 0 vulnerabilities

## What Was Tightened

### Auth, Session, And RBAC

- durable session invalidation via `session_version`
- fail-closed logout and safer token revocation behavior
- `503` on auth dependency outages instead of false `401` logouts
- request-scoped authenticated DB user reuse in middleware
- tighter home/user management boundaries and per-home role enforcement
- own-data users blocked from manager-only dashboard and scheduling surfaces
- CSRF comparison hardened for byte-length edge cases

### Scheduling, Dashboard, And Training

- server-side edit-lock enforcement for past-date scheduling changes
- UTC-safe date handling and correct shift-date training checks
- correct date-window loading for Daily Status, rota, leave, and timesheets
- roster warnings surfaced instead of silently dropped
- dashboard alert ordering, degraded-source handling, and no-home behavior fixed
- training read-only behavior wired properly in the UI
- training OCC and stale-write protection added across records, appraisals,
  supervisions, fire drills, and training-type config

### Payroll, Finance, Beds, And Residents

- pension override persistence and calculation wiring completed
- payroll export/privacy access tightened
- resident, invoice, and payment schedule locking and stale-write fixes
- `updated_at` consistency improved on finance/staff/incident mutations
- bed edit/delete/admit/move/revert paths hardened
- unique occupied-bed protection added so one resident cannot occupy two beds
- resident and bed UI behavior fixed, including status-change wiring and toast
  cleanup

### GDPR, Exports, And Privacy

- SAR/erasure coverage extended across more HR, payroll, and finance tables
- pension notes and other free-text fields scrubbed during erasure
- export/download endpoints send `Cache-Control: no-store`
- sensitive PII exposure reduced for non-payroll roles
- public health endpoint no longer exposes internal pool/timing details

### Ops, Platform Safety, And Observability

- `/metrics` endpoint added behind `METRICS_TOKEN`
- DB pool defaults aligned with documented production sizing
- idle transaction timeout made configurable and enabled by default
- JWT expiry moved to `JWT_EXPIRES_IN`
- backend/frontend Sentry trace-rate config added
- request-scoped logging context added for `reqId`, home, and username
- deployment, runbook, release, and backup docs updated with connection-budget
  and offsite-backup guidance

### Coverage And Cleanup

- route integration coverage added for previously undercovered server modules
- missing page tests added for DPIA and ROPA flows
- export/PDF smoke coverage added
- several warning-prone async tests stabilized
- the last known GDPR query concurrency warning path removed

## Verification Philosophy

This hardening cycle focused on:

- real behavior checks, not just static code review
- server-side enforcement rather than UI-only controls
- concurrency and stale-write protection on high-risk mutations
- direct regression tests for every serious bug class touched

## Remaining Work

There are no known critical gaps from the reviewed batches left open in this
branch. The remaining work is mostly operational follow-through and routine
polish:

- ensure production env vars match the documented baseline
- wire real metrics dashboards and alerts to `/metrics` and Sentry
- keep running backup verification drills
- keep trimming residual warning noise as normal maintenance

## Related Notes

- [AUTH.md](AUTH.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [RUNBOOK.md](RUNBOOK.md)
- [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)
- [BACKUP_DRILL.md](BACKUP_DRILL.md)
- [DASHBOARD_HARDENING_2026-03-24.md](DASHBOARD_HARDENING_2026-03-24.md)
