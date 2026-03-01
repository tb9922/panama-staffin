# Panama Staffing — Project Guide

Care home staff scheduling app using the Panama 2-2-3 rotation pattern. Built for UK residential care homes. Self-hosted, no subscription.

## Engineering Standards — Always Active

**Default thinking mode: experienced-dev.** Every task in this codebase — writing, reviewing, debugging, architecture, deployment — is performed through the lens of a senior developer with 20+ years of production experience. The full skill is at `~/.claude/commands/experienced-dev.md`.

**Before starting any task, read the relevant reference file:**

| Task | Reference |
|------|-----------|
| Writing new code | `~/.claude/commands/references/writing-code.md` |
| Reviewing code | `~/.claude/commands/references/code-review.md` |
| Architecture / design | `~/.claude/commands/references/architecture.md` |
| Writing tests | `~/.claude/commands/references/testing.md` |
| Deployment / DevOps | `~/.claude/commands/references/devops.md` |
| Debugging | `~/.claude/commands/references/debugging.md` |
| Database work | `~/.claude/commands/references/database.md` |

**Non-negotiables (from the experienced-dev framework):**
- Security is not a feature — every endpoint has auth, every input is validated, every secret is in env vars
- Every line is a liability — solve it with less, not more
- Think in failure modes — what if null? what if concurrent? what if disk full?
- Care home domain: DBS/health/DoLS data is UK GDPR special category — breach = ICO + CQC enforcement
- Availability: 24/7/365 — downtime at shift handover is a clinical safety issue
- Scale: every query/loop must work at 1 home (40 staff) AND 24 homes (1,000+ staff)
- No tests = the code is broken, you just haven't found the bug yet

**Known blocking issues (from full codebase review — fix before second-home deployment):**
1. ~~Non-atomic file writes~~ — FIXED: migrated to PostgreSQL with ACID transactions
2. ~~Race condition on concurrent saves~~ — FIXED: `saveData` uses `SELECT ... FOR UPDATE` row lock inside transaction; optimistic locking check runs after lock acquisition
3. ~~Viewer role receives entire data object~~ — FIXED: `assembleData()` allowlists fields for viewers; DoLS strips resident DoB
4. ~~`xlsx` prototype pollution CVE~~ — FIXED: replaced with `exceljs` 4.4.0
5. ~~Audit log PII retention~~ — FIXED: daily `setInterval` in server.js calls `purgeOlderThan(2555)` (7-year retention)
6. ~~RIDDOR `over_7_day` deadline off by one~~ — FIXED: consolidated via `RIDDOR_CATEGORIES` import
7. ~~`formatDate` local time vs UTC~~ — FIXED: formatDate/parseDate/addDays all use UTC
8. ~~Dashboard `today` not reactive~~ — FIXED: Dashboard uses midnight timer; CoverageAlertBanner uses `useLiveDate` hook
9. ~~XSS via `dangerouslySetInnerHTML`~~ — FIXED: Residents.jsx toast uses JSX elements
10. ~~No CSP header~~ — FIXED: nginx.conf has `Content-Security-Policy` with `default-src 'self'`
11. ~~`data.js` Zod bypass~~ — FIXED: uses `parsed.data` instead of `req.body`
12. ~~Cross-tenant pension leak~~ — FIXED: `pensionRepo.getContributionsByRun` requires `homeId`
13. ~~Dashboard shows deactivated staff training~~ — FIXED: `getTrainingCounts` filters `deleted_at IS NULL` + active staff
14. ~~24 scratch files in repo root~~ — FIXED: removed + gitignored
15. ~~ROLLBACK.md documents non-existent `--down` flag~~ — FIXED: manual rollback procedure

**See `~/.claude/projects/c--Users-teddy-panama-staffing/memory/code-quality.md` for full review findings.**

## Quick Start

```bash
npm run dev          # Starts both servers concurrently
# API: http://localhost:3001   (Express)
# UI:  http://localhost:5173   (Vite + React)
```

Login: `admin/admin123` (edit) or `viewer/view123` (read-only)

## Tech Stack

- **Frontend**: React 19 + Vite 7 + Tailwind CSS 4 + React Router 7
- **Backend**: Express 5 (server.js) — JSON file storage, no database
- **PDF**: jspdf + jspdf-autotable
- **No test framework** — manual testing via API + browser

## Architecture

```
server.js              Express API (port 3001)
src/
  App.jsx              Shell: collapsible sidebar nav (7 groups), login, undo/redo, multi-home, coverage alert banner
  lib/
    rotation.js        Core scheduling engine — Panama pattern, shift classification, cycle math
    escalation.js      Coverage calc, 6-level escalation, cost calc, fatigue check, swap validation
    accrual.js         Holiday accrual engine — leave year, pro-rata, carryover, per-staff entitlement
    training.js        Training compliance — 25 default types, status calc, matrix builder, alerts
    cqc.js             CQC compliance scoring — 34 quality statements (5 CQC questions), 18 weighted metrics, evidence aggregation
    incidents.js       Incident & safety reporting — types, severity, CQC/RIDDOR tracking, alerts, metrics
    complaints.js      Complaints & feedback — categories, statuses, surveys, satisfaction scoring, CQC metrics
    maintenance.js     Maintenance & environment — categories, frequencies, certificate tracking, CQC metrics
    ipc.js             IPC audit — audit types, outbreak tracking, corrective actions, CQC metrics
    riskRegister.js    Risk register — 5x5 matrix, risk bands, actions, review tracking, CQC metrics
    policyReview.js    Policy review — 8 default policies, status tracking, version history, CQC metrics
    whistleblowing.js  Whistleblowing / speak up — anonymous handling, investigation, protection rate, CQC metrics
    dols.js            DoLS/LPS & MCA — applications, authorisations, capacity assessments, CQC metrics
    careCertificate.js Care Certificate — 16 standards (2025 incl. Oliver McGowan), progress tracking, CQC metrics
    onboarding.js      Staff onboarding blocking — DBS, RTW, references, identity checks
    design.js          Design tokens — BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE, ESC_COLORS, HEATMAP
    api.js             Fetch wrappers for all API endpoints
    bankHolidays.js    GOV.UK bank holiday sync
    pdfReports.js      PDF report generation — 15-page CQC evidence pack covering all 5 core questions + 8 modules
  pages/
    Dashboard.jsx      KPI cards, 7-day coverage forecast, cost summary, 24-item alert feed
    DailyStatus.jsx    Day view — staff list, shift overrides, coverage/escalation per period
    RotationGrid.jsx   28-day roster grid with print support
    StaffRegister.jsx  Staff CRUD — add/edit/deactivate, set team/role/rate/skill
    CostTracker.jsx    Daily cost breakdown (base/OT/agency/BH) with period totals
    AnnualLeave.jsx    AL booking with accrual tracking, calendar heatmap, leave year banner
    ScenarioModel.jsx  What-if modelling: sick/AL gaps → float → OT → agency cascade
    FatigueTracker.jsx Consecutive days + WTR 48hr checks per staff
    SickTrends.jsx     Monthly sick counts with exact dates, staff names, reasons
    TrainingMatrix.jsx Mandatory training matrix — grid/list view, record modal, type management
    OnboardingTracker.jsx Staff onboarding — 9 CQC Reg 19 sections, expandable staff list, Excel export
    CareCertificateTracker.jsx Care Certificate — 16 standards, per-staff progress, expandable standards
    CQCEvidence.jsx    CQC compliance evidence — 5 core questions, 34 statements, scorecard, manual evidence, PDF pack
    IncidentTracker.jsx Incident & safety reporting — log, CQC/RIDDOR notifications, DoC, corrective actions
    ComplaintsTracker.jsx Complaints & feedback — complaints table, 3-tab modal, surveys, satisfaction scoring
    MaintenanceTracker.jsx Maintenance & environment — checks, certificates, auto-calculated next due
    IpcAuditTracker.jsx IPC audits — audit scoring, risk areas, corrective actions, outbreak management
    RiskRegister.jsx   Risk register — 5x5 heatmap, risk scoring, actions, review tracking
    PolicyReviewTracker.jsx Policy review — 8 pre-populated policies, version history, mark as reviewed
    WhistleblowingTracker.jsx Whistleblowing — anonymous concerns, investigation workflow, protection tracking
    DolsTracker.jsx    DoLS/LPS & MCA — applications, authorisations, capacity assessments
    BudgetTracker.jsx  Monthly budget vs actual with variance tracking
    Reports.jsx        PDF export for roster, costs, coverage
    Config.jsx         Settings — shifts, rates, minimums, bank holidays, home details
homes/                 JSON data files per care home (gitignored)
backups/               Auto-backups before each save, 20 per home (gitignored)
```

## Data Model

All data is in a single JSON file per home (`homes/{name}.json`). Shape:

```js
{
  config: {
    home_name, registered_beds, care_type,
    cycle_start_date,          // "2025-01-06" — anchor for Panama pattern
    shifts: { E: {hours}, L: {hours}, EL: {hours}, N: {hours} },
    minimum_staffing: {
      early:  { heads, skill_points },
      late:   { heads, skill_points },
      night:  { heads, skill_points },
    },
    agency_rate_day, agency_rate_night, ot_premium, bh_premium_multiplier,
    max_consecutive_days, max_al_same_day, al_entitlement_days,
    leave_year_start,          // "MM-DD" — default "04-01" (UK tax year). Options: 01-01, 04-01, 09-01
    al_carryover_max,          // Max carryover days from previous year, default 8
    training_types: [{         // 25 defaults auto-populated; managers can add/toggle
      id, name, category,      // "statutory" | "mandatory"
      refresher_months, roles,  // null = all staff, or ["Senior Carer", ...]
      legislation, active,
      levels: [{               // Optional tiered levels (safeguarding-adults, mca-dols)
        id, name, roles,       // e.g. "L1" / "L2" / "L3" with role mappings
      }],
    }],
    supervision_frequency_probation: 30,  // Days between supervisions during probation (default 30)
    supervision_frequency_standard: 49,   // Days between supervisions post-probation (default 49 = 7 weeks)
    supervision_probation_months: 6,      // Probation duration in months (default 6)
    bank_holidays: [{ date: "YYYY-MM-DD", name: "..." }],
    bank_staff_pool_size, night_gap_pct,
  },
  staff: [{
    id, name, role, team, pref, skill, hourly_rate,
    active, wtr_opt_out, start_date, contract_hours,
    date_of_birth,             // For NMW age-bracket and pension auto-enrolment (null = default 21+)
    ni_number,                 // UK NI number for payroll export (null = not yet provided)
    al_entitlement,            // Per-staff override of config.al_entitlement_days (null = use global)
    al_carryover,              // Days carried over from previous leave year (default 0, set manually)
    leaving_date,              // Auto-set when deactivated, cleared when reactivated
  }],
  overrides: {
    "YYYY-MM-DD": {
      "staff-id": { shift: "AL", reason: "...", source: "al" }
    }
  },
  annual_leave: { ... },  // Legacy — overrides is the source of truth for AL
  budget: { ... },        // Monthly budget entries
  cqc_evidence: [{        // Manual evidence items tagged to CQC quality statements
    id, quality_statement, // S1-S8, E1-E6, C1-C5, R1-R5, WL1-WL10
    type,                  // "quantitative" | "qualitative"
    title, description,
    date_from, date_to,    // Evidence validity period (date_to null = ongoing)
    added_by, added_at,
  }],
  training: {             // Per-staff training completion records
    "S001": {
      "fire-safety": {
        completed: "2025-06-15",    // Date training was completed
        expiry: "2026-06-15",       // Auto-calculated: completed + refresher_months
        trainer: "Jane Smith",
        method: "classroom",        // classroom | e-learning | practical | online
        certificate_ref: "FS-042",
        notes: "",
        level: "L2",               // Optional — only for types with levels (safeguarding, mca-dols)
      },
    },
  },
  supervisions: {         // Per-staff 1:1 supervision records
    "S001": [{
      id: "sup-1719000000000",
      date: "2025-06-15",
      supervisor: "Jane Smith",
      topics: "...",
      actions: "...",
      next_due: "2025-08-01",     // Auto: date + frequency (30d probation / 49d standard)
      notes: "",
    }],
  },
  appraisals: {           // Per-staff annual appraisal records
    "S001": [{
      id: "apr-1719000000000",
      date: "2025-04-15",
      appraiser: "John Manager",
      objectives: "...",
      training_needs: "...",
      development_plan: "...",
      next_due: "2026-04-15",     // Auto: date + 12 months
      notes: "",
    }],
  },
  fire_drills: [{         // Home-level fire drill records (quarterly requirement)
    id: "fd-1719000000000",
    date: "2025-06-15",
    time: "14:30",
    scenario: "Kitchen fire — full evacuation",
    evacuation_time_seconds: 240,
    staff_present: ["S001", "S003"],
    residents_evacuated: 28,
    issues: "...",
    corrective_actions: "...",
    conducted_by: "Fire Marshal Jane",
    notes: "",
  }],
  incidents: [{              // Incident & safety reporting records
    id, date, time, location, type, severity, description,
    person_affected, person_affected_name, staff_involved: [],
    immediate_action, medical_attention, hospital_attendance,
    cqc_notifiable, cqc_notification_type, cqc_notification_deadline,
    cqc_notified, cqc_notified_date, cqc_reference,
    riddor_reportable, riddor_category, riddor_reported, riddor_reported_date, riddor_reference,
    safeguarding_referral, safeguarding_to, safeguarding_reference, safeguarding_date,
    witnesses: [{ name, role, statement_summary }],
    duty_of_candour_applies, candour_notification_date, candour_letter_sent_date, candour_recipient,
    police_involved, police_reference, police_contact_date,
    msp_wishes_recorded, msp_outcome_preferences, msp_person_involved,
    investigation_status,    // "open" | "under_review" | "closed"
    investigation_start_date, investigation_lead, investigation_review_date,
    root_cause, lessons_learned, investigation_closed_date,
    corrective_actions: [{ description, assigned_to, due_date, completed_date, status }],
    reported_by, reported_at, updated_at,
  }],
  complaints: [{            // Complaints & feedback records (QS23 — Reg 16)
    id, date, raised_by, raised_by_name, category, title, description,
    acknowledged_date, response_deadline, status,
    investigator, investigation_notes,
    resolution, resolution_date, outcome_shared,
    root_cause, improvements, lessons_learned,
    reported_by, reported_at, updated_at,
  }],
  complaint_surveys: [{     // Satisfaction surveys
    id, type, date, title, total_sent, responses,
    overall_satisfaction,    // 1-5
    area_scores: {},
    key_feedback, actions, conducted_by, reported_at,
  }],
  maintenance: [{           // Maintenance & environment checks (QS5 — Reg 15)
    id, category, description, frequency,
    last_completed, next_due, completed_by, contractor,
    items_checked, items_passed, items_failed,
    certificate_ref, certificate_expiry,
    notes, updated_at,
  }],
  ipc_audits: [{            // IPC audit records (QS7 — Reg 12)
    id, audit_date, audit_type, auditor, overall_score, compliance_pct,
    risk_areas: [{ area, severity, details }],
    corrective_actions: [{ description, assigned_to, due_date, completed_date, status }],
    outbreak: { suspected, type, start_date, affected_staff, affected_residents, measures, end_date, status },
    notes, reported_at, updated_at,
  }],
  risk_register: [{         // Risk register (QS31 — Reg 17)
    id, title, description, category, owner,
    likelihood, impact, inherent_risk,
    controls: [{ description, effectiveness }],
    residual_likelihood, residual_impact, residual_risk,
    actions: [{ description, owner, due_date, status, completed_date }],
    last_reviewed, next_review, status,
    created_at, updated_at,
  }],
  policy_reviews: [{        // Policy review tracker (QS31 — Reg 17)
    id, policy_name, policy_ref, category, version,
    last_reviewed, next_review_due, review_frequency_months,
    status, reviewed_by, approved_by,
    changes: [{ version, date, summary }],
    notes, updated_at,
  }],
  whistleblowing_concerns: [{  // Whistleblowing / speak up (QS29 — Reg 17)
    id, date_raised, raised_by_role, anonymous,
    category, description, severity,
    status, acknowledgement_date,
    investigator, investigation_start_date, findings,
    outcome, outcome_details,
    reporter_protected, protection_details,
    follow_up_date, follow_up_completed,
    resolution_date, lessons_learned,
    reported_at, updated_at,
  }],
  dols: [{                  // DoLS/LPS applications (QS3/QS14 — Reg 11/13) — tracks residents
    id, resident_name, dob, room_number,
    application_type,        // "dols" | "lps"
    application_date, authorised, authorisation_date, expiry_date,
    authorisation_number, authorising_authority,
    restrictions: [],
    reviewed_date, review_status, next_review_date,
    notes, updated_at,
  }],
  mca_assessments: [{       // Mental Capacity Act assessments
    id, resident_name, assessment_date, assessor,
    decision_area, lacks_capacity, best_interest_decision,
    next_review_date, notes, updated_at,
  }],
  care_certificate: {       // Care Certificate progress (QS6 — Reg 18) — keyed by staffId
    "S001": {
      start_date, expected_completion, supervisor,
      status, completion_date,
      standards: {
        "std-1": {
          knowledge: { date, assessor, status, score, notes },
          observations: [{ date, observer, evidence, status }],
          completion_date, status,
        },
        // ... std-2 through std-16
      },
    },
  },
}
```

### Teams
- `Day A`, `Day B` — follow Panama A/B patterns for day shifts
- `Night A`, `Night B` — follow A/B patterns but assigned N shift
- `Float` — scheduled as AVL, deployed to fill gaps

### Staff Roles (care roles count toward coverage)
`Senior Carer`, `Carer`, `Team Lead`, `Night Senior`, `Night Carer`, `Float Senior`, `Float Carer`

## Panama 2-2-3 Pattern

14-day repeating cycle. Two teams alternate:
```
A: [1,1,0,0,1,1,1,0,0,1,1,0,0,0]  (1=working, 0=off)
B: [0,0,1,1,0,0,0,1,1,0,0,1,1,1]  (complement of A)
```

`getCycleDay(date, cycleStartDate)` returns 0-13 position in cycle.
`getScheduledShift(staff, cycleDay, date)` returns the base shift before overrides.

## Shift Codes

| Code | Type | Description |
|------|------|-------------|
| E, L, EL | Regular | Early, Late, Early-Late (full day) |
| N | Regular | Night |
| OFF | Non-working | Scheduled off |
| AL | Non-working | Annual leave |
| SICK | Non-working | Sick |
| ADM, TRN | Working | Admin, Training (count as working hours) |
| AVL | Float | Float staff available for deployment |
| OC-E, OC-L, OC-EL, OC-N | Overtime | On-call/overtime shifts (attract OT premium) |
| AG-E, AG-L, AG-N | Agency | Agency cover (use agency rates, not staff rates) |
| BH-D, BH-N | Bank Holiday | Auto-applied on bank holidays (attract BH premium) |

Key arrays in rotation.js: `WORKING_SHIFTS`, `EARLY_SHIFTS`, `LATE_SHIFTS`, `NIGHT_SHIFTS`, `OT_SHIFTS`, `AGENCY_SHIFTS`, `BH_SHIFTS`, `DAY_SHIFTS`

## Escalation Model (6 levels)

Coverage is checked per period (early/late/night) against `config.minimum_staffing`:

| Level | Status | Trigger |
|-------|--------|---------|
| LVL0 | Normal | Fully covered, no extras needed |
| LVL1 | Float | Covered with float deployment |
| LVL2 | OT/OC-L | Covered with overtime shifts |
| LVL3 | Agency | Covered but agency staff used |
| LVL4 | Short/Skill Gap | Heads or skill points below minimum |
| LVL5 | UNSAFE | Well below minimum — CQC risk |

Functions: `calculateCoverage()`, `getEscalationLevel()`, `getDayCoverageStatus()`

## Cost Calculation

`calculateDayCost(staffForDay, config)` returns:
- `base` — hours x staff hourly_rate
- `otPremium` — hours x config.ot_premium (for OC-* shifts)
- `agencyDay/agencyNight` — hours x config.agency_rate_day/night (for AG-* shifts)
- `bhPremium` — hours x rate x (bh_premium_multiplier - 1) (for BH-* shifts)

Agency shifts use agency rates, NOT staff rates. BH auto-upgrade happens in `getStaffForDay()`.

## Override System

All schedule changes go through overrides. The `getActualShift()` function checks overrides first, falls back to scheduled pattern. `getStaffForDay()` builds the full picture for a date:
1. Gets each active staff member's actual shift
2. Auto-upgrades to BH-D/BH-N on bank holidays
3. Includes virtual agency entries (overrides for IDs not in staff list)

## API Endpoints (server.js)

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/login | Auth — returns {username, role} |
| GET | /api/homes | List all homes |
| GET | /api/data?home=X | Load home data |
| POST | /api/data?home=X&user=Y | Save home data (validates, backs up, audits) |
| GET | /api/audit | Last 100 audit entries |
| GET | /api/export?home=X | Download home data as JSON |
| GET | /api/bank-holidays | Proxy to GOV.UK API |

Server-side `validateOverrides()` checks max AL per day, entitlement per staff, NLW compliance, training compliance, and all 8 compliance module deadlines (complaints, maintenance, IPC, risks, policies, whistleblowing, DoLS, Care Certificate) on every save.

## Key Functions Reference

### rotation.js
- `getCycleDay(date, cycleStartDate)` — returns 0-13 position (UTC-safe)
- `getScheduledShift(staff, cycleDay, date)` — base shift from pattern + team + preference
- `getActualShift(staff, date, overrides, cycleStartDate)` — override or scheduled
- `getStaffForDay(staff, date, overrides, config)` — full day build with BH upgrade + virtual agency
- `calculateStaffPeriodHours(staff, dates, overrides, config)` — hours/pay for a date range
- `isBankHoliday(date, config)` / `getBankHoliday(date, config)` — bank holiday lookup

### escalation.js
- `calculateCoverage(staffForDay, period, config)` — heads + skill points vs minimum
- `getEscalationLevel(coverage, staffForDay)` — 0-5 level determination
- `getDayCoverageStatus(staffForDay, config)` — early/late/night + overall
- `calculateDayCost(staffForDay, config)` — full cost breakdown
- `checkFatigueRisk(staffMember, date, overrides, config)` — consecutive working days
- `calculateScenario(sickPerDay, alPerDay, config)` — what-if gap modelling
- `validateSwap(fromStaff, toStaff, date, overrides, config)` — swap safety check

### accrual.js
- `getLeaveYear(date, leaveYearStart)` — returns { start, end, startStr, endStr } for the leave year containing the given date
- `countALInLeaveYear(staffId, overrides, leaveYear)` — count AL overrides within a leave year
- `calculateAccrual(staff, config, overrides, asOfDate)` — full accrual calc: pro-rata from start_date, monthly 1/12th accrual, carryover, returns { baseEntitlement, entitlement, accrued, used, remaining, yearRemaining, isProRata, leaveYear }
- `getAccrualSummary(activeStaff, config, overrides, asOfDate)` — returns Map<staffId, accrualResult> for all active staff

### training.js
- `DEFAULT_TRAINING_TYPES` — 25-item array of UK statutory/mandatory training types
- `DEFAULT_TRAINING_LEVELS` — tiered levels for safeguarding-adults (L1/L2/L3), mca-dols (basic/advanced), oliver-mcgowan (tier1/tier2), dementia-awareness (tier1/tier2/tier3)
- `getTrainingTypes(config)` — returns config.training_types or defaults
- `ensureTrainingDefaults(data)` — populates training_types, supervisions, appraisals, fire_drills, levels if missing
- `getRequiredLevel(trainingType, staffRole)` — finds required level for a staff role (highest matching)
- `compareLevels(trainingType, levelIdA, levelIdB)` — compares two level positions (-1/0/1)
- `getTrainingStatus(staff, type, staffRecords, asOfDate)` — returns { status, record, daysUntilExpiry, requiredLevel }
- `buildComplianceMatrix(activeStaff, types, trainingData, asOfDate)` — Map<staffId, Map<typeId, statusResult>>
- `getComplianceStats(matrix)` — { totalRequired, compliant, expiringSoon, urgent, expired, notStarted, wrongLevel, compliancePct }
- `getTrainingAlerts(activeStaff, types, trainingData, asOfDate)` — alert objects for Dashboard (includes wrong level alerts)
- `isInProbation(staff, config, asOfDate)` — true if within supervision_probation_months of start_date
- `getSupervisionFrequency(staff, config, asOfDate)` — returns days (30 probation / 49 standard)
- `getSupervisionStatus(staff, config, supervisionsData, asOfDate)` — { status, lastSession, nextDue, daysUntilDue, overdueDays }
- `getSupervisionStats(activeStaff, config, supervisionsData, asOfDate)` — { total, upToDate, dueSoon, overdue, notStarted, completionPct }
- `calculateSupervisionCompletionPct(data, asOfDate)` — % for CQC supervisionCompletion metric
- `getSupervisionAlerts(activeStaff, config, supervisionsData, asOfDate)` — alert objects for Dashboard
- `getAppraisalStatus(staff, appraisalsData, asOfDate)` — { status, lastAppraisal, nextDue, daysUntilDue, overdueDays }
- `getAppraisalStats(activeStaff, appraisalsData, asOfDate)` — { total, upToDate, dueSoon, overdue, notStarted, completionPct }
- `getAppraisalAlerts(activeStaff, appraisalsData, asOfDate)` — alert objects for Dashboard
- `FIRE_DRILL_FREQUENCY_DAYS` — 91 (quarterly)
- `getFireDrillStatus(fireDrills, asOfDate)` — { status, lastDrill, nextDue, daysUntilDue, drillsThisYear, avgEvacTime }
- `getFireDrillAlerts(fireDrills, asOfDate)` — alert objects for Dashboard (overdue + <4/year)
- `BLOCKING_TRAINING_TYPES` — ['fire-safety', 'moving-handling', 'safeguarding-adults']
- `getTrainingBlockingReasons(staffId, staffRole, trainingData, config, asOfDate)` — returns string[] for staff with expired/missing blocking types

### cqc.js
- `QUALITY_STATEMENTS` — 34 quality statements across all 5 CQC core questions: S1-S8 (Safe), E1-E6 (Effective), C1-C5 (Caring), R1-R5 (Responsive), WL1-WL10 (Well-Led)
- `METRIC_DEFINITIONS` — 18 weighted metrics (all available), weights sum to 1.0
- `calculateComplianceScore(data, dateRange, asOfDate)` — composite weighted score, returns { overallScore, band, metrics }
- `calculateStaffingFillRate(data, dateRange)` — daily coverage fill rate over date range
- `calculateAgencyDependencyPct(data, dateRange)` — agency cost as % of total staffing cost
- `calculateTrainingBreakdown(data, asOfDate)` — per-type compliance with non-compliant staff list
- `calculateFireDrillCompliancePct(data, asOfDate)` — fire drill quarterly compliance
- `calculateAppraisalCompletionPct(data, asOfDate)` — annual appraisal completion rate
- `calculateMcaTrainingCompliancePct(data, asOfDate)` — MCA/DoLS training compliance
- `calculateEqualityTrainingPct(data, asOfDate)` — equality & diversity training compliance
- `calculateDataProtectionTrainingPct(data, asOfDate)` — data protection training compliance
- `calculateFatigueBreachesPct(data, dateRange)` — % of staff with fatigue risk breaches
- `calculateStaffTurnover(data, dateRange)` — leavers / avg headcount over period
- `calculateTrainingTrend(data, asOfDate)` — current vs 90-day-ago compliance delta
- `getEvidenceForStatement(statementId, data, dateRange, asOfDate)` — auto + manual evidence per statement
- `getCoverageSummary(data, dateRange)` — daily coverage rows for PDF
- `getDbsStatusList(data)` — DBS/RTW status per care staff for PDF
- `ensureCqcDefaults(data)` — adds cqc_evidence: [] if missing

### incidents.js
- `DEFAULT_INCIDENT_TYPES` — 17-item array across 6 categories (clinical, safeguarding, workplace, behavioural, environmental, other)
- `SEVERITY_LEVELS` — minor, moderate, serious, major, catastrophic (with badge keys)
- `INVESTIGATION_STATUSES` — open, under_review, closed
- `CQC_NOTIFICATION_TYPES` — 7 types with deadline (immediate=24h or 72h, includes seclusion/restraint)
- `RIDDOR_CATEGORIES` — 4 types with deadline days
- `getIncidentTypes(config)` — returns config.incident_types or defaults
- `ensureIncidentDefaults(data)` — adds incidents: [] and config.incident_types if missing
- `isCqcNotificationOverdue(incident)` — check if CQC notification deadline exceeded
- `isDutyOfCandourOverdue(incident)` — check if DoC notification not sent within 10 working days
- `isRiddorOverdue(incident)` — check if RIDDOR reporting deadline exceeded
- `calculateActionCompletionRate(incidents, fromDate, toDate)` — corrective action completion % and overdue count
- `getIncidentStats(incidents, config, fromDate, toDate)` — totals, by severity/type, open investigations, pending notifications
- `getIncidentAlerts(incidents)` — alert objects for Dashboard (overdue notifications, DoC, corrective actions, stale investigations)
- `calculateIncidentResponseTime(incidents, fromDate, toDate)` — CQC metric: % notified within deadline
- `calculateCqcNotificationsPct(incidents, fromDate, toDate)` — CQC metric: notification compliance %
- `getSafeguardingIncidentStats(incidents, fromDate, toDate)` — safeguarding incident counts for S3 evidence
- `getIncidentTrendData(incidents, fromDate, toDate)` — monthly trend data for WL2 evidence

### complaints.js
- `DEFAULT_COMPLAINT_CATEGORIES` — 8 categories (care quality, medication, staffing, communication, facilities, food, dignity, other)
- `COMPLAINT_STATUSES` — open, acknowledged, investigating, resolved, closed
- `ensureComplaintDefaults(data)` — adds complaints[], complaint_surveys[], config.complaint_categories
- `getComplaintStats(complaints, fromDate, toDate)` — total, open, avgResponseDays, resolutionRate, overdue
- `getComplaintAlerts(complaints)` — unacknowledged >2 days, overdue response deadlines
- `getSurveyAlerts(surveys)` — low satisfaction alerts
- `calculateComplaintResolutionRate(data, fromDate, toDate)` — CQC metric
- `calculateSatisfactionScore(data, fromDate, toDate)` — CQC metric

### maintenance.js
- `DEFAULT_MAINTENANCE_CATEGORIES` — 8 items (PAT, legionella, gas, fire risk, water, electrical, HVAC, equipment)
- `ensureMaintenanceDefaults(data)` — adds maintenance[], config.maintenance_categories
- `getMaintenanceStatus(check, asOfDate)` — status, daysUntilDue, isOverdue
- `getMaintenanceStats(maintenance, asOfDate)` — total, compliant, overdue, dueSoon, compliancePct
- `getMaintenanceAlerts(maintenance, asOfDate)` — overdue checks, expired certificates
- `calculateMaintenanceCompliancePct(data, asOfDate)` — CQC metric

### ipc.js
- `DEFAULT_IPC_AUDIT_TYPES` — 6 types (hand hygiene, PPE, cleanliness, isolation, outbreak response, general)
- `OUTBREAK_STATUSES` — suspected, confirmed, contained, resolved
- `ensureIpcDefaults(data)` — adds ipc_audits[], config.ipc_audit_types
- `getIpcStats(audits, asOfDate)` — avgScore, auditsThisQuarter, activeOutbreaks, actionCompletion
- `getIpcAlerts(audits, asOfDate)` — audit overdue, low scores, active outbreaks, corrective action overdue
- `calculateIpcAuditCompliance(data, asOfDate)` — CQC metric

### riskRegister.js
- `RISK_CATEGORIES` — staffing, clinical, operational, financial, compliance
- `RISK_SCORE_BANDS` — 1-4 low/green, 5-9 medium/amber, 10-15 high/red, 16-25 critical/purple
- `ensureRiskRegisterDefaults(data)` — adds risk_register[]
- `getRiskScore(likelihood, impact)` — L x I
- `getRiskBand(score)` — returns band with badgeKey
- `getRiskStats(risks, asOfDate)` — total, critical, reviewsOverdue, actionsOverdue
- `getRiskAlerts(risks, asOfDate)` — overdue reviews, overdue actions, critical risks
- `calculateRiskManagementScore(data, asOfDate)` — CQC metric

### policyReview.js
- `DEFAULT_POLICIES` — 8 items (safeguarding, complaints, whistleblowing, data protection, H&S, IPC, MCA/DoLS, equality)
- `ensurePolicyDefaults(data)` — adds policy_reviews[] pre-populated with 8 defaults
- `getPolicyStatus(policy, asOfDate)` — status, daysUntilDue, isOverdue
- `getPolicyStats(policies, asOfDate)` — total, current, due, overdue, compliancePct
- `getPolicyAlerts(policies, asOfDate)` — overdue policies, due for review
- `calculatePolicyCompliancePct(data, asOfDate)` — CQC metric

### whistleblowing.js
- `CONCERN_CATEGORIES` — malpractice, bullying, safety, compliance, other
- `CONCERN_SEVERITIES` — low, medium, high, urgent
- `ensureWhistleblowingDefaults(data)` — adds whistleblowing_concerns[]
- `getWhistleblowingStats(concerns, fromDate, toDate)` — total, open, avgInvestigationDays, protectionRate
- `getWhistleblowingAlerts(concerns)` — unacknowledged >3 days, long investigations, overdue follow-ups
- `calculateSpeakUpCulture(data, fromDate, toDate)` — CQC metric (composite: acknowledgement + protection + resolution)

### dols.js
- `APPLICATION_TYPES` — dols, lps
- `DOLS_STATUSES` — applied, authorised, expired, review_due
- `ensureDolsDefaults(data)` — adds dols[], mca_assessments[]
- `getDolsStatus(dols, asOfDate)` — status, daysUntilExpiry, isExpired
- `getDolsStats(dols, mcaAssessments, asOfDate)` — activeCount, expiringSoon, reviewsOverdue
- `getDolsAlerts(dols, mcaAssessments, asOfDate)` — expiring <90 days, overdue reviews
- `calculateDolsCompliancePct(data, asOfDate)` — CQC metric

### careCertificate.js
- `CARE_CERTIFICATE_STANDARDS` — 16 standards (2025 update incl. Oliver McGowan Standard 16)
- `CC_STATUSES` — not_started, in_progress, completed, overdue
- `ensureCareCertDefaults(data)` — adds care_certificate: {}
- `getCareCertStatus(staffRecord, asOfDate)` — status, progressPct, weeksElapsed, isOverdue
- `getCareCertStats(careCertData, activeStaff, asOfDate)` — inProgress, completed, onTrack, overdue
- `getCareCertAlerts(careCertData, activeStaff, config, asOfDate)` — >12 weeks, not on track at 8 weeks
- `calculateCareCertCompletionPct(data, asOfDate)` — CQC metric

### onboarding.js
- `getOnboardingBlockingReasons(staffId, onboardingData)` — returns string[] of reasons staff can't work unsupervised

### excel.js
- `downloadXLSX(filename, sheets)` — shared Excel export utility; sheets = [{ name, headers, rows }]

## State Flow

1. `App.jsx` loads data from API on mount, holds it in state
2. Every page receives `data` and `updateData` as props
3. `updateData` pushes to undo stack, saves to API immediately
4. Server backs up before saving, validates overrides, writes audit log
5. Undo/redo via Ctrl+Z / Ctrl+Y (max 20 states)

## Git & Deployment

- **Repo**: github.com/tb9922/panama-staffin
- **Branch**: main
- **gitignored**: homes/, backups/, audit_log.json, node_modules, dist
- **No CI/CD** — manual deploy
- **No co-author tags** in commits
- **Commit style**: concise, no emojis

## UK Compliance Notes

- **NLW minimum**: £12.21/hr (2025-26). Enforced via `config.nlw_rate`:
  - Dashboard alerts flag any care staff below NLW (red error)
  - StaffRegister shows "Below NLW" badge on rate column, warns on edit and add
  - Config shows violation count below the NLW Rate field
  - Server-side `validateOverrides()` returns NLW warnings on every save
- **WTR**: 48hr average weekly limit (unless opted out)
- **CQC Regulation 18**: Safe staffing levels must be maintained
- **Bank holidays**: Auto-fetched from GOV.UK, auto-upgrade shifts to BH-D/BH-N

## Holiday Accrual

Accrual is calculated in `src/lib/accrual.js`. Key concepts:
- Leave year is anchored to `config.leave_year_start` ("MM-DD", default "04-01")
- Staff accrue 1/12th of entitlement per complete month from their effective start date
- New starters get pro-rata: their entitlement is `base × (months-left-in-year / 12)`
- Carryover (`staff.al_carryover`) is added to accrued total and available immediately
- Per-staff override: `staff.al_entitlement` overrides the global `config.al_entitlement_days`
- Automatic year-end rollover is NOT implemented — managers set `al_carryover` manually each April

`calculateAccrual(staff, config, overrides, asOfDate)` returns `{ baseEntitlement, entitlement, accrued, used, remaining, yearRemaining, isProRata, leaveYear }`

UI terminology (consistent across AnnualLeave, Dashboard, booking alerts):
- **Entitled** = `baseEntitlement` (full-year entitlement, e.g. 28 days)
- **Earned** = `accrued` (1/12th per month from effective start, pro-rata for mid-year starters)
- **Used** = `used` (AL overrides counted in the leave year)
- **Left** = `remaining` (earned - used; can be negative if over-booked)

## Full Platform Roadmap

Phase 2 features (detailed micro-step spec exists — see session memory):

### Built (Phase 1)
- ~~Staff onboarding~~, ~~Care Certificate~~, ~~Training matrix~~ (tiered levels, fire drills, supervisions, appraisals)
- ~~CQC evidence~~ (34 quality statements, 18 weighted metrics, 15-page PDF pack)
- ~~Incident & safety reporting~~ (CQC notifications, RIDDOR, safeguarding, DoC, corrective actions)
- ~~Complaints & feedback~~, ~~Maintenance & environment~~, ~~IPC audits~~
- ~~Risk register~~, ~~Policy review~~, ~~Whistleblowing / speak up~~, ~~DoLS/LPS & MCA~~

### Remaining
- GDPR: retention schedules, SAR workflow, breach notification, right to erasure
- Communication: structured digital handover notes, in-app messaging, mandatory read receipts
- GPS clock-in: geofenced attendance, planned vs actual reconciliation, automated timesheets
- Payroll: NMW deep compliance (sleep-in calc, deduction check), WTR full tracking, Sage/Xero CSV export
- Clinical API: read-only connectors to Nourish/PCS/Access Group, unified portfolio KPI dashboard
- Per-staff auth + mobile-friendly staff portal
- Group/owner dashboard: portfolio-level KPIs, cross-home benchmarking
- Database migration: PostgreSQL (prerequisite for multi-user, staff portal, scaling)
- Email/SMS notifications (SendGrid/Twilio)

### Current Known Gaps
- Shift swap feature discussed but not built (approach: swap staff `team` field)
- Audit log only viewable in-app, not exportable
- AL carryover is set manually — no automatic year-end rollover

## Design System

All UI uses shared tokens from `src/lib/design.js`. Import and use these — never write ad-hoc button/card/table classes from scratch.

| Token | Usage |
|-------|-------|
| `BTN.primary/secondary/danger/ghost/success` | All buttons |
| `BTN.xs/sm` | Size modifiers (append to BTN variant) |
| `CARD.base/padded/elevated/flush` | Card wrappers |
| `TABLE.table/thead/th/tr/td/tdMono` | All tables |
| `INPUT.base/sm/select/label` | All form inputs |
| `MODAL.overlay/panel/panelLg/panelSm/title/footer` | All modals |
| `BADGE.blue/green/amber/red/gray/purple/orange/pink` | Status pills |
| `PAGE.container/title/section/header` | Page layout |
| `ESC_COLORS.green/amber/yellow/red` | Escalation level coloring (`.card/.text/.badge/.bar`) |
| `HEATMAP.green/amber/yellow/red/empty` | Heatmap cell colors |

Global styles in `src/index.css`: Inter font, CSS custom properties (`--color-primary`, `--radius`), modal animation (`animate-modal-in`), smooth transitions on interactive elements.

SHIFT_COLORS (in rotation.js) include `border border-{color}-200` — apply with `className` on badge spans.

## Working with This Codebase

- Use `/clear` between distinct tasks to keep context small
- **Model strategy**: use Opus 4.6 for plan mode + review (`/model claude-opus-4-6`), switch back to Sonnet for implementation (`/model claude-sonnet-4-6`)
- Use plan mode for changes touching 2+ files
- Use subagents (Explore) for investigation rather than reading many files manually
- All pages follow same pattern: receive `{data, updateData}` props, render Tailwind-styled JSX
- All UI components use design tokens from `src/lib/design.js` — never write ad-hoc Tailwind classes for buttons/cards/tables/modals
- Override changes always: deep-clone overrides → mutate clone → call updateData with new data object
- Date handling: always use `formatDate()` for keys, `parseDate()` for parsing, `addDays()` for arithmetic
- Cycle math uses UTC to avoid BST/GMT off-by-one errors
