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
  App.jsx              Shell: sidebar nav, login, undo/redo, multi-home, coverage alert banner
  lib/
    rotation.js        Core scheduling engine — Panama pattern, shift classification, cycle math
    escalation.js      Coverage calc, 6-level escalation, cost calc, fatigue check, swap validation
    accrual.js         Holiday accrual engine — leave year, pro-rata, carryover, per-staff entitlement
    training.js        Training compliance — 16 default types, status calc, matrix builder, alerts
    design.js          Design tokens — BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE, ESC_COLORS, HEATMAP
    api.js             Fetch wrappers for all API endpoints
    bankHolidays.js    GOV.UK bank holiday sync
    pdfReports.js      PDF report generation
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
    TrainingMatrix.jsx Mandatory training matrix — grid/list view, record modal, type management
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
    }],
    bank_holidays: [{ date: "YYYY-MM-DD", name: "..." }],
    bank_staff_pool_size, night_gap_pct,
  },
  staff: [{
    id, name, role, team, pref, skill, hourly_rate,
    active, wtr_opt_out, start_date, contract_hours,
    al_entitlement,            // Per-staff override of config.al_entitlement_days (null = use global)
    al_carryover,              // Days carried over from previous leave year (default 0, set manually)
  }],
  overrides: {
    "YYYY-MM-DD": {
      "staff-id": { shift: "AL", reason: "...", source: "al" }
    }
  },
  annual_leave: { ... },  // Legacy — overrides is the source of truth for AL
  budget: { ... },        // Monthly budget entries
  training: {             // Per-staff training completion records
    "S001": {
      "fire-safety": {
        completed: "2025-06-15",    // Date training was completed
        expiry: "2026-06-15",       // Auto-calculated: completed + refresher_months
        trainer: "Jane Smith",
        method: "classroom",        // classroom | e-learning | practical | online
        certificate_ref: "FS-042",
        notes: "",
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
- `getTrainingTypes(config)` — returns config.training_types or defaults
- `ensureTrainingDefaults(data)` — populates config.training_types if missing (returns new data or null)
- `getTrainingStatus(staff, type, staffRecords, asOfDate)` — returns { status, record, daysUntilExpiry }
- `buildComplianceMatrix(activeStaff, types, trainingData, asOfDate)` — Map<staffId, Map<typeId, statusResult>>
- `getComplianceStats(matrix)` — { totalRequired, compliant, expiringSoon, urgent, expired, notStarted, compliancePct }
- `getTrainingAlerts(activeStaff, types, trainingData, asOfDate)` — alert objects for Dashboard

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

## Known Gaps / Future Work

- No mobile app or staff self-service portal
- No email/SMS/push notifications
- No payroll integration (Sage, Xero, etc.)
- No time & attendance / GPS clock-in
- No DBS expiry tracking
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
