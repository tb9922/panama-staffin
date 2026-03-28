# Dashboard Hardening Notes (2026-03-24)

## Scope

This pass hardened the main management dashboard against misleading or stale states.

Files changed:
- `src/pages/Dashboard.jsx`
- `src/pages/__tests__/Dashboard.test.jsx`

## Fixes

1. No-home state
- Replaced the indefinite loading spinner with an explicit "Select a home" state when no home is selected.

2. Degraded-data honesty
- If HR, finance, or dashboard-summary requests fail, the page now shows a degraded-data banner.
- The alerts panel no longer shows a false "All clear" when upstream dashboard data is missing.

3. Alert ordering
- Merged alerts are re-sorted by priority before the dashboard applies its 24-alert display cap.
- This prevents high-priority server-side alerts such as compliance/regulatory warnings from being pushed off-screen by local scheduling warnings.

4. Staff self-service guard
- `staff_member` users now see an explicit restricted state instead of a management dashboard built from partial own-data payloads.

5. Cleanup
- Removed the duplicate degraded-data banner from the page.

## Regression Coverage

Targeted dashboard tests now cover:
- no-home state
- degraded summary failure behavior
- alert ordering under overflow
- staff self-service restriction
- existing dashboard render paths

Command:

```powershell
node node_modules/vitest/vitest.mjs run src/pages/__tests__/Dashboard.test.jsx tests/unit/dashboardService.test.js
```

Observed result during this pass:
- `40/40` tests passed

## Follow-up

- Run the full repo suite after syncing the patch to `main`
- Run a browser QA pass against the live local app from `main`
