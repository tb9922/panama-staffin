# Current Baseline

Last updated: 2026-04-25

## Source Of Truth

- Current release tag: `v2026.04.25-hr-ui-compliance`
- Previous baseline tag: `v2026.04.25-auth-audit` at `ce1c4c6`
- Working rule: future feature, UI, and compliance work should branch from the current release tag or a newer tagged baseline.
- Verification rule: local `HEAD`, `origin/main`, and the VPS checkout must resolve to the same commit before a release is treated as current.

## What Was Verified

- Local lint, build, frontend tests, and full disposable-DB integration tests passed before release.
- Public health checks should respond after deploy: `/health`, `/readiness`.
- Authenticated smoke paths should respond with admin credentials after deploy:
  - `/api/homes`
  - `/api/audit`
  - `/api/gdpr/access-log`

## How To Check Baseline Again

Run:

```bash
bash scripts/verify-baseline.sh
```

With VPS checking enabled:

```bash
VPS_HOST=your-host VPS_USER=your-user VPS_PATH=/path/to/panama-staffing bash scripts/verify-baseline.sh
```

For authenticated smoke checks:

```bash
BASE_URL=https://your-vps-url SMOKE_USERNAME=admin SMOKE_PASSWORD='***' bash scripts/smoke-vps.sh
```

Do not store live passwords in this file.
