# Instance Handoff - 2026-04-13

This note was written so a fresh Codex or Claude instance could resume work
without rebuilding the recent history from chat.

## Current truth at handoff time

- Date context: `2026-04-13`
- Worktree used for the handoff: `quirky-goodall`
- `origin/main` at handoff time: `e7f4087`
- Production runtime expected on VPS: `31c55cd`
- `e7f4087` was docs-only and did not change runtime behavior
- Production health at handoff time:
  - `/health` -> `{"status":"ok","db":"ok"}`
  - `/readiness` -> `{"status":"ready"}`

## Important branch reality

Do not treat `quirky-goodall` as a safe merge or deploy branch.

At handoff time it was a mixed local worktree with old branch drift plus extra
local changes. Recent shipping had been done by extracting clean tranches onto
`main`-based branches and deploying those.

Safe rule:

1. Start from current `main`.
2. Extract only the next clean tranche.
3. Verify locally.
4. Deploy sequentially.
5. Smoke test on the VPS.
6. Update docs.

## Documents already on `main`

These were already the repo-level history notes:

- `docs/CQC_READINESS_STATUS_2026-04-12.md`
- `docs/UX_SHIPPED_STATUS_2026-04-13.md`

Those two files were the source of truth for shipped CQC, evidence, readiness,
and UX rollout history through `31c55cd`.

## What had already shipped

### Evidence / CQC / readiness

Already shipped to `main` and deployed in earlier slices:

- `23b5e1a` - Add cross-module Evidence Hub
- `d414e9e` - Add folder cabinet view to Evidence Hub
- `68e29b2` - Add CQC readiness backend foundation
- `8445db5` - Add CQC readiness analysis and UI
- `2b80ac9` - Add structured CQC SAF evidence workflows
- `96339ca` - Refine CQC readiness authority and governance
- `38ed978` - Clarify CQC supporting file state
- `10e1bb3` - Close remaining auth and rate-limit gaps
- `9e1a290` - Respect proxy headers behind nginx
- `ff98722` - Enforce DPIA and ROPA status workflows
- `06fe7ff` - Unblock CI lint and regression checks

These slices included:

- Evidence Hub search and folder cabinet
- CQC narratives
- evidence owner and review due
- structured partner feedback and observations
- server-authored live readiness
- readiness snapshots and PDF integration
- CQC governance and GDPR coverage
- auth and rate-limit hardening
- DPIA and ROPA transition enforcement

### UX rollout

Already shipped to `main` and deployed:

- `eb73b7c` - Polish finance and absence UX flows
- `7377c27` - Refine app shell navigation and handoff flows
- `368c259` - Polish governance and casework UX flows
- `c69c801` - Polish HR casework UX flows
- `5f87959` - Polish compliance workspace UX
- `0c3a29b` - Fix MCA modal crash in DoLS tracker
- `92e74b6` - Make dashboard role-aware for workspace roles
- `9bda113` - Focus sidebar navigation for workspace roles
- `0607131` - Trim noisy sidebar links for read-only roles
- `660f2b0` - Polish app shell and local date defaults
- `4ad2f3f` - Standardize admin workflow page states
- `fa7fda6` - Polish dense staff compliance workflows
- `31c55cd` - Polish shared UX across operations and admin flows

These slices included:

- shared `LoadingState`, `ErrorState`, `EmptyState`, and `InlineNotice`
- `ToastContext` and `ToastViewport`
- more consistent page-state handling across many pages
- better workflow handoffs
- role-aware dashboard landing
- trimmed sidebar behavior for read-only roles
- broader UX consistency across residents, payroll admin, GDPR, risks, users,
  platform admin, IPC, and related flows

## What had been verified live already

Production smoke testing had already covered:

- `/evidence`
- `/cqc`
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

Also verified previously:

- Evidence Hub search, folder view, download, delete, and XLSX
- CQC narrative save
- CQC evidence save with `evidence_owner` and `review_due`
- partner feedback CRUD
- observation CRUD
- snapshot create and sign-off behavior
- readiness endpoint behavior
- viewer, own-data, and finance access expectations on targeted endpoints

Temporary production smoke homes and users were cleaned up after those runs.

## One issue that was active in the handoff

The live report at handoff time was:

- clicking `CQC Evidence` showed the generic route error boundary wording
  (`Something went wrong` / `Try again`)

That looked more like `src/components/RouteErrorBoundary.jsx` than the page's
own inline `ErrorState`.

At handoff time, `src/pages/CQCEvidence.jsx` did a large `Promise.all(...)`
over multiple modules:

- scheduling
- training
- incidents
- complaints
- maintenance
- IPC
- risks
- policies
- whistleblowing
- DoLS
- care certificate

Suggested next debugging steps at the time:

1. Reproduce `/cqc` on production in a signed-in browser session.
2. Capture browser console, `pageerror`, and failed network requests.
3. Check production logs while loading `/cqc`.
4. Determine whether one API in the `Promise.all` is failing or whether a
   render-time exception is triggering the route boundary.

## Other remaining backlog after `/cqc`

### Security / correctness

Still worth finishing:

1. `own` access semantics were still structurally risky in
   `shared/roles.js` and `middleware/auth.js`.
2. Server-side status transition enforcement was still incomplete on some
   modules: complaints, IPC, whistleblowing, policies, and risk register.
3. Some download helpers still did not route expired sessions through the
   normal logout path in `src/lib/api.js`.

### Remaining UX holdouts

These were still the main pages left on older patterns:

- `src/pages/MonthlyTimesheet.jsx`
- `src/pages/HandoverNotes.jsx`
- `src/pages/CareCertificateTracker.jsx`
- `src/pages/OnboardingTracker.jsx`
- `src/pages/CQCEvidence.jsx`
- `src/pages/UserManagement.jsx`
- `src/pages/AuditLog.jsx`
- `src/pages/DpiaManager.jsx`
- `src/pages/RopaManager.jsx`
- `src/pages/ReceivablesManager.jsx`
- `src/pages/MaintenanceTracker.jsx`
- `src/pages/AgencyTracker.jsx`

### Bigger product polish still possible

- a more visible shell and dashboard redesign
- stronger whole-app typography, spacing, and hierarchy polish
- broader premium-feel cleanup beyond structural UX consistency

## Recent `main` history at handoff time

- `e7f4087` - Document shipped CQC and UX rollout status
- `31c55cd` - Polish shared UX across operations and admin flows
- `fa7fda6` - Polish dense staff compliance workflows
- `4ad2f3f` - Standardize admin workflow page states
- `660f2b0` - Polish app shell and local date defaults
- `0607131` - Trim noisy sidebar links for read-only roles
- `9bda113` - Focus sidebar navigation for workspace roles
- `92e74b6` - Make dashboard role-aware for workspace roles

## Commands that had worked

### SSH to VPS

Use non-interactive key-based SSH:

```powershell
ssh -o BatchMode=yes -i "$env:USERPROFILE\.ssh\hetzner_ed25519" root@178.104.56.116
```

### Check deployed commit

```powershell
ssh -o BatchMode=yes -i "$env:USERPROFILE\.ssh\hetzner_ed25519" root@178.104.56.116 "bash -lc 'cd /var/www/panama-staffing && git rev-parse --short HEAD'"
```

### Check health and readiness

```powershell
curl.exe -s http://178.104.56.116/health
curl.exe -s http://178.104.56.116/readiness
```

### Typical deploy pattern used successfully

```powershell
ssh -o BatchMode=yes -i "$env:USERPROFILE\.ssh\hetzner_ed25519" root@178.104.56.116 "bash -lc 'set -e; cd /var/www/panama-staffing; git pull --ff-only origin main; source /root/.nvm/nvm.sh; nvm use 22 >/dev/null; npm ci; node scripts/migrate.js; npm run build; pm2 reload panama --update-env'"
```

Important:

- do not run `git pull` and `node scripts/migrate.js` in parallel

## Best next move for a new instance

1. Reproduce and fix the live `/cqc` failure first.
2. Use a clean `main`-based branch for the fix.
3. Verify locally.
4. Deploy sequentially to the VPS.
5. Smoke test `/cqc` live.
6. Then return to the remaining security and correctness backlog.

## Bottom line

At handoff time the app was in a much stronger state than it had been:

- CQC, evidence, and readiness work was shipped.
- later UX consistency work was shipped.
- production was healthy.

But there was still active work left:

- the live `/cqc` issue reported that day
- remaining security and correctness cleanup
- the last UX holdout pages
