# Mainline And Release Safety

Last updated: 2026-04-25

## Source Of Truth

`origin/main` is the mainline branch. A release is current only when all three
checks point at the same commit:

- local `HEAD`
- `origin/main`
- VPS checkout at `/var/www/panama-staffing`

The release-safety baseline is tagged
`v2026.04.25-release-safety-spine`. The known-good baseline immediately
before this safety-spine work was `a4ba9ce Keep platform nav link clear`,
tagged `v2026.04.25-hr-ui-compliance-verify`.

## Before Starting Work

Run:

```bash
bash scripts/verify-baseline.sh
```

With VPS verification:

```bash
VPS_HOST=178.104.56.116 VPS_USER=root VPS_PATH=/var/www/panama-staffing VPS_SSH_KEY=/c/Users/teddy/.ssh/hetzner_ed25519 bash scripts/verify-baseline.sh
```

If local, `origin/main`, and VPS do not match, stop and reconcile before making
new changes.

## Required Pre-Main Gate

For normal UI/backend changes:

```bash
npm run lint
npm run build
npm run test:frontend
npm run test:golden
```

For route, auth, migration, compliance, payroll, HR, GDPR, CQC, incident, or
cross-module changes, also run:

```bash
npm run test:integration
npm run test:e2e
```

`npm run test:release` runs the broad local gate: lint, build, frontend tests,
and the full Playwright suite.

## Golden Journey Coverage

The golden Playwright pack protects the routes and buttons that should never be
broken by an iteration:

- dashboard, daily status, roster, annual leave
- staff database and training
- incidents, CQC evidence, DoLS/LPS, risk register
- HR dashboard, absence, EDI, TUPE, DBS/RTW renewals
- finance, residents, payroll, timesheets
- GDPR, Evidence Hub, user management, platform home management
- critical modal open/close paths for incidents, staff, GDPR, and users

## Role Matrix Coverage

The role matrix proves the expected access boundaries for:

- platform admin
- home manager
- shift coordinator
- viewer

It checks both UI route access and sensitive API denial/allowance for HR, GDPR,
incidents, platform admin, and user-management paths.

## Deploy Verification

After pushing `main` and deploying the VPS, run:

```bash
BASE_URL=http://178.104.56.116 SMOKE_USERNAME=admin SMOKE_PASSWORD='***' bash scripts/smoke-vps.sh
```

Then run the baseline check again with VPS variables set. Record the new commit
in `docs/CURRENT_BASELINE.md` and tag it only after smoke checks pass.
