# CQC Readiness Deployment Status - 2026-04-12

This note records the CQC and Evidence Hub work shipped from clean extraction branches so we do not confuse deployed work with older mixed local branches.

## Current truth

- `origin/main` currently contains the Evidence Hub and CQC readiness releases.
- The VPS deploy should always be checked against `/var/www/panama-staffing` before assuming any local branch is current.
- `quirky-goodall` remains a mixed local worktree and should not be deployed wholesale.

## Already shipped before this tranche

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
- CQC readiness backend tests

### CQC readiness engine + UI

- `8445db5` - Add CQC readiness analysis and UI

Included:

- readiness matrix engine
- readiness cards, badges, gaps, and self-assessment UI
- readiness snapshot payload
- readiness summary in evidence pack PDF

## This tranche

This tranche adds the remaining structured SAF evidence pieces:

- Evidence Hub CQC metadata:
  - `qualityStatementId`
  - `evidenceCategory`
  - `evidenceOwner`
  - `reviewDueAt`
  - `freshness`
- dedicated partner feedback workflow
- dedicated observation workflow
- readiness/snapshot integration for both structured evidence types

## Files in this tranche

- `migrations/141_create_cqc_partner_feedback.sql`
- `migrations/142_create_cqc_observations.sql`
- `repositories/cqcPartnerFeedbackRepo.js`
- `repositories/cqcObservationRepo.js`
- `routes/cqcEvidence.js`
- `services/assessmentService.js`
- `src/lib/cqc.js`
- `repositories/evidenceHubRepo.js`
- `services/evidenceHubService.js`
- `src/pages/EvidenceHub.jsx`
- `src/pages/CQCEvidence.jsx`
- related tests

## Verification expected for this tranche

- production build passes
- targeted UI and readiness tests pass
- DB-backed integration tests pass
- VPS migration applies cleanly
- live smoke covers:
  - partner feedback create/edit/delete
  - observation create/edit/delete
  - readiness changes on `/cqc`
  - Evidence Hub CQC metadata rendering on `/evidence`

## Safe rule

For future CQC work:

1. start from current `main`
2. extract only the next clean tranche
3. verify locally
4. deploy
5. update this note
