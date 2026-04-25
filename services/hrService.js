import * as hrRepo from '../repositories/hrRepo.js';

// ── Bradford Factor ─────────────────────────────────────────────────────────

const DEFAULT_TRIGGERS = { informal: 51, stage_1: 201, stage_2: 401, final: 801 };

function getTriggerLevel(score, triggers) {
  const t = triggers || DEFAULT_TRIGGERS;
  if (score >= t.final) return 'final';
  if (score >= t.stage_2) return 'stage_2';
  if (score >= t.stage_1) return 'stage_1';
  if (score >= t.informal) return 'informal';
  return 'none';
}

/**
 * Group an array of date strings (YYYY-MM-DD, sorted ascending) into spells.
 * Consecutive calendar days belong to the same spell.
 * Returns [{ start, end, days }].
 */
function groupSpells(dates) {
  if (!dates.length) return [];
  const spells = [];
  let start = dates[0];
  let prev = dates[0];
  let days = 1;

  for (let i = 1; i < dates.length; i++) {
    const prevMs = Date.UTC(+prev.slice(0, 4), +prev.slice(5, 7) - 1, +prev.slice(8, 10));
    const currMs = Date.UTC(+dates[i].slice(0, 4), +dates[i].slice(5, 7) - 1, +dates[i].slice(8, 10));
    const diffDays = (currMs - prevMs) / 86400000;

    if (diffDays === 1) {
      days++;
    } else {
      spells.push({ start, end: prev, days });
      start = dates[i];
      days = 1;
    }
    prev = dates[i];
  }
  spells.push({ start, end: prev, days });
  return spells;
}

function toDateOnly(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function addRtwSpellDates(targetSet, row, cutoff) {
  const start = toDateOnly(row.absence_start_date);
  if (!start) return;
  const end = toDateOnly(row.absence_end_date) || start;
  let current = start < cutoff ? cutoff : start;
  while (current <= end) {
    targetSet.add(current);
    const next = new Date(`${current}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    current = next.toISOString().slice(0, 10);
  }
}

function getOrCreateDateSet(map, staffId) {
  if (!map.has(staffId)) map.set(staffId, new Set());
  return map.get(staffId);
}

/**
 * Calculate Bradford Factor scores for all staff with SICK overrides in the
 * rolling 12 months. Formula: S x S x D (S = separate spells, D = total days).
 */
export async function calculateBradfordScores(homeId) {
  const today = new Date();
  const yearAgo = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate()));
  const cutoff = yearAgo.toISOString().slice(0, 10);

  const [sickRows, rtwRows, homeConfig] = await Promise.all([
    hrRepo.findSickOverrides(homeId, cutoff),
    hrRepo.findRtwAbsenceSpells(homeId, cutoff),
    hrRepo.findHomeConfig(homeId),
  ]);
  const triggers = homeConfig.absence_triggers || DEFAULT_TRIGGERS;

  // Group absence dates by staff_id. A Set de-duplicates overlaps where RTW
  // records and rota SICK overrides describe the same spell.
  const byStaff = new Map();
  for (const row of sickRows) {
    getOrCreateDateSet(byStaff, row.staff_id).add(toDateOnly(row.date));
  }
  for (const row of rtwRows) {
    addRtwSpellDates(getOrCreateDateSet(byStaff, row.staff_id), row, cutoff);
  }

  const results = [];
  for (const [staff_id, dateSet] of byStaff) {
    const dates = [...dateSet].filter(Boolean).sort();
    const spells = groupSpells(dates);
    const totalDays = spells.reduce((sum, s) => sum + s.days, 0);
    const s = spells.length;
    const score = s * s * totalDays;
    results.push({
      staff_id,
      spells: s,
      days: totalDays,
      score,
      trigger_level: getTriggerLevel(score, triggers),
    });
  }

  return results;
}

/**
 * Individual absence summary for a single staff member.
 * Returns detailed spell breakdown plus Bradford Factor.
 */
export async function getAbsenceSummary(homeId, staffId) {
  const today = new Date();
  const yearAgo = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate()));
  const cutoff = yearAgo.toISOString().slice(0, 10);

  const [sickRows, rtwRows, homeConfig] = await Promise.all([
    hrRepo.findStaffSickOverrides(homeId, staffId, cutoff),
    hrRepo.findStaffRtwAbsenceSpells(homeId, staffId, cutoff),
    hrRepo.findHomeConfig(homeId),
  ]);
  const triggers = homeConfig.absence_triggers || DEFAULT_TRIGGERS;

  const dateSet = new Set(sickRows.map(r => toDateOnly(r.date)).filter(Boolean));
  for (const row of rtwRows) addRtwSpellDates(dateSet, row, cutoff);
  const dates = [...dateSet].sort();
  const spells = groupSpells(dates);
  const totalDays = spells.reduce((sum, s) => sum + s.days, 0);
  const s = spells.length;
  const score = s * s * totalDays;

  return {
    staff_id: staffId,
    spells,
    totalDays,
    totalSpells: s,
    bradfordScore: score,
    trigger_level: getTriggerLevel(score, triggers),
  };
}

// ── Working Days ────────────────────────────────────────────────────────────

function parseDateUTC(str) {
  return new Date(Date.UTC(+str.slice(0, 4), +str.slice(5, 7) - 1, +str.slice(8, 10)));
}

function formatDateStr(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isWeekend(d) {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Add N working days to a date, skipping weekends and bank holidays.
 * bankHolidays is an array of { date: "YYYY-MM-DD" } objects or plain date strings.
 * Returns YYYY-MM-DD string.
 */
export function addWorkingDays(fromDate, days, bankHolidays = []) {
  const bhSet = new Set(
    bankHolidays.map(bh => typeof bh === 'string' ? bh : bh.date)
  );
  let current = parseDateUTC(fromDate);
  let remaining = days;

  while (remaining > 0) {
    current = new Date(current.getTime() + 86400000);
    if (!isWeekend(current) && !bhSet.has(formatDateStr(current))) {
      remaining--;
    }
  }

  return formatDateStr(current);
}

/**
 * Count working days between two dates (exclusive of from, inclusive of to),
 * skipping weekends and bank holidays.
 */
export function workingDaysBetween(from, to, bankHolidays = []) {
  const bhSet = new Set(
    bankHolidays.map(bh => typeof bh === 'string' ? bh : bh.date)
  );
  const start = parseDateUTC(from);
  const end = parseDateUTC(to);
  let count = 0;
  let current = new Date(start.getTime() + 86400000);

  while (current <= end) {
    if (!isWeekend(current) && !bhSet.has(formatDateStr(current))) {
      count++;
    }
    current = new Date(current.getTime() + 86400000);
  }

  return count;
}

// ── Thin wrappers — kept for semantic clarity ───────────────────────────────

export async function getActiveWarnings(homeId) { return hrRepo.getActiveWarnings(homeId); }
export async function getHrStats(homeId) { return hrRepo.getHrStats(homeId); }
