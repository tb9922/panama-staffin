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
16. ~~Welsh tax code `C` prefix produces 0% tax~~ — FIXED: maps to `england_wales` not `wales`
17. ~~Audit log cross-tenant leak~~ — FIXED: GET /api/audit filters to user's accessible homes
18. ~~Payroll reads outside transaction~~ — FIXED: `staffRepo.findByHome`/`overrideRepo.findByHome` accept `client` param
19. ~~GDPR erasure misses shift_overrides.reason~~ — FIXED: clears reason (can contain health data)
20. ~~financeRepo invoice lines skip tenant filter~~ — FIXED: `home_id` always required
21. ~~`hasAccess()` only checks legacy table~~ — FIXED: UNION ALL across user_home_roles + user_home_access
22. ~~`findHomeSlugsForUser()` only checks legacy table~~ — FIXED: rewritten with UNION + NOT EXISTS fallback
23. ~~PII stripping uses JWT role instead of per-home role~~ — FIXED: 7 routes use req.homeRole (home_manager/deputy_manager)
24. ~~Platform home creation missing RBAC role assignment~~ — FIXED: assignRole() called alongside grantAccess()
25. ~~Logout doesn't deny-list JWT token~~ — FIXED: addToDenyList() on logout
26. ~~validationService.js UTC/local time bugs (7 lines)~~ — FIXED: all date parses use 'Z' suffix
27. ~~cqc.js getFatigueSummary uses local midnight~~ — FIXED: setUTCHours(0,0,0,0)
28. ~~financeRepo NUMERIC balance returned as string~~ — FIXED: parseFloat() wrapper
29. ~~AnnualLeave.jsx sort mutates memoized array~~ — FIXED: spread before sort
30. ~~StaffRegister.jsx NLW fallback 12.71~~ — FIXED: corrected to 12.21
31. ~~isTokenDenied returns false for malformed tokens~~ — FIXED: && changed to || (deny if jti OR username missing)
32. ~~findHomesWithRolesForUser UNION inefficiency~~ — FIXED: UNION ALL (NOT EXISTS already dedupes)

**See `~/.claude/projects/c--Users-teddy-panama-staffing/memory/code-quality.md` for full review findings.**

## Quick Start

```bash
npm run dev          # Starts both servers concurrently
# API: http://localhost:3001   (Express)
# UI:  http://localhost:5173   (Vite + React)
```

Login: `admin/admin123` (home_manager role) or `viewer/view123` (viewer role)

## Tech Stack

- **Frontend**: React 19 + Vite 7 + Tailwind CSS 4 + React Router 7
- **Backend**: Express 5 (server.js) — PostgreSQL (pg pool, 100+ migrations)
- **PDF**: jspdf + jspdf-autotable
- **APM**: Sentry (`@sentry/node` + `@sentry/react`) — activates when `SENTRY_DSN` is set
- **Testing**: Vitest — 1,672+ tests across 60 files (unit + integration), all passing

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
    # Scheduling & Operations
    Dashboard.jsx      KPI cards, 7-day coverage forecast, cost summary, priority-scored alert feed
    DailyStatus.jsx    Day view — staff list, shift overrides, coverage/escalation per period
    RotationGrid.jsx   Calendar-month roster grid with cover arrows, absence/cover summary rows, print + CSV export
    StaffRegister.jsx  Staff CRUD — add/edit/deactivate, set team/role/rate/skill
    CostTracker.jsx    Daily cost breakdown (base/OT/agency/BH) with period totals
    AnnualLeave.jsx    AL booking with accrual tracking, calendar heatmap, leave year banner
    ScenarioModel.jsx  What-if modelling: sick/AL gaps → float → OT → agency cascade
    FatigueTracker.jsx Consecutive days + WTR 48hr checks per staff
    SickTrends.jsx     Monthly sick counts with exact dates, staff names, reasons
    AbsenceManager.jsx Staff absence overview, trends, period selector
    BudgetTracker.jsx  Monthly budget vs actual with variance tracking
    Reports.jsx        PDF export for roster, costs, coverage, board pack
    Config.jsx         Settings — shifts, rates, minimums, bank holidays, home details
    # Training & Compliance
    TrainingMatrix.jsx Mandatory training matrix — grid/list view, record modal, type management
    OnboardingTracker.jsx Staff onboarding — 9 CQC Reg 19 sections, expandable staff list, Excel export
    CareCertificateTracker.jsx Care Certificate — 16 standards, per-staff progress, expandable standards
    CQCEvidence.jsx    CQC compliance evidence — 5 core questions, 34 statements, scorecard, manual evidence, PDF pack
    # Safety & Quality
    IncidentTracker.jsx Incident & safety reporting — log, CQC/RIDDOR notifications, DoC, corrective actions
    ComplaintsTracker.jsx Complaints & feedback — complaints table, 3-tab modal, surveys, satisfaction scoring
    MaintenanceTracker.jsx Maintenance & environment — checks, certificates, auto-calculated next due
    IpcAuditTracker.jsx IPC audits — audit scoring, risk areas, corrective actions, outbreak management
    RiskRegister.jsx   Risk register — 5x5 heatmap, risk scoring, actions, review tracking
    PolicyReviewTracker.jsx Policy review — 8 pre-populated policies, version history, mark as reviewed
    WhistleblowingTracker.jsx Whistleblowing — anonymous concerns, investigation workflow, protection tracking
    DolsTracker.jsx    DoLS/LPS & MCA — applications, authorisations, capacity assessments
    # Finance
    FinanceDashboard.jsx Finance KPIs, charts, period selector
    IncomeTracker.jsx  Invoicing, resident payments, outstanding balance tracking
    ExpenseTracker.jsx Expense management
    ReceivablesManager.jsx AR tracking, chase modal
    PayablesManager.jsx AP tracking, payment schedules
    BedManager.jsx     Bed occupancy, admit/discharge workflows
    Residents.jsx      Resident data, fee reviews, payment info
    # Payroll
    PayrollDashboard.jsx Run management, approval workflow
    PayrollDetail.jsx  Run detail, employee breakdowns, CSV export (sage/xero/generic)
    TimesheetManager.jsx Manual timesheet entry with snap config
    MonthlyTimesheet.jsx Per-staff monthly timesheet view
    AgencyTracker.jsx  Agency staff cost tracking
    TaxCodeManager.jsx PAYE tax code management
    PensionManager.jsx Pension auto-enrolment, opt-out tracking
    SickPayTracker.jsx SSP tracking, sick periods
    HMRCDashboard.jsx  HMRC submissions, RTI, regulatory compliance
    PayRatesConfig.jsx Pay rate configuration
    # HR Case Management
    HrDashboard.jsx    HR module overview
    DisciplinaryTracker.jsx Disciplinary case tracking
    GrievanceTracker.jsx Employee grievance management
    PerformanceTracker.jsx Performance review tracking
    ContractManager.jsx Employment contract management
    FamilyLeaveTracker.jsx Parental/family leave tracking
    FlexWorkingTracker.jsx Flexible working requests
    EdiTracker.jsx     Equality, Diversity & Inclusion
    TupeManager.jsx    Transfer of Undertakings
    RtwDbsRenewals.jsx Right to Work & DBS renewal tracking
    # Platform & System
    PlatformHomes.jsx  Multi-home management (platform admin)
    UserManagement.jsx User CRUD, role assignment, home access control
    GdprDashboard.jsx  SAR, breach notification, erasure, consent, DP complaints
    HandoverNotes.jsx  Structured shift handover with priorities, acknowledgements
    AuditLog.jsx       Audit trail viewer + Excel export
shared/
  roles.js             RBAC role definitions — 8 roles, 10 modules, permission helpers (importable by server + client)
homes/                 JSON data files per care home (gitignored)
backups/               Auto-backups before each save, 20 per home (gitignored)
```

## RBAC (Per-Home Role-Based Access Control)

Each user has a **per-home role** assigned via `user_home_roles` table (migration 101). Roles are defined in `shared/roles.js` — NOT in the database.

### 8 Predefined Roles

| Role | Can Manage Users | Key Access |
|------|-----------------|------------|
| `home_manager` | Yes | All modules: write |
| `deputy_manager` | No | All read, write on scheduling/staff/compliance/governance/reports |
| `training_lead` | No | staff+compliance: write, scheduling/governance/reports: read |
| `finance_officer` | No | finance+payroll: write, scheduling/reports: read |
| `hr_officer` | No | hr+staff: write, scheduling/gdpr/reports: read |
| `shift_coordinator` | No | scheduling: write, staff/reports: read |
| `viewer` | No | scheduling/staff/reports: read only |
| `staff_member` | No | scheduling/payroll: own (self-data only) |

### 10 Modules

`scheduling`, `staff`, `hr`, `compliance`, `governance`, `finance`, `payroll`, `gdpr`, `reports`, `config`

### Middleware

- `requireHomeAccess` resolves `req.homeRole` + `req.staffId` from `user_home_roles` (fallback to legacy `user_home_access`)
- `requireModule(moduleId, level)` gates routes by module — replaces `requireAdmin` on all route files
- `requireHomeManager` gates user management within a home
- Platform admins (`req.user.is_platform_admin`) bypass all module checks

### Frontend

- `DataContext.jsx` exposes `canRead(module)`, `canWrite(module)`, `homeRole`, `staffId`
- `AppLayout.jsx` filters sidebar sections by `canRead(section.module)`
- `AppRoutes.jsx` wraps routes with `<RequireModule module="x">`
- All 51 pages use `const canEdit = canWrite('module')` instead of `isAdmin`

### Helper Functions (shared/roles.js)

- `hasModuleAccess(roleId, moduleId, level)` — check if role has access at given level
- `canWriteModule(roleId, moduleId)` — shorthand for write access
- `getVisibleModules(roleId)` — modules with at least read access
- `canAssignRole(assignerRoleId, targetRoleId)` — role assignment rules
- `getRoleLabel(roleId)` — human-readable label
- `isOwnDataOnly(roleId, moduleId)` — true for staff_member on scheduling/payroll

## Data Model

Data is stored in PostgreSQL (100+ migrations). The logical shape per home:

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
    al_entitlement,            // Hours override (null = auto: 5.6 × contract_hours). NUMERIC(6,2)
    al_carryover,              // Hours carried over from previous leave year (default 0, set manually)
    leaving_date,              // Auto-set when deactivated, cleared when reactivated
  }],
  overrides: {
    "YYYY-MM-DD": {
      "staff-id": {
        shift: "AL", reason: "...", source: "al",
        sleep_in: false,                   // Sleep-in flag (night shifts)
        replaces_staff_id: "other-id",     // OC/AG shifts: who this covers (null if not covering)
        override_hours: 4,                 // TRN/ADM on off-days: actual hours attended (null = use config)
        al_hours: 12,                      // AL bookings: hours deducted (null on legacy = derive from shift)
      }
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
4. Passes through `replaces_staff_id` and `override_hours` from override data

### Cover Arrows (replaces_staff_id)

OC/AG overrides can link to the absent staff member they cover via `replaces_staff_id`. This enables:
- **RotationGrid**: `→SP` arrow on cover person's cell, `←DJ` on absent person's cell, `←2` for split cover
- **DailyStatus**: amber "covers {name}" badge on cover person's row
- **Editor**: covers-for dropdown when assigning OC/AG shifts (filters to absent care staff)
- **Backend validation**: self-cover blocked, shift-type restricted to OC/AG, Zod `.min(1)`
- **Audit trail**: `replaces_staff_id` logged on `override_upsert`

### TRN/ADM Pay Logic (override_hours)

Training/admin shifts pay differently based on whether the day was scheduled as working:
- **Working day** (E/L/EL/N): pay full scheduled shift hours (staff would have worked anyway)
- **OFF day**: pay `override_hours` if set, otherwise fall back to config shift hours
- Uses `??` (not `||`) to preserve `override_hours: 0` as valid

## API Endpoints (server.js)

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/login | Auth — returns {username, role, token} + sets cookies |
| POST | /api/login/logout | Clear auth cookies |
| POST | /api/login/revoke | Admin — revoke all tokens for a user |
| GET | /api/homes | List all homes |
| GET | /api/data?home=X | Load home data |
| POST | /api/data?home=X&user=Y | Save home data (validates, backs up, audits) |
| GET | /api/dashboard?home=X | Dashboard KPIs + alerts |
| GET | /api/audit | Last 100 audit entries |
| GET | /api/export?home=X | Download home data as JSON |
| GET | /api/bank-holidays | Proxy to GOV.UK API |
| GET | /api/scheduling?home=X | Full scheduling bundle (staff, overrides, notes, training) |
| PUT | /api/scheduling/overrides?home=X | Upsert single override (validates AL, cover links) |
| POST | /api/scheduling/overrides/bulk?home=X | Bulk upsert overrides (batch AL validation) |
| DELETE | /api/scheduling/overrides?home=X&date=D&staffId=S | Delete single override |
| DELETE | /api/scheduling/overrides/month?home=X&fromDate=D&toDate=D | Delete range (revert month) |
| PUT | /api/scheduling/day-notes?home=X | Upsert or delete day note |
| * | /api/finance/* | Invoices, payments, expenses, receivables, payables, residents, beds |
| * | /api/payroll/* | Runs, timesheets, rates, tax codes, pensions, SSP, agency, HMRC |
| * | /api/hr/* | Disciplinary, grievance, performance, contracts, leave, flex, EDI, TUPE, RTW/DBS |
| * | /api/gdpr/* | Data requests (SAR/erasure), breaches, consent, DP complaints, retention |
| * | /api/platform/* | Multi-home CRUD, user management (platform admin only) |
| * | /api/users/* | User CRUD, role assignment, home access |
| * | /api/import/* | Staff CSV import — template download, dry-run, live import |
| * | /api/webhooks/* | Webhook CRUD, delivery logs (admin only) |
| * | /api/incidents/* | Incident CRUD with CQC/RIDDOR/DoC tracking |
| * | /api/complaints/* | Complaints CRUD, surveys |
| * | /api/training/* | Training records, types, supervision, appraisals, fire drills |
| * | /api/handover/* | Handover notes CRUD |
| GET | /health | Health check — DB status, pool stats, migration version |

Server-side `validateOverrides()` checks max AL per day, entitlement per staff, NLW compliance, training compliance, and all 8 compliance module deadlines (complaints, maintenance, IPC, risks, policies, whistleblowing, DoLS, Care Certificate) on every save.

## Key Functions Reference

### rotation.js
- `getCycleDay(date, cycleStartDate)` — returns 0-13 position (UTC-safe)
- `getScheduledShift(staff, cycleDay, date)` — base shift from pattern + team + preference
- `getActualShift(staff, date, overrides, cycleStartDate)` — override or scheduled
- `getStaffForDay(staff, date, overrides, config)` — full day build with BH upgrade + virtual agency
- `calculateStaffPeriodHours(staff, dates, overrides, config)` — hours/pay for a date range (includes alHours)
- `isBankHoliday(date, config)` / `getBankHoliday(date, config)` — bank holiday lookup
- `getLeaveYear(date, leaveYearStart)` — returns { start, end, startStr, endStr } for leave year containing date
- `getALDeductionHours(staff, dateStr, config)` — hours to deduct for one AL booking based on scheduled shift
- `STATUTORY_WEEKS` — 5.6 (UK statutory holiday weeks)
- `ASSUMED_WORKING_DAYS_PER_WEEK` — 5 (for Float/AVL deduction)

### escalation.js
- `calculateCoverage(staffForDay, period, config)` — heads + skill points vs minimum
- `getEscalationLevel(coverage, staffForDay)` — 0-5 level determination
- `getDayCoverageStatus(staffForDay, config)` — early/late/night + overall
- `calculateDayCost(staffForDay, config)` — full cost breakdown
- `checkFatigueRisk(staffMember, date, overrides, config)` — consecutive working days
- `calculateScenario(sickPerDay, alPerDay, config)` — what-if gap modelling
- `validateSwap(fromStaff, toStaff, date, overrides, config)` — swap safety check

### accrual.js
- `getLeaveYear(date, leaveYearStart)` — re-exported from rotation.js; returns { start, end, startStr, endStr }
- `countALInLeaveYear(staffId, overrides, leaveYear)` — legacy day-count (kept for backward compat)
- `sumALHoursInLeaveYear(staff, overrides, leaveYear, config)` — sum AL hours (stored or derived from shift)
- `calculateAccrual(staff, config, overrides, asOfDate)` — hours-based accrual: returns { contractHours, annualEntitlementHours, carryoverHours, totalEntitlementHours, proRataEntitlementHours, accruedHours, usedHours, remainingHours, yearRemainingHours, leaveYear, isProRata, missingContractHours, entitlementWeeks, usedWeeks, remainingWeeks }
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
- **CI/CD**: GitHub Actions (`.github/workflows/test.yml`) — lint, test, security audit on every push; auto-deploy on push to main (requires `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY` secrets). Rollback on migration failure.
- **Docker**: Multi-stage Dockerfile (node:22.14.0-alpine, non-root user, HEALTHCHECK), docker-compose with resource limits, `cap_drop: ALL`, health checks on both app + db
- **Backups**: `scripts/backup-db.sh` with 30-day retention — runs during deploy; schedule via cron for continuous backup
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

## Holiday Accrual (Hours-Based)

UK statutory: entitlement = **5.6 x contracted weekly hours**. All accrual is in **hours**, not days.

Accrual is calculated in `src/lib/accrual.js`. Core functions in `shared/rotation.js` (server-side access).

Key concepts:
- Leave year is anchored to `config.leave_year_start` ("MM-DD", default "04-01")
- Staff accrue 1/12th of entitlement per complete month from their effective start date
- New starters get pro-rata: their entitlement is `base x (months-left-in-year / 12)`
- Carryover (`staff.al_carryover`, in hours) is added to accrued total and available immediately
- Per-staff override: `staff.al_entitlement` overrides the formula (set in hours, NULL = auto-derive)
- Each AL booking stores `al_hours` on `shift_overrides` — deducted from actual scheduled shift hours
- Legacy bookings (no `al_hours`): derived on-the-fly via `getALDeductionHours(staff, dateStr, config)`
- Backend is authoritative — computes `al_hours` inside transaction, overrides frontend hint
- AL on scheduled OFF day: rejected. AL requires `contract_hours > 0`.
- Automatic year-end rollover is NOT implemented — managers set `al_carryover` manually each April

Deduction per AL booking:
- EL shift = 12h, E/L = 8h, N = 10h (from config shift hours)
- Float/AVL = `contract_hours / 5` (matches payroll methodology)
- OFF = 0 (booking blocked)

`calculateAccrual(staff, config, overrides, asOfDate)` returns:
`{ contractHours, annualEntitlementHours, carryoverHours, totalEntitlementHours, proRataEntitlementHours, accruedHours, usedHours, remainingHours, yearRemainingHours, leaveYear, isProRata, missingContractHours, entitlementWeeks, usedWeeks, remainingWeeks }`

Key functions in `shared/rotation.js`:
- `getLeaveYear(date, leaveYearStart)` — leave year boundaries
- `getALDeductionHours(staff, dateStr, config)` — hours to deduct for one AL booking
- `STATUTORY_WEEKS` — 5.6

UI terminology (consistent across AnnualLeave, Dashboard, booking alerts):
- **Entitled** = `annualEntitlementHours` (full-year entitlement in hours)
- **Earned** = `accruedHours` (1/12th per month from effective start, pro-rata for mid-year starters)
- **Used** = `usedHours` (AL hours deducted in the leave year)
- **Left** = `remainingHours` (earned - used; can be negative if over-booked)

## Full Platform Roadmap

Phase 2 features (detailed micro-step spec exists — see session memory):

### Built (Phase 1)
- ~~Staff onboarding~~, ~~Care Certificate~~, ~~Training matrix~~ (tiered levels, fire drills, supervisions, appraisals)
- ~~CQC evidence~~ (34 quality statements, 18 weighted metrics, 15-page PDF pack)
- ~~Incident & safety reporting~~ (CQC notifications, RIDDOR, safeguarding, DoC, corrective actions)
- ~~Complaints & feedback~~, ~~Maintenance & environment~~, ~~IPC audits~~
- ~~Risk register~~, ~~Policy review~~, ~~Whistleblowing / speak up~~, ~~DoLS/LPS & MCA~~

### Built (Phase 2)
- ~~GDPR~~: SAR workflow, breach notification (ICO tracking), retention schedules, right to erasure, consent records, DP complaints
- ~~Handover notes~~: structured digital handover with shift linking, categories, priorities, acknowledgements
- ~~Payroll~~: runs, timesheets, tax codes, pensions, SSP, agency, HMRC dashboard, NMW compliance, Sage/Xero CSV export
- ~~Finance module~~: dashboard, invoicing, receivables, payables, expenses, bed management, resident payments
- ~~HR case management~~: 9 trackers (disciplinary, grievance, performance, contracts, family leave, flex working, EDI, TUPE, RTW/DBS renewals)
- ~~Platform admin~~: multi-home CRUD, user management, home access control
- ~~Database migration: PostgreSQL~~ — db.js + 100 migrations, fully migrated
- ~~Shift swap~~: DailyStatus permanent team swap + single-day override swap with `validateSwap()` safety check
- ~~Audit log export~~: AuditLog.jsx Excel export via `downloadXLSX()`, up to 10,000 entries
- ~~Staff CSV import~~: template download, dry-run validation, transactional insert, duplicate detection
- ~~Webhook outbound~~: HMAC-signed, delivery logging, payroll/incident/override events, encrypted secrets

### In Progress
- ~~Per-home RBAC~~: 8 roles, 10 modules, per-home role assignment (backend + frontend complete, User Management UI remaining)

### Remaining
- In-app messaging: mandatory read receipts, inbox/chat between staff
- GPS clock-in: geofenced attendance, planned vs actual reconciliation, automated timesheets
- WTR full tracking: payroll-level weekly hours rollup against 48hr average (scheduling-level check exists in FatigueTracker)
- Clinical API: read-only connectors to Nourish/PCS/Access Group
- Per-staff auth + mobile-friendly staff portal
- Group/portfolio KPI dashboard: cross-home benchmarking, aggregated compliance scores (PlatformHomes admin CRUD exists)
- Email/SMS notifications (SendGrid/Twilio)

### Current Known Gaps
- AL carryover is set manually — no automatic year-end rollover
- No UI to set `override_hours` on TRN/ADM overrides (accepted by API, not yet exposed in editor)
- Frontend loads full home data blob into state — backend is paginated but frontend doesn't use it yet

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
