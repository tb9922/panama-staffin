# Panama Staffing — Project Guide

Care home staff scheduling app using the Panama 2-2-3 rotation pattern. Built for UK residential care homes. Self-hosted, no subscription.

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
  App.jsx              Shell: collapsible sidebar nav (5 groups), login, undo/redo, multi-home, coverage alert banner
  lib/
    rotation.js        Core scheduling engine — Panama pattern, shift classification, cycle math
    escalation.js      Coverage calc, 6-level escalation, cost calc, fatigue check, swap validation
    accrual.js         Holiday accrual engine — leave year, pro-rata, carryover, per-staff entitlement
    training.js        Training compliance — 16 default types, status calc, matrix builder, alerts
    cqc.js             CQC compliance scoring — 17 quality statements (5 CQC questions), 10 weighted metrics, evidence aggregation
    incidents.js       Incident & safety reporting — types, severity, CQC/RIDDOR tracking, alerts, metrics
    design.js          Design tokens — BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE, ESC_COLORS, HEATMAP
    api.js             Fetch wrappers for all API endpoints
    bankHolidays.js    GOV.UK bank holiday sync
    pdfReports.js      PDF report generation — 10-page CQC evidence pack covering all 5 core questions
  pages/
    Dashboard.jsx      KPI cards, 7-day coverage forecast, cost summary
    DailyStatus.jsx    Day view — staff list, shift overrides, coverage/escalation per period
    RotationGrid.jsx   28-day roster grid with print support
    StaffRegister.jsx  Staff CRUD — add/edit/deactivate, set team/role/rate/skill
    CostTracker.jsx    Daily cost breakdown (base/OT/agency/BH) with period totals
    AnnualLeave.jsx    AL booking with accrual tracking, calendar heatmap, leave year banner
    ScenarioModel.jsx  What-if modelling: sick/AL gaps → float → OT → agency cascade
    FatigueTracker.jsx Consecutive days + WTR 48hr checks per staff
    SickTrends.jsx     Monthly sick counts with exact dates, staff names, reasons
    onboarding.js      Staff onboarding blocking — DBS, RTW, references, identity checks
    TrainingMatrix.jsx Mandatory training matrix — grid/list view, record modal, type management, CSV import
    OnboardingTracker.jsx Staff onboarding — 9 CQC Reg 19 sections, expandable staff list, Excel export
    CQCEvidence.jsx    CQC compliance evidence — 5 core questions, scorecard, quality statements, manual evidence, PDF pack
    IncidentTracker.jsx Incident & safety reporting — log, CQC/RIDDOR notifications, DoC, witnesses, corrective actions, investigation
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
    training_types: [{         // 16 defaults auto-populated; managers can add/toggle
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
    id, quality_statement, // S1-S5, E1-E3, C1-C2, R1-R2, WL1-WL5
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

Server-side `validateOverrides()` checks max AL per day, entitlement per staff, NLW compliance, and training compliance on every save.

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
- `DEFAULT_TRAINING_TYPES` — 16-item array of UK statutory/mandatory training types
- `DEFAULT_TRAINING_LEVELS` — tiered levels for safeguarding-adults (L1/L2/L3) and mca-dols (basic/advanced)
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
- `QUALITY_STATEMENTS` — 17 quality statements across all 5 CQC core questions: S1-S5 (Safe), E1-E3 (Effective), C1-C2 (Caring), R1-R2 (Responsive), WL1-WL5 (Well-Led)
- `METRIC_DEFINITIONS` — 10 weighted metrics (9 available + 1 pending careCertCompletion)
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

### onboarding.js
- `getOnboardingBlockingReasons(staffId, onboardingData)` — returns string[] of reasons staff can't work unsupervised

### excel.js
- `downloadXLSX(sheets, filename)` — shared Excel export utility; sheets = [{ name, headers, rows }]

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

### Compliance & Onboarding
- Staff onboarding: DBS checks (Enhanced + Adults' Barred List), right to work, references, health declarations, Day 1 induction checklist, policy acknowledgement pack
- Care Certificate: 16 standards (2025 update incl. Oliver McGowan), knowledge + practical observation tracking, 8/12 week alerts, progress dashboard
- Training expansion: tiered levels (L1/L2/L3), fire drill tracking, supervision scheduling, annual appraisals, bulk CSV import from e-learning platforms
- CQC evidence: quality statement tagging, weighted compliance scoring, evidence pack generator for inspections
- GDPR: retention schedules, SAR workflow, breach notification, right to erasure

### Operations
- Incident & safety reporting: internal log, CQC statutory notifications (Reg 16/18), RIDDOR tracking, safeguarding referral workflow, root cause analysis
- Communication: structured digital handover notes, in-app messaging (WhatsApp replacement), mandatory read receipts
- GPS clock-in: geofenced attendance, planned vs actual reconciliation, automated timesheets, break recording

### Integration & Payroll
- Payroll: NMW deep compliance (sleep-in calc, deduction check, age-based rates), WTR full tracking (11hr rest, weekly rest, night worker limits), Sage/Xero CSV export
- Clinical API: read-only connectors to Nourish/PCS/Access Group, unified portfolio KPI dashboard

### Platform
- Per-staff auth + mobile-friendly staff portal (view rota, request AL, see training status)
- Group/owner dashboard: portfolio-level KPIs, cross-home benchmarking, aggregate compliance
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
