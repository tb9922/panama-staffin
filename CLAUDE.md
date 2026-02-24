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
    api.js             Fetch wrappers for all API endpoints
    bankHolidays.js    GOV.UK bank holiday sync
    pdfReports.js      PDF report generation
  pages/
    Dashboard.jsx      KPI cards, 7-day coverage forecast, cost summary
    DailyStatus.jsx    Day view — staff list, shift overrides, coverage/escalation per period
    RotationGrid.jsx   28-day roster grid with print support
    StaffRegister.jsx  Staff CRUD — add/edit/deactivate, set team/role/rate/skill
    CostTracker.jsx    Daily cost breakdown (base/OT/agency/BH) with period totals
    AnnualLeave.jsx    AL booking with entitlement tracking, calendar heatmap
    ScenarioModel.jsx  What-if modelling: sick/AL gaps → float → OT → agency cascade
    FatigueTracker.jsx Consecutive days + WTR 48hr checks per staff
    SickTrends.jsx     Monthly sick counts with exact dates, staff names, reasons
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
    bank_holidays: [{ date: "YYYY-MM-DD", name: "..." }],
    bank_staff_pool_size, night_gap_pct,
  },
  staff: [{
    id, name, role, team, pref, skill, hourly_rate,
    active, wtr_opt_out, start_date, contract_hours,
  }],
  overrides: {
    "YYYY-MM-DD": {
      "staff-id": { shift: "AL", reason: "...", source: "al" }
    }
  },
  annual_leave: { ... },  // Legacy — overrides is the source of truth for AL
  budget: { ... },        // Monthly budget entries
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

Server-side `validateOverrides()` checks max AL per day and entitlement per staff on every save.

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

- **NLW minimum**: £12.21/hr (2025-26). All staff rates must meet this.
- **WTR**: 48hr average weekly limit (unless opted out)
- **CQC Regulation 18**: Safe staffing levels must be maintained
- **Bank holidays**: Auto-fetched from GOV.UK, auto-upgrade shifts to BH-D/BH-N

## Known Gaps / Future Work

- No mobile app or staff self-service portal
- No email/SMS/push notifications
- No payroll integration (Sage, Xero, etc.)
- No time & attendance / GPS clock-in
- No DBS/training expiry tracking
- Shift swap feature discussed but not built (approach: swap staff `team` field)
- Audit log only viewable in-app, not exportable
- No XLSX export (xlsx package installed but unused)

## Working with This Codebase

- Use `/clear` between distinct tasks to keep context small
- Use plan mode for changes touching 2+ files
- Use subagents (Explore) for investigation rather than reading many files manually
- All pages follow same pattern: receive `{data, updateData}` props, render Tailwind-styled JSX
- Override changes always: deep-clone overrides → mutate clone → call updateData with new data object
- Date handling: always use `formatDate()` for keys, `parseDate()` for parsing, `addDays()` for arithmetic
- Cycle math uses UTC to avoid BST/GMT off-by-one errors
