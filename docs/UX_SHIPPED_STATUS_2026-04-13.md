# UX Deployment Status - 2026-04-13

This note exists so the later UX rollout does not live only in chat history.

It complements [CQC_READINESS_STATUS_2026-04-12.md](CQC_READINESS_STATUS_2026-04-12.md), which covers
the CQC / Evidence / readiness program through `06fe7ff`.

## Live truth

- `origin/main` is at commit `31c55cd`
- VPS `/var/www/panama-staffing` is also at commit `31c55cd`
- Production health is green:
  - `/health` -> `{"status":"ok","db":"ok"}`
  - `/readiness` -> `{"status":"ready"}`

## Already shipped

### Finance and absence UX foundation

- `eb73b7c` - Polish finance and absence UX flows

Included:

- shared `LoadingState`, `ErrorState`, `EmptyState`, `InlineNotice`
- `ToastContext` / `ToastViewport`
- `useTransientNotice`
- cleaner absence / RTW / OH flow structure
- stronger payroll timesheet cross-check guidance
- better finance/payroll empty, error, and loading states

### Navigation and handoff improvements

- `7377c27` - Refine app shell navigation and handoff flows

Included:

- stronger shell/navigation refinement
- better cross-page handoff behavior
- cleaner route-to-workflow continuity

### Governance and casework UX

- `368c259` - Polish governance and casework UX flows

Included:

- better shared page-state treatment on governance/casework pages
- stronger create/update feedback on those flows

### HR casework UX

- `c69c801` - Polish HR casework UX flows

Included:

- denser HR tracker flows aligned to the newer UX pattern
- cleaner handoffs and notices on HR casework screens

### Compliance workspace UX

- `5f87959` - Polish compliance workspace UX

Included:

- broader compliance page consistency
- clearer shared loading/error/empty behavior
- stronger compliance workspace continuity

### DoLS hotfix

- `0c3a29b` - Fix MCA modal crash in DoLS tracker

Included:

- live crash fix for the MCA flow in DoLS

### Role-aware dashboard and sidebar

- `92e74b6` - Make dashboard role-aware for workspace roles
- `9bda113` - Focus sidebar navigation for workspace roles
- `0607131` - Trim noisy sidebar links for read-only roles

Included:

- non-manager roles no longer land on the heavy operations dashboard by default
- finance / viewer / self-service style roles get a cleaner, more relevant workspace home
- read-only roles get a trimmed sidebar rather than the full edit-heavy navigation
- current-section fallback still works when landing deep on a route directly

### Shell polish and local-date cleanup

- `660f2b0` - Polish app shell and local date defaults

Included:

- further shell cleanup
- additional local-date default cleanup on affected screens

### Admin workflow state consistency

- `4ad2f3f` - Standardize admin workflow page states

Included:

- more admin pages now use consistent loading, empty, and error treatment
- stronger admin workflow feedback instead of older ad hoc page text

### Dense staff compliance workflows

- `fa7fda6` - Polish dense staff compliance workflows

Included:

- dense compliance forms and trackers brought closer to the newer page pattern
- clearer UX on higher-friction staff compliance screens

### Shared UX rollout across operations and admin

- `31c55cd` - Polish shared UX across operations and admin flows

Included:

- shared UX pattern widened further across residents, IPC, payroll admin, GDPR, risks, users, platform/admin, and related operations screens
- repeatable row editor introduced for disciplinary witness/evidence style input
- more resident/admin flows now use the same clearer feedback/state treatment

## Production verification completed

### Verification after `eb73b7c`

Verified on production with a temporary home-manager smoke user, then cleaned up:

- `/finance/income` loaded with the updated layout
- `/payroll/timesheets` loaded and showed the payroll cross-check guidance
- `/hr/absence` loaded and showed the sectioned absence flow
- `/payroll/tax-codes` loaded
- `/payroll/sick-pay` loaded
- `/payroll/hmrc` loaded
- `/payroll/pensions` loaded
- Income modal opened and showed the expanded finance structure
- RTW modal opened and showed:
  - `Absence Details`
  - `Return Assessment`
  - `Fit Note`
  - `Trigger Assessment`

### Verification after `92e74b6`, `9bda113`, and `0607131`

Verified on production with temporary role-scoped smoke users, then cleaned up:

- home manager still saw the full operational dashboard
- finance officer saw the new finance-focused workspace home and cleaner finance-first sidebar
- viewer saw the read-only workspace home and trimmed sidebar
- nested route sidebar behavior still worked correctly on deep links

### Verification after `31c55cd`

Verified on production with a temporary smoke tenant and user, then cleaned up:

- `/residents`
- `/ipc`
- `/payroll/tax-codes`
- `/payroll/sick-pay`
- `/payroll/pensions`
- `/payroll/hmrc`
- `/payroll/6751`
- `/leave`
- `/hr/tupe`
- `/risks`
- `/gdpr`
- `/dpia`
- `/ropa`
- `/users`
- `/platform/homes`

Temporary smoke users / homes were cleaned out afterwards.

## What is still future work

Not shipped as part of these UX slices:

- any larger visual redesign of the shell beyond the structural improvements above
- any remaining module-level polish still sitting only in local branches
- any broader product work that was discussed but not extracted into a clean ship branch

## Important warning about `quirky-goodall`

Do not deploy this whole branch wholesale.

Reason:

- it still contains mixed local work outside the extracted shipped tranches
- it still contains branch drift that is not a clean forward patch from current `main`

## Safe rule

For future UX work:

1. start from current `main`
2. extract only the next clean tranche
3. verify locally
4. deploy sequentially
5. update this note
