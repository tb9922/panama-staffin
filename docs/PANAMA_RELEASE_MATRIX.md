# Panama Release Matrix

This is the repeatable gate for proving a Panama change is ready for main and VPS.

## Master Command

Run the full local release gate:

```bash
npm run test:master
```

Run the faster pre-push gate:

```bash
npm run test:master:fast
```

Every run writes evidence to `.review/release-gates/`:

- one Markdown summary
- one JSON summary
- one log file per gate

## What The Master Gate Covers

The full gate runs:

- git branch/status/head visibility
- lint
- production build
- frontend component tests
- unit/library tests
- staff, governance, and HR module suites
- full integration suite on disposable Postgres
- route RBAC audit
- HR encryption verifiers
- action backfill verifier
- V1 operational gates in strict mode
- V1 scale load check
- golden Playwright journeys
- full Playwright E2E suite
- UI button stress sweep
- production dependency audit

The fast gate runs the highest-signal subset: lint, build, unit/library tests, route audit, golden journeys, and production dependency audit.

## Seeded Edge Homes

The Playwright seed now creates release-matrix homes:

- `e2e-empty-home` - brand new home shape; catches new-home create/save bugs.
- `e2e-normal-home` - normal operational data.
- `e2e-messy-home` - overdue action and incident pressure.

The golden release journey includes:

- add staff on an empty home
- manual CQC evidence save on an empty home
- invalid CQC evidence date rejection
- portfolio KPI visibility for all release-matrix homes

## Human Sign-Off

Automated gates do not replace the last manual checks. Before a VPS push, Teddy signs off:

- the feature works end-to-end in the browser
- no required gate failed silently
- any skipped gate has a written reason
- `.review/release-gates/` contains the latest report
- live VPS health/readiness passes after deploy
