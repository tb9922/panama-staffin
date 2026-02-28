import { formatDate, parseDate, addDays } from './rotation.js';

/**
 * Returns the leave year boundaries that contain the given date.
 * @param {Date|string} date
 * @param {string} leaveYearStart - "MM-DD", e.g. "04-01"
 * @returns {{ start: Date, end: Date, startStr: string, endStr: string }}
 */
export function getLeaveYear(date, leaveYearStart) {
  // Use string comparison to avoid UTC/local timezone mixing.
  // parseDate() returns local-time Dates; Date.UTC() returns UTC — they are not comparable.
  const dateStr = typeof date === 'string' ? date : formatDate(date);
  const [mm, dd] = (leaveYearStart || '04-01').split('-').map(Number);
  const y = parseInt(dateStr.slice(0, 4), 10);
  const mmStr = String(mm).padStart(2, '0');
  const ddStr = String(dd).padStart(2, '0');

  const thisStartStr = `${y}-${mmStr}-${ddStr}`;
  const prevStartStr = `${y - 1}-${mmStr}-${ddStr}`;
  const nextStartStr = `${y + 1}-${mmStr}-${ddStr}`;

  if (dateStr >= thisStartStr) {
    // dateStr is in the leave year that starts thisStartStr
    const endStr = formatDate(addDays(parseDate(nextStartStr), -1));
    return {
      start: parseDate(thisStartStr),
      end: parseDate(endStr),
      startStr: thisStartStr,
      endStr,
    };
  } else {
    // dateStr is before thisStartStr — it's in the previous leave year
    const endStr = formatDate(addDays(parseDate(thisStartStr), -1));
    return {
      start: parseDate(prevStartStr),
      end: parseDate(endStr),
      startStr: prevStartStr,
      endStr,
    };
  }
}

/**
 * Count complete months from start to end (end may be before start → returns 0).
 * A month completes when the same day-of-month is reached in the next month.
 */
function monthsBetween(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  let months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  if (e.getDate() < s.getDate()) months--;
  return Math.max(0, months);
}

/**
 * Count AL overrides for a staff member within a leave year.
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
 * Calculate holiday accrual for a staff member as of a given date.
 *
 * @param {Object} staff        - staff record
 * @param {Object} config       - home config
 * @param {Object} overrides    - all overrides
 * @param {Date|string} asOfDate
 * @returns {{
 *   baseEntitlement: number,
 *   carryover: number,
 *   entitlement: number,
 *   accrued: number,
 *   used: number,
 *   remaining: number,
 *   yearRemaining: number,
 *   leaveYear: { start, end, startStr, endStr },
 *   isProRata: boolean,
 * }}
 */
export function calculateAccrual(staff, config, overrides, asOfDate) {
  const d = typeof asOfDate === 'string' ? parseDate(asOfDate) : new Date(asOfDate);
  const leaveYear = getLeaveYear(d, config.leave_year_start);

  const baseEntitlement = staff.al_entitlement != null ? staff.al_entitlement : (config.al_entitlement_days || 28);
  const carryover = staff.al_carryover || 0;
  const entitlement = baseEntitlement + carryover;

  // Effective start: later of leave year start or staff start_date
  const staffStart = staff.start_date ? parseDate(staff.start_date) : leaveYear.start;
  const effectiveStart = staffStart > leaveYear.start ? staffStart : leaveYear.start;
  const isProRata = staffStart > leaveYear.start;

  // If staff hasn't started yet, nothing accrued
  if (effectiveStart > d) {
    return {
      baseEntitlement, carryover, entitlement,
      accrued: carryover, used: 0, remaining: carryover,
      yearRemaining: entitlement, leaveYear, isProRata,
    };
  }

  // Total months in the pro-rata period (effective start → leave year end)
  const totalMonths = monthsBetween(effectiveStart, addDays(leaveYear.end, 1));
  // Months elapsed so far (effective start → asOfDate)
  const elapsedMonths = Math.min(monthsBetween(effectiveStart, d), totalMonths);

  // Pro-rata entitlement: fraction of 12-month year the staff member has/will work
  const yearFraction = totalMonths / 12;
  const proRataEntitlement = Math.round(baseEntitlement * yearFraction * 10) / 10;

  // Accrued: proportional progress through their entitlement period
  let accrued = totalMonths > 0
    ? Math.round((elapsedMonths / totalMonths) * proRataEntitlement * 10) / 10
    : proRataEntitlement;

  // Carryover is available from day 1
  accrued = Math.round((accrued + carryover) * 10) / 10;

  const used = countALInLeaveYear(staff.id, overrides, leaveYear);
  const remaining = Math.round((accrued - used) * 10) / 10;
  const effectiveEntitlement = Math.round((proRataEntitlement + carryover) * 10) / 10;
  const yearRemaining = effectiveEntitlement - used;

  return {
    baseEntitlement,
    carryover,
    entitlement: effectiveEntitlement,
    accrued,
    used,
    remaining,
    yearRemaining,
    leaveYear,
    isProRata,
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
