# Rotation Round 2 — Daily UX Optimisation

**Goal:** Make the rotation engine actually help the manager in the moment. Add three levers: (1) a WTR-aware guard that blocks overtime breaching 48h/week, (2) a ranked gap-fill suggester replacing the unranked list in the coverage gap panel, (3) an AL cover optimiser that proposes a float→OT→agency cover plan immediately after AL is booked.

**Architecture:** All three share one home in `src/lib/rotationAnalysis.js`. Each feature contributes a pure scorer/helper, then wires into existing UI. No new pages, no new tables. Server-side enforcement only where the client guard would be bypassable (Feature 3's WTR block).

**Tech Stack:** React 19 + Vite 7, Tailwind + `src/lib/design.js` tokens, Vitest for scorer tests, Zod server-side.

---

## File Inventory

| Path | Create / Modify | Responsibility |
|---|---|---|
| `src/lib/rotationAnalysis.js` | Modify | Add `checkWTRImpact`, `scoreGapFillCandidate`, `generateCoverPlan` pure helpers |
| `src/lib/__tests__/rotationAnalysis.test.js` | Modify | Add unit tests for all three helpers |
| `src/components/scheduling/DailyStatusModal.jsx` | Modify | Call `checkWTRImpact` in OT and swap flows before submit; show block/warn UI |
| `src/components/scheduling/DailyStatusCoverageGapPanel.jsx` | Modify | Rank float and OT candidates by composite score; show cost, skill, fatigue inline |
| `routes/scheduling.js` | Modify | Server-side WTR enforcement on upsert — reject 400 for non-opted-out staff breaching 48h |
| `src/pages/AnnualLeave.jsx` | Modify | After successful booking, open cover plan modal if residual gaps exist |
| `src/components/scheduling/CoverPlanModal.jsx` | Create | New modal rendering the proposed plan, per-day breakdown, Accept All button |

---

## Feature 3 — WTR-aware OT limiter (do first; smallest)

### Behaviour

1. Manager picks an OT shift for a staff.
2. Client computes projected `avgWeeklyHours` including the new OT override over the 7 days containing the target date.
3. If `staff.wtr_opt_out === true` → always allowed.
4. Projected <= 44h → allowed silently.
5. Projected 44–48h → warn, require confirm.
6. Projected > 48h → block with message "Would breach Working Time Regulations 48h limit".
7. Server performs the same check on upsert — never trusts the client.

### Helper

`checkWTRImpact(staff, dateStr, overrides, config, proposedShift)` returns `{ ok, warn, projectedHours, message }`.

### Tests

- Opted-out staff: always `ok: true` even at 60h projected.
- Adding OC-EL to a 40h worker → 52h projected → `ok: false`.
- Adding OC-E to a 36h worker → 44h projected → `ok: true, warn: false`.
- Adding OC-EL to a 36h worker → 48h projected → `ok: true, warn: true`.
- Non-OT shifts still checked for consistency.

### Commit message: `feat: enforce WTR 48h limit on OT assignments (client + server)`

---

## Feature 1 — Gap-fill suggester (rank candidates)

### Scorer

`scoreGapFillCandidate(staff, date, period, overrides, config)` → `{ score, breakdown: { cost, fatigue, skill, training } }`.

Composite 0–100:
- **Cost (40%)**: normalised against `config.agency_rate_day` (hourly_rate / agency_rate_day, clamped; lower rate → higher score).
- **Fatigue (30%)**: `ok` → 100, `atRisk` → 50, `exceeded` → 0, based on `checkFatigueRisk`.
- **Skill (20%)**: `staff.skill * 50` (skill is 0–2 in practice).
- **Training (10%)**: no blocking issues → 100, any → 0. Uses `getTrainingBlockingReasons` with empty training data tolerated.

Weighted: `0.4 * cost + 0.3 * fatigue + 0.2 * skill + 0.1 * training`.

### UI change

In `DailyStatusCoverageGapPanel.jsx`:
- Sort float candidates by score descending.
- Sort OT candidates by score descending (remove the `.slice(0, 5)` cap; show top 6).
- Add a compact "cost / fatigue / skill" mini-badge per row so the manager sees why the top candidate is top.
- Keep existing period-assign buttons untouched.

### Tests

- Lower hourly_rate → higher cost sub-score.
- Fatigue exceeded → fatigue sub-score = 0.
- Sorting: identical fatigue + skill + training, different rates → cheaper staff first.

### Commit message: `feat: rank gap-fill candidates by composite cost/fatigue/skill/training score`

---

## Feature 2 — AL cover optimiser

### Scorer / Generator

`generateCoverPlan({ dates, overrides, config, staff })` → `{ assignments, totalCost, residualGaps }`.

Algorithm per date per period that's short of minimum:
1. Determine shortfall `S = max(0, minHeads - currentlyScheduled)`.
2. Greedy fill, in this order:
   - Float staff whose scheduled shift is AVL that day — assign their period-appropriate shift.
   - Care staff scheduled OFF whose fatigue/WTR is safe — propose `OC-E` / `OC-L` / `OC-EL` / `OC-N` by period.
   - Agency — `AG-E` / `AG-L` / `AG-EL` / `AG-N` as fallback (unlimited).
3. Record each proposed override with `cost` via `calculateDayCost` deltas.
4. Return full plan and residual (positions that even agency couldn't fill — e.g. night-period shortfall after midnight).

Skip periods already above minimum.

### UI change

In `src/pages/AnnualLeave.jsx` `bookAL()`:
- After successful save, compute `generateCoverPlan` over the booked date range.
- If `assignments.length > 0`, open `<CoverPlanModal>` with the plan.
- Manager can review per-day, de-select any proposed line, then Accept All (or Accept Selected).
- Accept writes all chosen overrides via `bulkUpsertOverrides` (existing endpoint, same validation path).

New component `src/components/scheduling/CoverPlanModal.jsx`:
- Lists per-day `{ date, period, proposed: { staffId OR agency, shift, cost } }`.
- Checkbox per row (default checked).
- Running total cost.
- "Accept selected" and "Dismiss" buttons.

### Tests

- Plan generator: 1 AL staff, 2 available floaters, no OT needed → 1 float assignment.
- Plan generator: 2 AL staff, 1 floater, 1 off-duty care → 1 float + 1 OT.
- Plan generator: 3 AL staff, no floaters, no off-duty → 3 agency.
- Plan generator: no shortfall → empty assignments.
- Cost total sums line items.

### Commit message: `feat: propose cover plan after AL booking with float/OT/agency cascade`

---

## Verification

After all three features:
- `npm run lint` — clean.
- Targeted `npx vitest run` on touched files + rotationAnalysis tests.
- Full `npm run test:frontend` — no new flakes.
- Backend: `npx vitest run tests/integration/scheduling.test.js` — WTR server-side path covered by new test.

## Risks

- **Server-side WTR needs staff's current overrides to project.** Already loaded via the upsert endpoint; compute against existing DB state plus the incoming row.
- **Cover plan UI can be overwhelming on a 10-day AL booking.** Mitigation: group by day, checkbox pre-selects agency only if no cheaper option exists, show totals prominently.
- **Gap panel layout churn.** Keep the existing column positions; add the mini-badges inline so visual changes are minimal.
