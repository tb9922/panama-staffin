# Current Baseline

Last updated: 2026-04-25

## Source Of Truth

- Current release tag: `v2026.04.25-release-safety-spine`
- Previous baseline tag: `v2026.04.25-hr-ui-compliance-verify` at `a4ba9ce`
- Working rule: future feature, UI, and compliance work should branch from the current release tag or a newer tagged baseline.
- Verification rule: local `HEAD`, `origin/main`, and the VPS checkout must resolve to the same commit before a release is treated as current.
- Mainline rule: see `docs/MAINLINE.md` for the required pre-main and post-deploy gates.

## What Was Verified

- Local lint, production build, frontend tests, golden journey/role matrix, full Playwright E2E, and full disposable-DB integration tests passed before release.
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
VPS_HOST=your-host VPS_USER=your-user VPS_PATH=/path/to/panama-staffing VPS_SSH_KEY=~/.ssh/id_ed25519 bash scripts/verify-baseline.sh
```

For authenticated smoke checks:

```bash
BASE_URL=https://your-vps-url SMOKE_USERNAME=admin SMOKE_PASSWORD='***' bash scripts/smoke-vps.sh
```

Do not store live passwords in this file.
