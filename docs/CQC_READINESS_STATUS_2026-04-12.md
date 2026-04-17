# CQC Readiness Deployment Status - 2026-04-12

This note exists so `quirky-goodall` is not mistaken for the source of truth.

## Live truth

- `origin/main` is at commit `31c55cd`
- VPS `/var/www/panama-staffing` is also at commit `31c55cd`
- Production health is green:
  - `/health` -> `{"status":"ok","db":"ok"}`
  - `/readiness` -> `{"status":"ready"}`

Later UX-focused shipped work is tracked separately in
[UX_SHIPPED_STATUS_2026-04-13.md](UX_SHIPPED_STATUS_2026-04-13.md).

## Already shipped

### Evidence Hub

- `23b5e1a` - Add cross-module Evidence Hub
- `d414e9e` - Add folder cabinet view to Evidence Hub

### CQC readiness foundation

- `68e29b2` - Add CQC readiness backend foundation

Included:

- migration `138_create_cqc_statement_narratives.sql`
- migration `139_add_cqc_evidence_owner_review.sql`
- migration `140_align_cqc_evidence_categories.sql`
- `repositories/cqcNarrativeRepo.js`
- normalized evidence categories
- readiness backend integration coverage

### CQC readiness engine + UI

- `8445db5` - Add CQC readiness analysis and UI

Included:

- `src/lib/cqcStatementExpectations.js`
- `src/lib/cqcReadiness.js`
- readiness summary cards, badges, gaps, and self-assessment UI
- readiness included in assessment snapshots
- readiness summary added to the evidence pack PDF

### Structured SAF evidence workflows

- `2b80ac9` - Add structured CQC SAF evidence workflows

Included:

- migration `141_create_cqc_partner_feedback.sql`
- migration `142_create_cqc_observations.sql`
- `repositories/cqcPartnerFeedbackRepo.js`
- `repositories/cqcObservationRepo.js`
- partner feedback CRUD in `routes/cqcEvidence.js`
- observation CRUD in `routes/cqcEvidence.js`
- readiness/snapshot aggregation for both structured evidence types
- Evidence Hub CQC metadata:
  - `qualityStatementId`
  - `evidenceCategory`
  - `evidenceOwner`
  - `reviewDueAt`
  - `freshness`

### Readiness v2 refinement

- `96339ca` - Refine CQC readiness authority and governance

Included:

- migration `143_add_cqc_narrative_governance.sql`
- server-authored live readiness endpoint:
  - `GET /api/cqc-evidence/readiness?home=X&dateRange=...`
- per-category freshness thresholds in `src/lib/cqcReadiness.js`
- question-level readiness summaries as the primary live view
- narrative governance updates in `repositories/cqcNarrativeRepo.js`
- GDPR / retention handling for `cqc_statement_narratives`
- snapshot payloads continue to carry frozen readiness data

### CQC supporting-file clarity hotfix

- `38ed978` - Clarify CQC supporting file state

Included:

- manual CQC evidence rows now show attached file counts
- create/update now reject `date_to` earlier than `date_from`
- the CQC evidence modal now states more clearly that `Save Evidence` does not upload the selected file
- CQC evidence create/update responses now include `file_count`

### Auth and rate-limit hardening

- `10e1bb3` - Close remaining auth and rate-limit gaps

Included:

- migration `146_create_rate_limit_hits.sql`
- Postgres-backed shared rate limiter storage
- legacy env-var auth fallback disabled by default
- Evidence Hub filtered-count SQL fix
- narrative upsert race hardening
- remaining local-date default fixes
- Excel export sanitization hardening

### Proxy trust fix

- `9e1a290` - Respect proxy headers behind nginx

Included:

- explicit `TRUST_PROXY` runtime support in `config.js`
- `server.js` now trusts the first proxy when `TRUST_PROXY=1`
- VPS `.env` updated with `TRUST_PROXY=1`
- rate limiting now sees the real client IP behind nginx without forcing `NODE_ENV=production`

### GDPR workflow enforcement + CI unblock

- `ff98722` - Enforce DPIA and ROPA status workflows
- `06fe7ff` - Unblock CI lint and regression checks

Included:

- server-side DPIA status transition enforcement via `lib/statusTransitions.js`
- server-side ROPA status transition enforcement via `lib/statusTransitions.js`
- route-level validation in `routes/dpia.js` and `routes/ropa.js`
- DB-backed regression coverage in `tests/integration/gdprStatusTransitions.test.js`
- lint-safe React refactors in:
  - `src/components/CoverageAlertBanner.jsx`
  - `src/components/StaffPicker.jsx`
  - `src/hooks/useSchedulingEditLock.js`
  - `src/pages/Dashboard.jsx`
  - `src/pages/ScenarioModel.jsx`
- small test/workflow cleanups so `npm run lint` is green on `main`

## Production verification completed

### Local verification before deploy

- production build passed
- targeted UI/unit tests passed
- DB-backed integration tests passed on the disposable Postgres test DB

### Deploy note

During first deploy attempt, `git pull` and `node scripts/migrate.js` were started in parallel.
That allowed the migration runner to execute against the old checkout before files `141` and `142`
were present, so production briefly had the new code without the new tables.

This was repaired immediately by rerunning migrations sequentially on the updated checkout:

- `141_create_cqc_partner_feedback.sql`
- `142_create_cqc_observations.sql`

Safe rule: do not run `git pull` and migrations in parallel.

### Live smoke completed

Verified on production with a temporary smoke home and users, then cleaned up:

- viewer received `403` on `/api/cqc-evidence`
- viewer could hit Evidence Hub search but received an empty result set, not widened CQC access
- narrative save worked
- manual CQC evidence save worked with `evidence_owner` and `review_due`
- CQC file upload worked
- partner feedback create/update/list/delete worked
- observation create/update/list/delete worked
- CQC snapshot create worked
- self sign-off was blocked
- independent sign-off by a second manager worked
- Evidence Hub search showed CQC metadata fields correctly
- Evidence Hub uploaders reflected the uploaded evidence
- CQC file download worked
- deleting the attachment removed it from Evidence Hub search
- `/cqc` and `/evidence` both returned `200` from nginx

Temporary smoke data and uploaded files were cleaned back out afterwards.

### Additional live verification after `96339ca`

Verified on production with a second isolated smoke home and users, then cleaned up:

- `/api/cqc-evidence/readiness` returned a full server-authored payload with `entries`, `questionSummary`, `gaps`, and `overall`
- `/cqc` rendered the live readiness view without falling back to the client-side warning path
- representative statement accordions expanded across Safe / Effective / Caring / Responsive / Well-Led
- self-assessment narrative save still worked
- partner feedback save still worked
- observation save still worked
- manual evidence save with `evidence_owner` and `review_due` still worked
- snapshot creation still worked
- self sign-off was still blocked
- signed-off snapshot payload still included frozen readiness on the API
- Evidence Hub still returned the expected CQC SAF metadata
- Evidence Hub folder view, download, XLSX export, and delete still worked

One note from the browser-driven smoke:

- the frozen snapshot readiness block was confirmed through the snapshot API payload
- the browser automation hit a selector seam when trying to assert that block inside the modal DOM
- that was treated as a test harness issue, not a production payload issue, because the live snapshot API clearly contained the readiness structure

### Additional live verification after `38ed978`

Verified on production against the real Oakwood CQC page using a temporary scoped smoke user, then cleaned up:

- the existing `ik` evidence row under `S2` now visibly shows `0 files`
- live authenticated API rejects reversed date ranges with:
  - `400 {"error":"Evidence To cannot be before Evidence From"}`
- production health remained green after deploy:
  - `/health` -> `{"status":"ok","db":"ok"}`
  - `/readiness` -> `{"status":"ready"}`

### Additional live verification after `10e1bb3` and `9e1a290`

Verified on production using the temporary smoke home `smoke-fixes-20260412`, then cleaned up fully:

- `/health` returned `{"status":"ok","db":"ok"}`
- `/readiness` returned `{"status":"ready"}`
- viewer received `403` on `/api/cqc-evidence/readiness`
- staff own-data scheduling still returned exactly the linked staff row and did not leak `hourly_rate`
- finance officer Evidence Hub record search returned only finance-owned rows
- a real CQC file upload and authenticated download both worked end to end
- narrative save still worked
- live GDPR erasure executed successfully for smoke staff `S001`
- production DB confirmed redaction to `[REDACTED-S001]` in:
  - `cqc_evidence.evidence_owner`
  - `cqc_partner_feedback.partner_name`
  - `cqc_partner_feedback.evidence_owner`
  - `cqc_observations.observer`
  - `cqc_observations.evidence_owner`
- the temporary smoke home, smoke users, related uploaded files, and smoke audit/access data were removed afterwards
- nginx proxy traffic no longer increased `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` warnings after enabling `TRUST_PROXY=1`

### Additional live verification after `ff98722` and `06fe7ff`

Verified on production with temporary smoke home `cqc-smoke-33095816` and user `cqcsmoke_33095816`, then cleaned up:

- VPS fast-forwarded cleanly from `9e1a290` to `06fe7ff`
- `npm ci`, `npm run build`, and `pm2 reload panama --update-env` all completed successfully on-box
- `/health` returned `{"status":"ok","db":"ok"}`
- `/readiness` returned `{"status":"ready"}`
- live login for the temporary home manager worked
- DPIA route blocked the invalid transition:
  - `screening -> approved` returned `400`
- DPIA route still allowed the valid workflow:
  - `screening -> in_progress -> completed -> approved`
- ROPA route still allowed the valid workflow:
  - `active -> under_review -> archived`
- ROPA route blocked the invalid reopen:
  - `archived -> under_review` returned `400`
- the temporary smoke home, smoke user, and related DPIA / ROPA records were removed afterwards

## What is still future work

Not shipped as part of the current readiness release:

- richer first-class partner feedback UX beyond the CQC workflow itself
- richer first-class observation UX beyond the CQC workflow itself
- any unrelated stabilization work still sitting in `quirky-goodall`

## Local-only work still in `quirky-goodall`

The readiness-v2 refinement listed above is no longer local-only; it shipped in `96339ca`.

What remains local-only here is unrelated mixed work outside the extracted CQC / Evidence tranches.

## Important warning about `quirky-goodall`

Do not deploy this whole branch wholesale.

Reason:

- it still contains mixed local work outside the extracted shipped tranches
- it still contains branch drift that is not a clean forward patch from current `main`

## Safe rule

For future CQC or SAF work:

1. start from current `main`
2. extract only the next clean tranche
3. verify locally
4. deploy sequentially
5. update this note
