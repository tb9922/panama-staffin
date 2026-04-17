# Instance Handoff - 2026-04-13

This file is for a fresh Codex / Claude instance to pick up the project without
reconstructing recent history from chat.

## Current truth

- Current date context: `2026-04-13`
- Repo root in this worktree: `C:\Users\teddy\panama-staffing\.claude\worktrees\quirky-goodall`
- `origin/main` is at commit `e7f4087`
- Production runtime on the VPS is expected to be on code commit `31c55cd`
- `e7f4087` is a docs-only commit that records shipped history; it does not change runtime behavior
- Production health currently responds:
  - `/health` -> `{"status":"ok","db":"ok"}`
  - `/readiness` -> `{"status":"ready"}`

## Important branch reality

Do **not** treat `quirky-goodall` as a safe merge or deploy branch.

It is still a mixed local worktree with old branch drift and extra local changes.
All shipping over the last stretch was done by extracting clean tranches onto
`main`-based ship branches and then pushing those.

Safe rule:

1. start from current `main`
2. extract only the next clean tranche
3. verify locally
4. deploy sequentially
5. smoke test on the VPS
6. update docs

## Documents already on `main`

These are now the repo-level history notes:

- [CQC_READINESS_STATUS_2026-04-12.md](C:/Users/teddy/panama-staffing/.claude/worktrees/date-shell-ship/docs/CQC_READINESS_STATUS_2026-04-12.md)
- [UX_SHIPPED_STATUS_2026-04-13.md](C:/Users/teddy/panama-staffing/.claude/worktrees/date-shell-ship/docs/UX_SHIPPED_STATUS_2026-04-13.md)

Those two files are the source of truth for shipped CQC/evidence/readiness work
and the later UX rollout through `31c55cd`.

## What has already shipped

### Evidence / CQC / readiness

Already shipped to `main` and deployed in prior slices:

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

These slices include:

- Evidence Hub search and folder cabinet
- CQC narratives
- evidence owner and review due
- structured partner feedback and observations
- server-authored live readiness
- readiness snapshots and PDF integration
- CQC governance/GDPR coverage
- auth and rate-limit hardening
- DPIA / ROPA transition enforcement

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

These slices include:

- shared `LoadingState`, `ErrorState`, `EmptyState`, `InlineNotice`
- `ToastContext` and `ToastViewport`
- more consistent page-state handling across many operational/admin pages
- better workflow handoffs
- role-aware dashboard landing
- trimmed sidebar behavior for read-only roles
- broader UX consistency across residents, payroll admin, GDPR, risks, users, platform/admin, IPC, and related flows

## What has been verified live already

Production smoke testing already completed in prior slices covered:

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

- Evidence Hub search / folder view / download / delete / XLSX
- CQC narrative save
- CQC evidence save with `evidence_owner` and `review_due`
- partner feedback CRUD
- observation CRUD
- snapshot create and sign-off behavior
- readiness endpoint behavior
- viewer / own-data / finance access expectations on targeted endpoints

Temporary production smoke homes and users were cleaned up after those runs.

## One issue still active right now

The user has just reported a live problem:

- clicking `CQC Evidence` shows something like:
  - `something wrong`
  - `try again`

This appears to be the generic route error boundary wording, not the normal
inline `CQCEvidence` page error state.

### What was already checked

- `GET http://178.104.56.116/cqc` returns the SPA shell `200`
- the exact generic wording points more toward:
  - [RouteErrorBoundary.jsx](C:/Users/teddy/panama-staffing/.claude/worktrees/quirky-goodall/src/components/RouteErrorBoundary.jsx)
  than toward the page’s own `ErrorState`
- [CQCEvidence.jsx](C:/Users/teddy/panama-staffing/.claude/worktrees/quirky-goodall/src/pages/CQCEvidence.jsx) does a large `Promise.all(...)` over multiple modules:
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

### Likely next debugging steps

1. Reproduce `/cqc` on production in a signed-in browser session
2. Capture:
   - browser console
   - `pageerror`
   - failed network requests
3. Check production logs while loading `/cqc`
4. Identify whether:
   - one API in the `Promise.all` is failing
   - or a render-time exception is throwing the route error boundary

This is the next immediate task.

## Other remaining backlog after `/cqc`

### Security / correctness

Still worth finishing:

1. `own` access semantics are still structurally risky
   - [roles.js](C:/Users/teddy/panama-staffing/.claude/worktrees/quirky-goodall/shared/roles.js)
   - [auth.js](C:/Users/teddy/panama-staffing/.claude/worktrees/quirky-goodall/middleware/auth.js)

2. Server-side status transition enforcement is still incomplete on some modules
   - complaints
   - IPC
   - whistleblowing
   - policies
   - risk register

3. Some download helpers still do not route expired sessions through the normal logout path
   - [api.js](C:/Users/teddy/panama-staffing/.claude/worktrees/quirky-goodall/src/lib/api.js)

### Remaining UX holdouts

These are still the main pages left on older patterns:

- [MonthlyTimesheet.jsx](C:/Users/teddy/panama-staffing/.claude/worktrees/quirky-goodall/src/pages/MonthlyTimesheet.jsx)
- [HandoverNotes.jsx](C:/Users/teddy/panama-staffing/.claude/worktrees/quirky-goodall/src/pages/HandoverNotes.jsx)
- [CareCertificateTracker.jsx](C:/Users/teddy/panama-staffing/.claude/worktrees/quirky-goodall/src/pages/CareCertificateTracker.jsx)
- [OnboardingTracker.jsx](C:/Users/teddy/panama-staffing/.claude/worktrees/quirky-goodall/src/pages/OnboardingTracker.jsx)
- [CQCEvidence.jsx](C:/Users/teddy/panama-staffing/.claude/worktrees/quirky-goodall/src/pages/CQCEvidence.jsx)
- [UserManagement.jsx](C:/Users/teddy/panama-staffing/.claude/worktrees/quirky-goodall/src/pages/UserManagement.jsx)
- [AuditLog.jsx](C:/Users/teddy/panama-staffing/.claude/worktrees/quirky-goodall/src/pages/AuditLog.jsx)
- [DpiaManager.jsx](C:/Users/teddy/panama-staffing/.claude/worktrees/quirky-goodall/src/pages/DpiaManager.jsx)
- [RopaManager.jsx](C:/Users/teddy/panama-staffing/.claude/worktrees/quirky-goodall/src/pages/RopaManager.jsx)
- [ReceivablesManager.jsx](C:/Users/teddy/panama-staffing/.claude/worktrees/quirky-goodall/src/pages/ReceivablesManager.jsx)
- [MaintenanceTracker.jsx](C:/Users/teddy/panama-staffing/.claude/worktrees/quirky-goodall/src/pages/MaintenanceTracker.jsx)
- [AgencyTracker.jsx](C:/Users/teddy/panama-staffing/.claude/worktrees/quirky-goodall/src/pages/AgencyTracker.jsx)

### Bigger product polish still possible

- more visible visual redesign of the shell / dashboard
- stronger whole-app typography / spacing / hierarchy polish
- broader premium-feel cleanup beyond structural UX consistency

## Recent `main` history

Current recent `origin/main`:

- `e7f4087` - Document shipped CQC and UX rollout status
- `31c55cd` - Polish shared UX across operations and admin flows
- `fa7fda6` - Polish dense staff compliance workflows
- `4ad2f3f` - Standardize admin workflow page states
- `660f2b0` - Polish app shell and local date defaults
- `0607131` - Trim noisy sidebar links for read-only roles
- `9bda113` - Focus sidebar navigation for workspace roles
- `92e74b6` - Make dashboard role-aware for workspace roles

## Commands that have worked

### SSH to VPS

Use non-interactive key-based SSH:

```powershell
ssh -o BatchMode=yes -i "$env:USERPROFILE\.ssh\hetzner_ed25519" root@178.104.56.116
```

### Check deployed commit

```powershell
ssh -o BatchMode=yes -i "$env:USERPROFILE\.ssh\hetzner_ed25519" root@178.104.56.116 "bash -lc 'cd /var/www/panama-staffing && git rev-parse --short HEAD'"
```

### Check health/readiness

```powershell
curl.exe -s http://178.104.56.116/health
curl.exe -s http://178.104.56.116/readiness
```

### Typical deploy pattern used successfully

```powershell
ssh -o BatchMode=yes -i "$env:USERPROFILE\.ssh\hetzner_ed25519" root@178.104.56.116 "bash -lc 'set -e; cd /var/www/panama-staffing; git pull --ff-only origin main; source /root/.nvm/nvm.sh; nvm use 22 >/dev/null; npm ci; node scripts/migrate.js; npm run build; pm2 reload panama --update-env'"
```

Important:

- do **not** run `git pull` and `node scripts/migrate.js` in parallel

## Best next move for a new instance

1. Reproduce and fix the live `/cqc` failure first
2. Use a clean `main`-based branch for the fix
3. Verify locally
4. Deploy sequentially to VPS
5. Smoke test `/cqc` live
6. Then return to the remaining security / correctness backlog

## Bottom line

The app is in a much stronger state than it was:

- CQC / evidence / readiness work is shipped
- later UX consistency work is shipped
- production is healthy

But there is still active work left:

- the live `/cqc` issue the user just reported
- remaining security / correctness cleanup
- the last UX holdout pages

