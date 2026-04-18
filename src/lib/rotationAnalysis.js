import {
  isCareRole,
  getCycleDay,
  getScheduledShift,
  isWorkingShift,
  formatDate,
  parseDate,
  addDays,
  getStaffForDay,
  getShiftHours,
  checkWTRImpact,
} from './rotation.js';
import { checkFatigueRisk } from './escalation.js';
import { getTrainingBlockingReasons } from './training.js';

// Re-export shared WTR helpers so frontend callers can keep importing from
// rotationAnalysis even though the authoritative implementation lives in
// shared/rotation.js (so the server can run the same check).
export {
  checkWTRImpact,
  WTR_WEEKLY_LIMIT,
  WTR_WEEKLY_WARN,
} from './rotation.js';

// Score a candidate cycle-start offset by counting fully-covered period-slots
// across the next 28 days. Returns { covered, total, ratio }.
// "Fully covered" means scheduled heads >= minimum heads for that period.
// Overrides (sick/AL) are IGNORED here — we're scoring the pattern itself,
// not the current roster. This lets a manager see which offset would ship the
// most coverage before any manual absences are applied on top.
export function scoreCycleStartOffset(config, staff, offsetDays, fromDate = new Date()) {
  const base = parseDate(formatDate(fromDate));
  const currentStart = parseDate(config?.cycle_start_date || formatDate(fromDate));
  const shiftedStart = addDays(currentStart, offsetDays);
  const simConfig = { ...config, cycle_start_date: formatDate(shiftedStart) };
  const min = config?.minimum_staffing || {};
  const periods = ['early', 'late', 'night'];
  let covered = 0;
  let total = 0;
  for (let i = 0; i < 28; i++) {
    const date = addDays(base, i);
    const scheduled = (staff || [])
      .filter(s => s.active !== false && isCareRole(s.role))
      .map(s => {
        const cd = getCycleDay(date, simConfig.cycle_start_date);
        return getScheduledShift(s, cd, date, simConfig);
      });
    for (const period of periods) {
      const minHeads = min[period]?.heads ?? 0;
      if (minHeads === 0) continue;
      total++;
      const heads = scheduled.filter(sh => periodCoversShift(period, sh)).length;
      if (heads >= minHeads) covered++;
    }
  }
  return { covered, total, ratio: total > 0 ? covered / total : 0 };
}

function periodCoversShift(period, sh) {
  if (!isWorkingShift(sh)) return false;
  if (period === 'early') return sh === 'E' || sh === 'EL' || sh === 'OC-E' || sh === 'OC-EL' || sh === 'BH-D';
  if (period === 'late') return sh === 'L' || sh === 'EL' || sh === 'OC-L' || sh === 'OC-EL' || sh === 'BH-D';
  if (period === 'night') return sh === 'N' || sh === 'OC-N' || sh === 'BH-N';
  return false;
}

// ── Feature 1: Gap-fill suggester ───────────────────────────────────────────
//
// scoreGapFillCandidate ranks a staff member's fitness to fill a coverage gap
// on a given date. Composite 0–100 with four weighted sub-scores:
//   - 40% cost     — cheaper than agency day rate is better
//   - 30% fatigue  — fewer consecutive days worked is better
//   - 20% skill    — higher skill multiplier is better
//   - 10% training — no blocking training issues is better
//
// Defensive: never throws. Missing rate, role, or training data degrades the
// sub-score rather than the whole result. Callers sort descending by `.score`
// to surface the best candidate first.

export function scoreGapFillCandidate(staff, date, overrides, config, trainingData = null) {
  const agencyRate = parseFloat(config?.agency_rate_day) || 25;
  const staffRate = parseFloat(staff?.hourly_rate) || 0;
  const costScore = staffRate > 0
    ? Math.max(0, Math.min(100, 100 * (1 - staffRate / agencyRate)))
    : 50; // unknown rate → neutral

  const fatigue = checkFatigueRisk(staff, date, overrides || {}, config || {});
  const fatigueScore = fatigue.exceeded ? 0 : fatigue.atRisk ? 50 : 100;

  const skill = parseFloat(staff?.skill) || 0;
  const skillScore = Math.min(100, skill * 50);

  let trainingScore = 100;
  if (trainingData && staff?.id && staff?.role) {
    try {
      const asOf = typeof date === 'string' ? date : formatDate(date);
      const reasons = getTrainingBlockingReasons(staff.id, staff.role, trainingData, config, asOf);
      if (Array.isArray(reasons) && reasons.length > 0) trainingScore = 0;
    } catch {
      // A bad training config shouldn't break ranking — stay neutral.
    }
  }

  const composite = 0.4 * costScore + 0.3 * fatigueScore + 0.2 * skillScore + 0.1 * trainingScore;

  return {
    score: Math.round(composite),
    breakdown: {
      cost: Math.round(costScore),
      fatigue: Math.round(fatigueScore),
      skill: Math.round(skillScore),
      training: Math.round(trainingScore),
    },
  };
}

// ── Feature 2: AL cover optimiser ──────────────────────────────────────────
//
// generateCoverPlan proposes a greedy float → OT → agency cover plan across a
// date range, given current overrides and staff. For each date + period short
// of minimum staffing, fill from (in order):
//   1. Float staff on AVL that day, ranked by composite score
//   2. Care staff scheduled OFF, as OC-E/L/N overtime, ranked by score + WTR check
//   3. Agency (AG-E/L/N) — unlimited, as last resort
//
// Prior proposals within the same pass feed back into WTR and availability
// checks: if we propose OT for Alice on Monday, Tuesday's check sees that.
//
// Returns { assignments: [...], totalCost, residualGaps }.
// Each assignment: { date, staffId, staffName, shift, source, kind, cost, warn }.
// Agency rows have a virtual generated staffId compatible with the overrides
// endpoint (pattern matches existing agency booking at DailyStatus.jsx:485).

const PERIOD_TO_SHIFT = { early: 'E', late: 'L', night: 'N' };
const PERIOD_TO_OC_SHIFT = { early: 'OC-E', late: 'OC-L', night: 'OC-N' };
const PERIOD_TO_AG_SHIFT = { early: 'AG-E', late: 'AG-L', night: 'AG-N' };
const NON_ASSIGNABLE_SHIFTS = new Set(['SICK', 'AL', 'NS', 'AVL']);

function randomAgencyId() {
  // Mirror DailyStatus.jsx:485 agency id pattern so server accepts it as-is.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `AG-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  }
  // Non-crypto fallback for server-side / older runtimes.
  return `AG-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

function applyProposalsAsOverrides(baseOverrides, proposals) {
  const result = { ...(baseOverrides || {}) };
  for (const a of proposals) {
    if (a.kind === 'agency' || !a.staffId) continue;
    if (!result[a.date]) result[a.date] = {};
    else result[a.date] = { ...result[a.date] };
    result[a.date][a.staffId] = {
      ...(result[a.date][a.staffId] || {}),
      shift: a.shift,
      source: a.source,
    };
  }
  return result;
}

export function generateCoverPlan({ dates, overrides, config, staff }) {
  const min = config?.minimum_staffing || {};
  const hourlyByStaff = new Map((staff || []).map(s => [s.id, parseFloat(s.hourly_rate) || 0]));
  const dayAgencyRate = parseFloat(config?.agency_rate_day) || 0;
  const nightAgencyRate = parseFloat(config?.agency_rate_night) || dayAgencyRate;
  const otPremium = parseFloat(config?.ot_premium) || 0;

  const assignments = [];
  let totalCost = 0;
  let residualGaps = 0;

  for (const date of dates) {
    const dateStr = typeof date === 'string' ? date : formatDate(date);
    const dateObj = typeof date === 'string' ? parseDate(date) : date;

    // Rebuild effective overrides at the start of each date so prior proposals
    // in the same plan feed into today's availability + WTR calculations.
    const effectiveOverrides = applyProposalsAsOverrides(overrides, assignments);
    const dayStaff = getStaffForDay(staff || [], dateObj, effectiveOverrides, config);
    const assignedToday = new Set();

    for (const period of ['early', 'late', 'night']) {
      const needed = min[period]?.heads ?? 0;
      if (needed === 0) continue;

      const currentHeads = dayStaff.filter(s => periodCoversShift(period, s.shift) && isCareRole(s.role)).length;
      let shortfall = needed - currentHeads;
      if (shortfall <= 0) continue;

      // 1. Float staff on AVL that day, ranked by score
      const floatPool = dayStaff
        .filter(s => s.shift === 'AVL' && isCareRole(s.role) && !assignedToday.has(s.id))
        .map(s => ({ s, scored: scoreGapFillCandidate(s, dateStr, effectiveOverrides, config) }))
        .sort((a, b) => b.scored.score - a.scored.score);

      for (const { s } of floatPool) {
        if (shortfall <= 0) break;
        const shiftCode = PERIOD_TO_SHIFT[period];
        const hours = getShiftHours(shiftCode, config);
        const cost = hours * (hourlyByStaff.get(s.id) || 0);
        assignments.push({
          date: dateStr,
          staffId: s.id,
          staffName: s.name,
          shift: shiftCode,
          source: 'float',
          kind: 'float',
          period,
          cost,
          warn: false,
        });
        assignedToday.add(s.id);
        totalCost += cost;
        shortfall--;
      }
      if (shortfall <= 0) continue;

      // 2. OT from off-duty care staff, WTR-gated
      const otPool = dayStaff
        .filter(s =>
          isCareRole(s.role)
          && !isWorkingShift(s.shift)
          && !NON_ASSIGNABLE_SHIFTS.has(s.shift)
          && !assignedToday.has(s.id)
        )
        .map(s => ({ s, scored: scoreGapFillCandidate(s, dateStr, effectiveOverrides, config) }))
        .sort((a, b) => b.scored.score - a.scored.score);

      for (const { s } of otPool) {
        if (shortfall <= 0) break;
        const ocShift = PERIOD_TO_OC_SHIFT[period];
        const impact = checkWTRImpact(s, dateStr, effectiveOverrides, config, ocShift);
        if (!impact.ok) continue; // WTR would be breached — skip this staff for OT
        const hours = getShiftHours(ocShift, config);
        const baseCost = hours * (hourlyByStaff.get(s.id) || 0);
        const premium = hours * otPremium;
        const cost = baseCost + premium;
        assignments.push({
          date: dateStr,
          staffId: s.id,
          staffName: s.name,
          shift: ocShift,
          source: 'ot',
          kind: 'ot',
          period,
          cost,
          warn: impact.warn,
        });
        assignedToday.add(s.id);
        totalCost += cost;
        shortfall--;
      }
      if (shortfall <= 0) continue;

      // 3. Agency fallback — always available
      const agShift = PERIOD_TO_AG_SHIFT[period];
      const agHours = getShiftHours(agShift, config);
      const agRate = period === 'night' ? nightAgencyRate : dayAgencyRate;
      if (agHours === 0 || agRate === 0) {
        // No usable agency config — record as residual gap rather than push an uncosted row
        residualGaps += shortfall;
        shortfall = 0;
        continue;
      }
      while (shortfall > 0) {
        const cost = agHours * agRate;
        assignments.push({
          date: dateStr,
          staffId: randomAgencyId(),
          staffName: 'Agency',
          shift: agShift,
          source: 'agency',
          kind: 'agency',
          period,
          cost,
          warn: false,
        });
        totalCost += cost;
        shortfall--;
      }
    }
  }

  return { assignments, totalCost, residualGaps };
}

// ── Round 3: Horizon roster solver ─────────────────────────────────────────
//
// generateHorizonRoster fills an arbitrary date range's coverage gaps in a
// single pass, extending generateCoverPlan with three things:
//
//   1. Anti-stacking: after assigning OT to a staff member, their composite
//      score is penalised for subsequent OT assignments in the same calendar
//      week. This stops the cheapest/rested staff from soaking up every OT
//      slot when two or more people are equally suitable. Penalty is
//      2 × (hours of OT already assigned this week).
//   2. Prior-pass carry-forward (already in generateCoverPlan): each new
//      assignment rolls into `working` overrides so subsequent days see it
//      for WTR and fatigue.
//   3. Aggregate summary: filled vs needed slots, cost, counts by source,
//      WTR-warning tally — enough for the modal banner.
//
// Non-goals (still future work): CP-SAT solver, pattern-shift reassignment,
// simulated-annealing polish pass.

const ANTI_STACK_PENALTY_PER_HOUR = 2;

function weekKeyFor(dateStr) {
  const d = parseDate(dateStr);
  const dayOfWeek = d.getUTCDay();
  const daysFromMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return formatDate(addDays(d, -daysFromMon));
}

export function generateHorizonRoster({ dates, overrides, config, staff }) {
  const min = config?.minimum_staffing || {};
  const hourlyByStaff = new Map((staff || []).map(s => [s.id, parseFloat(s.hourly_rate) || 0]));
  const dayAgencyRate = parseFloat(config?.agency_rate_day) || 0;
  const nightAgencyRate = parseFloat(config?.agency_rate_night) || dayAgencyRate;
  const otPremium = parseFloat(config?.ot_premium) || 0;

  const assignments = [];
  let totalCost = 0;
  let residualGaps = 0;

  // Track hours of OT already proposed per (staffId, weekKey) — the anti-stack ledger.
  const otLoad = new Map();
  const otLoadKey = (staffId, weekKey) => `${staffId}|${weekKey}`;

  // Aggregate counters for the summary.
  let gapSlotsTotal = 0;
  let gapSlotsFilled = 0;
  let floatCount = 0;
  let otCount = 0;
  let agencyCount = 0;
  let wtrWarnings = 0;

  for (const date of dates) {
    const dateStr = typeof date === 'string' ? date : formatDate(date);
    const dateObj = typeof date === 'string' ? parseDate(date) : date;
    const weekKey = weekKeyFor(dateStr);

    const effectiveOverrides = applyProposalsAsOverrides(overrides, assignments);
    const dayStaff = getStaffForDay(staff || [], dateObj, effectiveOverrides, config);
    const assignedToday = new Set();

    for (const period of ['early', 'late', 'night']) {
      const needed = min[period]?.heads ?? 0;
      if (needed === 0) continue;

      const currentHeads = dayStaff.filter(s => periodCoversShift(period, s.shift) && isCareRole(s.role)).length;
      let shortfall = needed - currentHeads;
      if (shortfall <= 0) continue;
      gapSlotsTotal += shortfall;

      // 1. Float pool, ranked by composite score. No anti-stack penalty — float
      //    shifts are regular hours for float staff, not true overtime.
      const floatPool = dayStaff
        .filter(s => s.shift === 'AVL' && isCareRole(s.role) && !assignedToday.has(s.id))
        .map(s => ({ s, scored: scoreGapFillCandidate(s, dateStr, effectiveOverrides, config) }))
        .sort((a, b) => b.scored.score - a.scored.score);

      for (const { s } of floatPool) {
        if (shortfall <= 0) break;
        const shiftCode = PERIOD_TO_SHIFT[period];
        const hours = getShiftHours(shiftCode, config);
        const cost = hours * (hourlyByStaff.get(s.id) || 0);
        assignments.push({
          date: dateStr, staffId: s.id, staffName: s.name, shift: shiftCode,
          source: 'float', kind: 'float', period, cost, warn: false,
        });
        assignedToday.add(s.id);
        totalCost += cost;
        floatCount++;
        gapSlotsFilled++;
        shortfall--;
      }
      if (shortfall <= 0) continue;

      // 2. OT pool, ranked by composite score *minus anti-stack penalty*.
      const otPool = dayStaff
        .filter(s =>
          isCareRole(s.role)
          && !isWorkingShift(s.shift)
          && !NON_ASSIGNABLE_SHIFTS.has(s.shift)
          && !assignedToday.has(s.id)
        )
        .map(s => {
          const baseScore = scoreGapFillCandidate(s, dateStr, effectiveOverrides, config).score;
          const loaded = otLoad.get(otLoadKey(s.id, weekKey)) || 0;
          const adjustedScore = baseScore - ANTI_STACK_PENALTY_PER_HOUR * loaded;
          return { s, baseScore, adjustedScore };
        })
        .sort((a, b) => b.adjustedScore - a.adjustedScore);

      for (const { s } of otPool) {
        if (shortfall <= 0) break;
        const ocShift = PERIOD_TO_OC_SHIFT[period];
        const currentWorking = applyProposalsAsOverrides(overrides, assignments);
        const impact = checkWTRImpact(s, dateStr, currentWorking, config, ocShift);
        if (!impact.ok) continue;
        const hours = getShiftHours(ocShift, config);
        const baseCost = hours * (hourlyByStaff.get(s.id) || 0);
        const premium = hours * otPremium;
        const cost = baseCost + premium;
        assignments.push({
          date: dateStr, staffId: s.id, staffName: s.name, shift: ocShift,
          source: 'ot', kind: 'ot', period, cost, warn: impact.warn,
        });
        assignedToday.add(s.id);
        totalCost += cost;
        otCount++;
        if (impact.warn) wtrWarnings++;
        gapSlotsFilled++;
        // Anti-stack ledger update
        const key = otLoadKey(s.id, weekKey);
        otLoad.set(key, (otLoad.get(key) || 0) + hours);
        shortfall--;
      }
      if (shortfall <= 0) continue;

      // 3. Agency fallback
      const agShift = PERIOD_TO_AG_SHIFT[period];
      const agHours = getShiftHours(agShift, config);
      const agRate = period === 'night' ? nightAgencyRate : dayAgencyRate;
      if (agHours === 0 || agRate === 0) {
        residualGaps += shortfall;
        shortfall = 0;
        continue;
      }
      while (shortfall > 0) {
        const cost = agHours * agRate;
        assignments.push({
          date: dateStr, staffId: randomAgencyId(), staffName: 'Agency', shift: agShift,
          source: 'agency', kind: 'agency', period, cost, warn: false,
        });
        totalCost += cost;
        agencyCount++;
        gapSlotsFilled++;
        shortfall--;
      }
    }
  }

  const coverageFillPct = gapSlotsTotal > 0 ? gapSlotsFilled / gapSlotsTotal : 1;

  return {
    assignments,
    totalCost,
    residualGaps,
    summary: {
      gapSlotsTotal,
      gapSlotsFilled,
      coverageFillPct,
      floatShifts: floatCount,
      otShifts: otCount,
      agencyShifts: agencyCount,
      wtrWarnings,
      totalCost,
    },
  };
}
