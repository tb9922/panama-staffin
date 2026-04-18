# Rotation Pattern Customisation — Implementation Plan

**Goal:** Make the 14-day team rotation pattern configurable per home (currently hardcoded Panama 2-2-3), ship a preset catalogue and a custom 2×14 editor, and add a cycle-offset tuning tool that shows weekend/skill coverage for each of the 14 possible start-date offsets.

**Architecture:** Store the pattern in `config.rotation_pattern` (JSONB already available via `homes.config`). Keep `PANAMA_PATTERN` as the default when the field is absent — full backwards compat. Thread `config` through `getScheduledShift(staff, cycleDay, date, config)` and `getCycleDay(date, cycleStartDate, config)` so both resolve the active pattern/length from the home. UI lives in Config.jsx under a new "Rotation Pattern" section plus a "Cycle Start Tuning" section.

**Tech Stack:** React 19 + Vite 7, Tailwind 4 + `src/lib/design.js` tokens, Zod server-side validation via `lib/zodHelpers.js`, Vitest for unit + component tests. No DB migration required — `config` is already JSONB on `homes`.

**Scope — MVP (this session):**
- Custom 14-day two-team pattern (A / B arrays, 14 entries each, binary 0/1)
- Preset catalogue: Panama 2-2-3, Pitman Fixed, Continental 2-2-2, 4-on-4-off, Alternating Weeks
- Cycle-offset tuning: grid showing coverage score for offsets 0–13

**Out of scope (future rounds):**
- Non-14-day cycles (7-day, 28-day DuPont, etc.) — keep `cycleLength = 14` invariant
- More than two base teams — A/B only
- Per-staff bespoke patterns — still team-based
- Night-team separate patterns — Night A/B still follow A/B working days
- Full NRP solver (Round 3)

---

## File Inventory

| Path | Create / Modify | Responsibility |
|---|---|---|
| `shared/rotation.js` | Modify | Export `ROTATION_PRESETS`, `DEFAULT_PATTERN`, `resolvePattern(config)`, extend `getScheduledShift` + `getCycleDay` signatures |
| `lib/zodHelpers.js` | Modify | Extend `homeConfigSchema` with optional `rotation_pattern` object |
| `src/pages/Config.jsx` | Modify | New section "Rotation Pattern" with preset dropdown + 2×14 grid editor + next-28-days preview; new section "Cycle Start Tuning" with offset-score heatmap |
| `src/lib/__tests__/rotation.test.js` | Modify | Add tests: custom pattern resolution, preset shape, fallback behaviour |
| `src/pages/RotationGrid.jsx` | Modify | Pass `schedData.config` to `getScheduledShift` / `getCycleDay` |
| `src/pages/AnnualLeave.jsx` | Modify | Same passthrough |
| `src/components/scheduling/RotationGridModals.jsx` | Modify | Same passthrough |
| `routes/scheduling.js` | Modify | Same passthrough (backend-side) |
| `services/staffPortalService.js` | Modify | Same passthrough |

---

## Task Breakdown

### Task 1 — Pattern resolver + presets + Zod schema

**Files:**
- Modify: `shared/rotation.js`
- Modify: `lib/zodHelpers.js`
- Modify: `src/lib/__tests__/rotation.test.js`

**What:**
1. In `shared/rotation.js`, rename existing `PANAMA_PATTERN` to `DEFAULT_PATTERN` (keep shape). Add a `ROTATION_PRESETS` array of `{ id, name, description, teams: { A: number[14], B: number[14] } }` with:
   - `panama-223` — current pattern
   - `pitman-fixed` — `A: [1,1,0,0,0,1,1,1,1,0,0,0,1,1]`, `B` = complement
   - `continental-222` — `A: [1,1,0,0,1,1,0,0,1,1,0,0,1,1]`, `B` = complement
   - `4on-4off` — `A: [1,1,1,1,0,0,0,0,1,1,1,1,0,0]`, `B` = complement
   - `alt-weeks` — `A: [1,1,1,1,1,1,1,0,0,0,0,0,0,0]`, `B` = complement
2. Add helpers:
   - `resolvePattern(config)` → returns `config.rotation_pattern?.teams` or `DEFAULT_PATTERN.teams`
   - `resolveCycleLength()` → returns 14 (hardcoded for MVP; wired as a helper to make future non-14-day cycles a single-site change)
   - `validatePatternShape(pattern)` → throws if malformed (used by Zod refinement)
3. Extend `homeConfigSchema` in `lib/zodHelpers.js`:
   ```js
   rotation_pattern: z.object({
     preset_id: z.string().max(30).nullable().optional(),
     teams: z.object({
       A: z.array(z.union([z.literal(0), z.literal(1)])).length(14),
       B: z.array(z.union([z.literal(0), z.literal(1)])).length(14),
     }),
   }).optional(),
   ```
4. Tests:
   - `resolvePattern(undefined)` returns DEFAULT_PATTERN.teams
   - `resolvePattern({})` returns DEFAULT_PATTERN.teams
   - `resolvePattern({ rotation_pattern: { teams: { A: [...], B: [...] } } })` returns those teams
   - Every `ROTATION_PRESETS` entry has `teams.A.length === 14 && teams.B.length === 14` and all values are 0 or 1
   - Panama preset matches the original hardcoded PANAMA_PATTERN exactly

**Verify:** `npx vitest run --config vitest.config.frontend.js src/lib/__tests__/rotation.test.js`

**Commit message:** `feat: make rotation pattern configurable per home with preset catalogue`

---

### Task 2 — Thread config through getScheduledShift and getCycleDay

**Files:**
- Modify: `shared/rotation.js`

**What:**
- Change signature: `getScheduledShift(staff, cycleDay, date, config = null)` — when `config?.rotation_pattern?.teams` present, use those; else `DEFAULT_PATTERN`.
- `getCycleDay(date, cycleStartDate, config = null)` — unchanged behaviour for now (MVP keeps 14), but accepts config for future.
- Update `getActualShift` to pass config through internally (it already has access).
- Tests:
  - Existing tests continue to pass (config not supplied → default pattern)
  - New test: custom pattern in config drives `getScheduledShift` output
  - New test: when `config.rotation_pattern` uses inverse arrays, Day A is off when stock Panama would have them working

**Verify:** `npx vitest run --config vitest.config.frontend.js src/lib/__tests__/rotation.test.js`

**Commit message:** `feat: thread config through rotation helpers to honour custom patterns`

---

### Task 3 — Update every caller to pass config

**Files:**
- Modify: `src/pages/RotationGrid.jsx`
- Modify: `src/pages/AnnualLeave.jsx`
- Modify: `src/components/scheduling/RotationGridModals.jsx`
- Modify: `routes/scheduling.js`
- Modify: `services/staffPortalService.js`

**What:** Every `getScheduledShift(s, d, dt)` → `getScheduledShift(s, d, dt, config)`; every `getCycleDay(d, start)` → `getCycleDay(d, start, config)`. Grep to confirm no misses.

**Verify:**
- `grep -rn "getScheduledShift\|getCycleDay" src/ routes/ services/ shared/` — every call passes `config` (or clearly doesn't have it, which is a bug)
- `npx vitest run --config vitest.config.frontend.js` — full frontend suite green
- `npm run lint` — clean

**Commit message:** `refactor: pass config to getScheduledShift/getCycleDay at all call sites`

---

### Task 4 — Config UI: Rotation Pattern section

**Files:**
- Modify: `src/pages/Config.jsx`

**What:**
1. New card "Rotation Pattern" in Config.jsx, guarded by `canEdit = canWrite('config')`.
2. Preset dropdown populated from `ROTATION_PRESETS`. Selecting a preset copies its `teams` into local edit state.
3. Custom editor: two rows × 14 columns of toggle buttons, one row for A, one for B. Toggling A[i] flips B[i] automatically (keep teams complementary — that's what "A and B alternate" means). Manager can also select "freeform" to unlink them.
4. Preview panel: next 28 days — which team would be scheduled working, which off — using the draft pattern.
5. Save button saves to the home config via the existing `updateConfig` / `/api/data` save flow.
6. UI tokens: `CARD.padded`, `BTN.primary`, `BTN.secondary`, `BADGE.blue` for working, `BADGE.gray` for off.

**Tests:**
- Component test: renders with 5 presets in dropdown
- Component test: clicking a preset loads its teams into the editor grid
- Component test: toggling A[i] in complementary mode flips B[i]

**Verify:**
- Run dev server manually? No — rely on component tests. User will verify visually after merge.
- `npx vitest run --config vitest.config.frontend.js src/pages/__tests__/Config.test.jsx` — green

**Commit message:** `feat: add Rotation Pattern editor and preset picker to Config`

---

### Task 5 — Cycle Start Tuning tool

**Files:**
- Modify: `src/pages/Config.jsx`

**What:**
1. New card "Cycle Start Tuning".
2. Button "Analyse offsets" triggers a local computation: for each `offset ∈ 0..13`, compute a score = number of fully-covered weekend days in the next 28 days, given the current pattern and current staff. Display as a horizontal bar chart with the current offset highlighted.
3. Each row has an "Apply this offset" button that computes the new `cycle_start_date = addDays(current, offset)` and writes it to config after a `confirm()` dialog.
4. Pure client-side — no new endpoint.

**Tests:**
- Unit test for the offset scorer helper (pure function): given a fixed staff + override set + pattern, all 14 offsets produce stable, comparable numeric scores.

**Verify:**
- `npx vitest run --config vitest.config.frontend.js src/lib/__tests__/rotation.test.js` — scorer test green

**Commit message:** `feat: cycle-start tuning tool with coverage score per offset`

---

### Task 6 — Final verification + commit

**What:**
1. `npm run lint` — clean.
2. `npm run test:frontend` — full suite passes (or at most the one pre-existing CQCEvidence flake).
3. `npm test` — backend suite passes.
4. Smoke-check the plan file checklist against the spec.

**Commit message (if any loose ends):** `chore: tidy up rotation customisation loose ends`

---

## Verification — end-to-end

Manual, after merge:
1. Open Config → Rotation Pattern. Verify the preset dropdown shows 5 options. Select "4-on-4-off". Verify the grid changes. Save. Reload.
2. Open RotationGrid. Confirm the visible rota now follows the 4-on-4-off pattern for this home.
3. Revert to Panama 2-2-3. Confirm the rota snaps back to the original pattern.
4. Open Config → Cycle Start Tuning → Analyse offsets. Verify a score appears for each of the 14 offsets with the current offset highlighted.
5. Click "Apply" on a non-current offset. Confirm → reload → RotationGrid reflects the new cycle start.

## Rollback

Remove `config.rotation_pattern` from a home's config JSONB and reload. `resolvePattern` falls back to `DEFAULT_PATTERN`. No migration to reverse.

## Risks

- **Desync between frontend and backend pattern resolution** — Mitigated: both import `shared/rotation.js`, single source of truth.
- **Existing staff with active shifts under Panama 2-2-3 get reshuffled when a manager switches pattern** — Acceptable for MVP: overrides take precedence over pattern, and a warning on the save button tells the manager to expect rota shifts. Document in the Config help text.
- **Preset list becomes stale** — Unlikely; add presets as needed. Static export from `shared/rotation.js`.
- **Zod schema accepts malformed teams** — `.length(14)` + `z.union([z.literal(0), z.literal(1)])` blocks non-binary + wrong-length inputs at the API boundary.
