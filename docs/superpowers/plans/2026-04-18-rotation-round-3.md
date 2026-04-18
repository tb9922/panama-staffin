# Rotation Round 3 — Horizon Roster Solver

**Goal:** A pure-JS roster solver that fills an entire month's coverage gaps in one pass, with fair OT distribution, horizon-wide WTR tracking, agency fallback, and clear summary statistics. Accessed from the RotationGrid as an "Auto-Roster" button; surfaces its proposal in the existing `CoverPlanModal` so the manager reviews and accepts as one batch.

**Architecture:** One new pure helper `generateHorizonRoster` in `src/lib/rotationAnalysis.js`, composed from the Round 2 primitives (`generateCoverPlan`, `checkWTRImpact`, `scoreGapFillCandidate`). Key addition: *anti-stacking* — a running per-staff OT-load penalty adjusts candidate scores so the second OT shift in a week doesn't keep landing on the same person. UI reuses `CoverPlanModal` with an extra `summary` prop for aggregate stats.

**Tech Stack:** React 19 + Vite 7, Vitest. No new dependencies. No backend changes — all constraints (WTR, fatigue) already have server-side enforcement via Round 2 + Round 1 work.

**Scope — this session:**
- Horizon solver that runs across an arbitrary date range (default: visible month in RotationGrid)
- Anti-stacking fairness: staff with prior proposed OT in the same week sink in the ranking
- Plan summary: `{ totalCost, coverageFillPct, agencyShifts, otShifts, floatShifts, wtrWarnings }`
- RotationGrid button to trigger the solver over the visible month
- CoverPlanModal renders the new summary banner

**Out of scope (future):**
- True CP-SAT / OR-Tools integration (Python microservice — 3-6 weeks)
- Reassignment of pattern shifts (e.g., swap scheduled shifts to improve coverage)
- Simulated-annealing second pass to polish a greedy solution
- Multi-objective optimisation UI (let manager tune weights)

---

## File Inventory

| Path | Create / Modify | Responsibility |
|---|---|---|
| `src/lib/rotationAnalysis.js` | Modify | Add `generateHorizonRoster` — wraps/extends `generateCoverPlan` with anti-stacking and aggregate summary |
| `src/lib/__tests__/rotationAnalysis.test.js` | Modify | Unit tests: distribution fairness, WTR carry-forward across days, summary shape |
| `src/components/scheduling/CoverPlanModal.jsx` | Modify | Render `summary` banner when provided; otherwise render as before (Round 2 callers still work) |
| `src/pages/RotationGrid.jsx` | Modify | Add "Auto-Roster" button in the toolbar; on click computes the horizon plan for `monthDates` and opens the modal |

---

## Task Breakdown

### Task 1 — generateHorizonRoster

Signature: `generateHorizonRoster({ dates, overrides, config, staff }) → { assignments, totalCost, residualGaps, summary }`.

Algorithm:
1. Copy `overrides` → `working` so we can mutate freely.
2. For each date in ascending order:
   a. For each period (early → late → night):
      - Compute currently-covered heads using `getStaffForDay(working)`.
      - If ≥ minimum, continue.
      - Build candidate pool: float first, then off-duty care.
      - Score each candidate with `scoreGapFillCandidate`, then apply anti-stacking penalty: `-2 points per hour of OT already proposed for that staff in the same calendar week`. (Float shifts not penalised — they're regular hours for the float role.)
      - Sort descending. Pick top. For OT candidates, `checkWTRImpact` against `working`; skip if blocked.
      - Commit the assignment into `working` via `applyProposalsAsOverrides`, update per-staff OT load counter.
      - If shortfall remains after all real candidates exhausted, fall back to agency for the remainder.
3. Build summary:
   - `totalCost`: sum of all assignment costs.
   - `coverageFillPct`: filled_slots / total_gap_slots.
   - `agencyShifts` / `otShifts` / `floatShifts`: counts by kind.
   - `wtrWarnings`: count of assignments with `warn=true`.

Tests:
- Empty horizon → empty plan.
- Single-day fully-covered → no assignments.
- 7-day horizon, 2 AL workers, 2 floaters available 2 days each → float assignments split across the week, no agency.
- Anti-stacking: 2 off-duty staff scoring equally, 3 OT slots → both get work, not one taking all three.
- Summary fields consistent with assignment counts.

### Task 2 — CoverPlanModal summary banner

When `plan.summary` is present, render a compact banner above the grouped list:
- Coverage fill % · Total £ · Agency count · OT count · Float count · WTR warnings.

No breaking change: Round 2 callers pass no `summary`, modal renders as before.

### Task 3 — RotationGrid Auto-Roster button

Toolbar button next to existing controls. On click:
- Compute plan for the visible `monthDates` (already computed in RotationGrid).
- Set modal state → opens `CoverPlanModal`.
- On accept, `bulkUpsertOverrides` with the selected assignments, then `loadData()`.

Empty result → inline toast "Coverage is already fully met for {monthLabel}."

Button disabled if `!canEdit` or solver running.

### Task 4 — Verification

- `npm run lint`
- Targeted vitest on rotationAnalysis + RotationGrid
- Full frontend suite background run

## Risks

- **Bad performance at large scale**: 28 days × 3 periods × 40 staff × multiple passes. Greedy without randomisation is O(days × periods × staff). Should finish in <100ms for a month even in worst case. If it ever slows, a web worker is the fallback.
- **Anti-stacking penalty miscalibrated**: too high → cheaper staff never picked; too low → no distribution effect. Start with 2 points/hour and a test that verifies distribution.
- **Modal reuse risk**: Round 2 AL-cover flow already wires CoverPlanModal to AnnualLeave. Adding a summary banner must not break that call site. Covered by existing tests + making `summary` purely optional.
