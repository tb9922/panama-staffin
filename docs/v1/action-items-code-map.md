# Panama V1 Corrective Actions Code Map

Date: 2026-04-26
Branch: v1-os

This is the required read-only map before creating the V1 `action_items`
migration. It normalises the existing action-like fields into one source of
truth while keeping the legacy module fields readable during transition.

## Scope

Primary week-1 sources from the V1 plan:

- incidents
- IPC audits
- risk register
- complaints and complaint surveys
- maintenance
- fire drills
- supervisions
- appraisals

Additional action-like sources discovered while mapping:

- HR grievance outcome actions already live in `hr_grievance_actions`
- CQC observations and statement narratives have free-text `actions`
- dashboard counters currently query legacy incident, IPC and risk JSON actions

These discovered sources should be pulled into `action_items` during the same
transition window or explicitly frozen before V1 close, otherwise Panama will
retain parallel accountability systems.

## Normalised Target

`action_items` should support these fields:

- `home_id`
- `source_type`
- `source_id TEXT`
- `source_action_key TEXT`
- `title`
- `description`
- `category`
- `priority`
- `owner_user_id`
- `owner_name`
- `owner_role`
- `due_date`
- `status`
- `evidence_required`
- `evidence_notes`
- `escalation_level`
- `escalated_at`
- `completed_at`
- `completed_by`
- `verified_at`
- `verified_by`
- `created_by`
- `updated_by`
- `version`
- `created_at`
- `updated_at`
- `deleted_at`

`source_id` must be text. Current source IDs include `inc-*`, `mnt-*`, `fd-*`,
`sup-*`, `apr-*`, `cmp-*`, `srv-*`, and numeric HR/CQC IDs.

`source_action_key` must be deterministic for backfill:

- JSON arrays: `legacy:<ordinal>:<hash(description|owner|due_date|status)>`
- Text fields: `legacy:<field-name>:<hash(text)>`
- Derived maintenance rows: `derived:<field-name>:<hash(description|due-date)>`

The unique identity should be `(home_id, source_type, source_id,
source_action_key)` for non-deleted rows.

## Status Normalisation

| Legacy value | action_items.status |
| --- | --- |
| `pending` | `open` |
| `open` | `open` |
| `overdue` | `open` |
| `in_progress` | `in_progress` |
| `completed` | `completed` |
| `cancelled` | `cancelled` |

Legacy records do not become `verified`; verification starts in V1.

## Category Normalisation

The original plan's category list is too narrow for the codebase. Use this V1
set so existing data is not forced into misleading buckets:

- `safeguarding`
- `clinical`
- `environmental`
- `hr`
- `governance`
- `compliance`
- `staffing`
- `finance`
- `operational`

## Source Mapping

| Source | Table / repo | Legacy field shape | Backfill into `action_items` |
| --- | --- | --- | --- |
| Incident actions | `incidents.corrective_actions`, `incidentRepo.js` | JSONB array `{ description, assigned_to, due_date, completed_date, status }`; route also maps legacy `open` to `pending` | One row per array element. `source_type='incident'`, `source_id=incidents.id`, title from `description`, owner from `assigned_to`, due from `due_date`, completed from `completed_date`. |
| IPC audit actions | `ipc_audits.corrective_actions`, `ipcRepo.js` | JSONB array `{ description, assigned_to, due_date, completed_date, status }`; statuses include `open`, `in_progress`, `completed`, `overdue` | One row per array element. `source_type='ipc_audit'`, `category='clinical'`, priority high if outbreak active or latest score is poor, otherwise medium. |
| Risk actions | `risk_register.actions`, `riskRepo.js` | JSONB array `{ description, owner, due_date, status, completed_date }` | One row per array element. `source_type='risk'`, owner from action `owner` falling back to risk `owner`, category mapped from risk category, priority from residual risk. |
| Complaint improvements | `complaints.improvements`, `complaintRepo.js` | Single text field, not a structured action array | Create one action only when text is non-empty. `source_type='complaint'`, `source_action_key` from `improvements`, due from `response_deadline`, owner from `investigator`, category `governance`. |
| Complaint survey actions | `complaint_surveys.actions`, `complaintSurveyRepo.js` | Single text field | Create one action only when text is non-empty. `source_type='complaint_survey'`, due defaults to `reported_at + 28 days` when available, category `governance`. |
| Maintenance | `maintenance`, `maintenanceRepo.js` | No explicit action field. Has `items_failed`, `next_due`, `certificate_expiry`, `notes` | Do not backfill `notes` as actions. Create derived actions only for `items_failed > 0`, overdue `next_due`, or expired `certificate_expiry`. `source_type='maintenance'`, category `environmental` or `compliance`. |
| Fire drill actions | `fire_drills.corrective_actions`, `fireDrillRepo.js` | Single text field | Create one action when text is non-empty. `source_type='fire_drill'`, due defaults to `date + 28 days`, owner from `conducted_by`, category `compliance`. |
| Supervision actions | `supervisions.actions`, `supervisionRepo.js` | Single text field per staff supervision | Create one action when text is non-empty. `source_type='supervision'`, source description should include `staff_id`, due from `next_due`, owner from `supervisor`, category `hr`. |
| Appraisal development | `appraisals.training_needs` / `development_plan`, `appraisalRepo.js` | Two text fields, no structured action object | Create one action for `development_plan`; create a second training action for `training_needs` only if not already represented by a training record. `source_type='appraisal'`, due from `next_due`, owner from `appraiser`, category `hr`. |
| HR grievance actions | `hr_grievance_actions` | Normalised table with `description`, `responsible`, `due_date`, `completed_date`, `status` | Add to V1 transition after the eight required sources. `source_type='hr_grievance'`, `source_id=grievance_id`, `source_action_key='legacy:hr-grievance-action:<id>'`. |
| CQC observations | `cqc_observations.actions`, `cqcObservationRepo.js` | Single text field with `evidence_owner` and `review_due` | Add to V1 transition. `source_type='cqc_observation'`, owner from `evidence_owner`, due from `review_due`, category `compliance`. |
| CQC narratives | `cqc_statement_narratives.actions`, `cqcNarrativeRepo.js` | Single text field by quality statement | Add to V1 transition. `source_type='cqc_narrative'`, `source_id=quality_statement`, due from `review_due`, category `compliance`. |

## Priority Rules

Priority defaults to `medium`, then escalates by source context:

- incident: `critical` for safeguarding, death, severe harm, serious injury,
  RIDDOR death/specified injury, or overdue CQC notification; `high` for CQC
  notifiable, RIDDOR reportable, duty of candour, hospital attendance, or major
  severity
- IPC: `critical` for confirmed outbreak; `high` for suspected outbreak,
  compliance below 80, or overdue actions
- risk: `critical` when residual risk is 16 or above; `high` when residual risk
  is 9-15
- maintenance: `high` for expired certificates or failed checks; `medium` for
  overdue routine checks
- complaint: `high` when response is overdue or safeguarding/abuse category is
  present
- HR sources: `high` for grievance, disciplinary, discrimination, health and
  safety, or protected-characteristic cases; otherwise `medium`

Critical priority escalates one level faster than the normal overdue cadence.

## Backfill Verification

Backfill must report counts by source:

- legacy candidate count
- inserted action count
- skipped blank count
- duplicate action count
- conflict/update count

Week-4 freeze cannot happen until every candidate row has one matching
non-deleted `action_items` row or an explicit documented skip reason.

The dashboard currently counts overdue actions directly from incident, IPC and
risk legacy JSON. After backfill, those counters must read from `action_items`;
otherwise the dashboard and Manager Actions page will disagree.

## Retention

New V1 accountability tables follow the regulated 7-year minimum:

- `action_items`
- `reflective_practice`
- `agency_approval_attempts`
- `audit_tasks`
- `outcome_metrics`

They must be inserted into `retention_schedule` and the purge script allow-list
when each table lands.
