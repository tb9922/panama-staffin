import { pool } from '../db.js';
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

/**
 * Calculate Bradford Factor scores for all staff with SICK overrides in the
 * rolling 12 months. Formula: S x S x D (S = separate spells, D = total days).
 */
export async function calculateBradfordScores(homeId) {
  const today = new Date();
  const yearAgo = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate()));
  const cutoff = yearAgo.toISOString().slice(0, 10);

  const { rows: sickRows } = await pool.query(
    `SELECT date, staff_id FROM shift_overrides
     WHERE home_id = $1 AND shift = 'SICK' AND date >= $2
     ORDER BY staff_id, date`,
    [homeId, cutoff]
  );

  // Load absence_triggers from home config if overridden
  const { rows: homeRows } = await pool.query(
    `SELECT config FROM homes WHERE id = $1`, [homeId]
  );
  const homeConfig = homeRows[0]?.config || {};
  const triggers = homeConfig.absence_triggers || DEFAULT_TRIGGERS;

  // Group rows by staff_id
  const byStaff = new Map();
  for (const row of sickRows) {
    const dateStr = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : row.date;
    if (!byStaff.has(row.staff_id)) byStaff.set(row.staff_id, []);
    byStaff.get(row.staff_id).push(dateStr);
  }

  const results = [];
  for (const [staff_id, dates] of byStaff) {
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

  const { rows: sickRows } = await pool.query(
    `SELECT date FROM shift_overrides
     WHERE home_id = $1 AND staff_id = $2 AND shift = 'SICK' AND date >= $3
     ORDER BY date`,
    [homeId, staffId, cutoff]
  );

  const { rows: homeRows } = await pool.query(
    `SELECT config FROM homes WHERE id = $1`, [homeId]
  );
  const homeConfig = homeRows[0]?.config || {};
  const triggers = homeConfig.absence_triggers || DEFAULT_TRIGGERS;

  const dates = sickRows.map(r =>
    r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date
  );
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

// ── Passthrough CRUD — Disciplinary ─────────────────────────────────────────

export async function findDisciplinary(homeId, f) { return hrRepo.findDisciplinary(homeId, f); }
export async function findDisciplinaryById(id, homeId) { return hrRepo.findDisciplinaryById(id, homeId); }
export async function createDisciplinary(homeId, data) { return hrRepo.createDisciplinary(homeId, data); }
export async function updateDisciplinary(id, homeId, data) { return hrRepo.updateDisciplinary(id, homeId, data); }

// ── Passthrough CRUD — Grievance ────────────────────────────────────────────

export async function findGrievance(homeId, f) { return hrRepo.findGrievance(homeId, f); }
export async function findGrievanceById(id, homeId) { return hrRepo.findGrievanceById(id, homeId); }
export async function createGrievance(homeId, data) { return hrRepo.createGrievance(homeId, data); }
export async function updateGrievance(id, homeId, data) { return hrRepo.updateGrievance(id, homeId, data); }
export async function findGrievanceActions(grievanceId, homeId) { return hrRepo.findGrievanceActions(grievanceId, homeId); }
export async function createGrievanceAction(grievanceId, homeId, data) { return hrRepo.createGrievanceAction(grievanceId, homeId, data); }
export async function updateGrievanceAction(id, homeId, data) { return hrRepo.updateGrievanceAction(id, homeId, data); }

// ── Passthrough CRUD — Performance ──────────────────────────────────────────

export async function findPerformance(homeId, f) { return hrRepo.findPerformance(homeId, f); }
export async function findPerformanceById(id, homeId) { return hrRepo.findPerformanceById(id, homeId); }
export async function createPerformance(homeId, data) { return hrRepo.createPerformance(homeId, data); }
export async function updatePerformance(id, homeId, data) { return hrRepo.updatePerformance(id, homeId, data); }

// ── Passthrough CRUD — RTW Interviews ───────────────────────────────────────

export async function findRtwInterviews(homeId, f) { return hrRepo.findRtwInterviews(homeId, f); }
export async function createRtwInterview(homeId, data) { return hrRepo.createRtwInterview(homeId, data); }
export async function updateRtwInterview(id, homeId, data) { return hrRepo.updateRtwInterview(id, homeId, data); }

// ── Passthrough CRUD — OH Referrals ─────────────────────────────────────────

export async function findOhReferrals(homeId, f) { return hrRepo.findOhReferrals(homeId, f); }
export async function createOhReferral(homeId, data) { return hrRepo.createOhReferral(homeId, data); }
export async function updateOhReferral(id, homeId, data) { return hrRepo.updateOhReferral(id, homeId, data); }

// ── Passthrough CRUD — Contracts ────────────────────────────────────────────

export async function findContracts(homeId, f) { return hrRepo.findContracts(homeId, f); }
export async function findContractById(id, homeId) { return hrRepo.findContractById(id, homeId); }
export async function createContract(homeId, data) { return hrRepo.createContract(homeId, data); }
export async function updateContract(id, homeId, data) { return hrRepo.updateContract(id, homeId, data); }

// ── Passthrough CRUD — Family Leave ─────────────────────────────────────────

export async function findFamilyLeave(homeId, f) { return hrRepo.findFamilyLeave(homeId, f); }
export async function findFamilyLeaveById(id, homeId) { return hrRepo.findFamilyLeaveById(id, homeId); }
export async function createFamilyLeave(homeId, data) { return hrRepo.createFamilyLeave(homeId, data); }
export async function updateFamilyLeave(id, homeId, data) { return hrRepo.updateFamilyLeave(id, homeId, data); }

// ── Passthrough CRUD — Flexible Working ─────────────────────────────────────

export async function findFlexWorking(homeId, f) { return hrRepo.findFlexWorking(homeId, f); }
export async function findFlexWorkingById(id, homeId) { return hrRepo.findFlexWorkingById(id, homeId); }
export async function createFlexWorking(homeId, data) { return hrRepo.createFlexWorking(homeId, data); }
export async function updateFlexWorking(id, homeId, data) { return hrRepo.updateFlexWorking(id, homeId, data); }

// ── Passthrough CRUD — EDI ──────────────────────────────────────────────────

export async function findEdi(homeId, f) { return hrRepo.findEdi(homeId, f); }
export async function findEdiById(id, homeId) { return hrRepo.findEdiById(id, homeId); }
export async function createEdi(homeId, data) { return hrRepo.createEdi(homeId, data); }
export async function updateEdi(id, homeId, data) { return hrRepo.updateEdi(id, homeId, data); }

// ── Passthrough CRUD — TUPE ─────────────────────────────────────────────────

export async function findTupe(homeId) { return hrRepo.findTupe(homeId); }
export async function findTupeById(id, homeId) { return hrRepo.findTupeById(id, homeId); }
export async function createTupe(homeId, data) { return hrRepo.createTupe(homeId, data); }
export async function updateTupe(id, homeId, data) { return hrRepo.updateTupe(id, homeId, data); }

// ── Passthrough CRUD — Renewals ─────────────────────────────────────────────

export async function findRenewals(homeId, f) { return hrRepo.findRenewals(homeId, f); }
export async function findRenewalById(id, homeId) { return hrRepo.findRenewalById(id, homeId); }
export async function createRenewal(homeId, data) { return hrRepo.createRenewal(homeId, data); }
export async function updateRenewal(id, homeId, data) { return hrRepo.updateRenewal(id, homeId, data); }

// ── Passthrough CRUD — Case Notes ───────────────────────────────────────────

export async function findCaseNotes(caseType, caseId) { return hrRepo.findCaseNotes(caseType, caseId); }
export async function createCaseNote(homeId, caseType, caseId, data) { return hrRepo.createCaseNote(homeId, caseType, caseId, data); }

// ── Passthrough — Cross-cutting ─────────────────────────────────────────────

export async function getActiveWarnings(homeId) { return hrRepo.getActiveWarnings(homeId); }
export async function getHrStats(homeId) { return hrRepo.getHrStats(homeId); }

// ── File Attachments ────────────────────────────────────────────────────────
export async function findAttachments(caseType, caseId, homeId) { return hrRepo.findAttachments(caseType, caseId, homeId); }
export async function findAttachmentById(id, homeId) { return hrRepo.findAttachmentById(id, homeId); }
export async function createAttachment(homeId, caseType, caseId, data) { return hrRepo.createAttachment(homeId, caseType, caseId, data); }
export async function deleteAttachment(id, homeId) { return hrRepo.deleteAttachment(id, homeId); }

// ── Investigation Meetings ──────────────────────────────────────────────────
export async function findMeetings(caseType, caseId, homeId) { return hrRepo.findMeetings(caseType, caseId, homeId); }
export async function createMeeting(homeId, caseType, caseId, data) { return hrRepo.createMeeting(homeId, caseType, caseId, data); }
export async function updateMeeting(id, homeId, data) { return hrRepo.updateMeeting(id, homeId, data); }
