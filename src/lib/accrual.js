// Hours-based Annual Leave accrual engine.
// UK law: entitlement = 5.6 × contracted weekly hours.
// getLeaveYear is canonical in shared/rotation.js — re-exported here for consumers.
export { getLeaveYear, STATUTORY_WEEKS } from './rotation.js';
import { parseDate, addDays, getLeaveYear, getALDeductionHours, STATUTORY_WEEKS } from './rotation.js';

/**
 * Count elapsed months including a proportional partial month.
 * Preserves mid-month starters instead of dropping the final partial month.
 */
function monthsBetween(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  if (e <= s) return 0;

  const buildAnchor = (monthsOffset) => new Date(Date.UTC(
    s.getUTCFullYear(),
    s.getUTCMonth() + monthsOffset,
    Math.min(
      s.getUTCDate(),
      new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + monthsOffset + 1, 0)).getUTCDate(),
    ),
  ));

  let wholeMonths = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
  let anchor = buildAnchor(wholeMonths);
  if (anchor > e) {
    wholeMonths -= 1;
    anchor = buildAnchor(wholeMonths);
  }
  const nextAnchor = buildAnchor(wholeMonths + 1);
  const partialMonth = nextAnchor > anchor
    ? (e - anchor) / (nextAnchor - anchor)
    : 0;

  return Math.max(0, wholeMonths + Math.max(0, Math.min(1, partialMonth)));
}

/**
 * Count AL overrides for a staff member within a leave year (legacy day-count).
 * Kept for backward compatibility — prefer sumALHoursInLeaveYear.
 */
export function countALInLeaveYear(staffId, overrides, leaveYear) {
  let count = 0;
  for (const [dateKey, dayOverrides] of Object.entries(overrides)) {
    if (dateKey < leaveYear.startStr || dateKey > leaveYear.endStr) continue;
    if (dayOverrides[staffId]?.shift === 'AL') count++;
  }
  return count;
}

/**
 * Sum AL hours used by a staff member within a leave year.
 * Uses stored al_hours if present, otherwise derives from scheduled shift.
 */
export function sumALHoursInLeaveYear(staff, overrides, leaveYear, config) {
  let hours = 0;
  for (const [dateKey, dayOverrides] of Object.entries(overrides)) {
    if (dateKey < leaveYear.startStr || dateKey > leaveYear.endStr) continue;
    const ov = dayOverrides[staff.id];
    if (ov?.shift !== 'AL') continue;
    if (ov.al_hours != null) {
      hours += parseFloat(ov.al_hours);
    } else {
      // Legacy booking — derive from scheduled shift
      hours += getALDeductionHours(staff, dateKey, config);
    }
  }
  return Math.round(hours * 10) / 10;
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Calculate holiday accrual for a staff member as of a given date.
 * All values are in HOURS (not days).
 *
 * @param {Object} staff        - staff record (must have contract_hours)
 * @param {Object} config       - home config
 * @param {Object} overrides    - all overrides
 * @param {Date|string} asOfDate
 * @returns {object} hours-based accrual result
 */
export function calculateAccrual(staff, config, overrides, asOfDate) {
  const d = typeof asOfDate === 'string' ? parseDate(asOfDate) : new Date(asOfDate);
  const leaveYear = getLeaveYear(d, config.leave_year_start);

  const contractHours = parseFloat(staff.contract_hours) || 0;
  const missingContractHours = !contractHours || contractHours <= 0;

  // Annual entitlement in hours: staff override or statutory formula
  const annualEntitlementHours = staff.al_entitlement != null
    ? parseFloat(staff.al_entitlement)
    : (missingContractHours ? 0 : round1(STATUTORY_WEEKS * contractHours));

  const carryoverHours = parseFloat(staff.al_carryover) || 0;
  const totalEntitlementHours = round1(annualEntitlementHours + carryoverHours);

  // Effective start: later of leave year start or staff start_date
  const staffStart = staff.start_date ? parseDate(staff.start_date) : leaveYear.start;
  const effectiveStart = staffStart > leaveYear.start ? staffStart : leaveYear.start;
  const isProRata = staffStart > leaveYear.start;

  // If staff hasn't started yet, nothing accrued
  if (effectiveStart > d) {
    const usedHours = sumALHoursInLeaveYear(staff, overrides, leaveYear, config);
    // Pro-rata based on their actual working portion of the leave year
    const futureMonths = monthsBetween(effectiveStart, addDays(leaveYear.end, 1));
    const futureProRata = round1(annualEntitlementHours * (futureMonths / 12));
    return {
      contractHours, annualEntitlementHours, carryoverHours, totalEntitlementHours,
      proRataEntitlementHours: futureProRata,
      accruedHours: carryoverHours, usedHours, remainingHours: round1(carryoverHours - usedHours),
      yearRemainingHours: round1(totalEntitlementHours - usedHours),
      leaveYear, isProRata, missingContractHours,
      entitlementWeeks: contractHours > 0 ? round1(annualEntitlementHours / contractHours) : 0,
      usedWeeks: contractHours > 0 ? round1(usedHours / contractHours) : 0,
      remainingWeeks: contractHours > 0 ? round1((carryoverHours - usedHours) / contractHours) : 0,
    };
  }

  // Total months in the pro-rata period (effective start → leave year end)
  const totalMonths = monthsBetween(effectiveStart, addDays(leaveYear.end, 1));
  // Months elapsed so far (effective start → asOfDate)
  const elapsedMonths = Math.min(monthsBetween(effectiveStart, d), totalMonths);

  // Pro-rata entitlement: fraction of 12-month year
  const yearFraction = totalMonths / 12;
  const proRataEntitlementHours = round1(annualEntitlementHours * yearFraction);

  // Accrued: proportional progress through their entitlement period
  let accruedHours = totalMonths > 0
    ? round1((elapsedMonths / totalMonths) * proRataEntitlementHours)
    : proRataEntitlementHours;

  // Carryover is available from day 1
  accruedHours = round1(accruedHours + carryoverHours);

  const usedHours = sumALHoursInLeaveYear(staff, overrides, leaveYear, config);
  const remainingHours = round1(accruedHours - usedHours);
  const effectiveEntitlement = round1(proRataEntitlementHours + carryoverHours);
  const yearRemainingHours = round1(effectiveEntitlement - usedHours);

  return {
    contractHours,
    annualEntitlementHours,
    carryoverHours,
    totalEntitlementHours: effectiveEntitlement,
    proRataEntitlementHours,
    accruedHours,
    usedHours,
    remainingHours,
    yearRemainingHours,
    leaveYear,
    isProRata,
    missingContractHours,
    entitlementWeeks: contractHours > 0 ? round1(annualEntitlementHours / contractHours) : 0,
    usedWeeks: contractHours > 0 ? round1(usedHours / contractHours) : 0,
    remainingWeeks: contractHours > 0 ? round1(remainingHours / contractHours) : 0,
  };
}

/**
 * Calculate accrual for all active staff members.
 * @returns {Map<staffId, accrualResult>}
 */
export function getAccrualSummary(activeStaff, config, overrides, asOfDate) {
  const map = new Map();
  for (const s of activeStaff) {
    map.set(s.id, calculateAccrual(s, config, overrides, asOfDate));
  }
  return map;
}
