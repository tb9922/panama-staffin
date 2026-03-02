// Panama 2-2-3 Rotation Logic — Aligned with Excel v8

const PANAMA_PATTERN = {
  A: [1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0],
  B: [0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1],
};

// All shift codes from Excel
export const ALL_SHIFTS = [
  'E', 'L', 'EL', 'N', 'OFF', 'AL', 'SICK', 'ADM', 'TRN', 'AVL',
  'OC-E', 'OC-L', 'OC-EL', 'OC-N',
  'AG-E', 'AG-L', 'AG-EL', 'AG-N',
  'BH-D', 'BH-N',
];

export const WORKING_SHIFTS = ['E', 'L', 'EL', 'N', 'OC-E', 'OC-L', 'OC-EL', 'OC-N', 'AG-E', 'AG-L', 'AG-EL', 'AG-N', 'BH-D', 'BH-N', 'ADM', 'TRN'];
export const EARLY_SHIFTS = ['E', 'EL', 'OC-E', 'OC-EL', 'AG-E', 'AG-EL', 'BH-D'];
export const LATE_SHIFTS = ['L', 'EL', 'OC-L', 'OC-EL', 'AG-L', 'AG-EL', 'BH-D'];
export const NIGHT_SHIFTS = ['N', 'OC-N', 'AG-N', 'BH-N'];
export const OT_SHIFTS = ['OC-E', 'OC-L', 'OC-EL', 'OC-N'];
export const AGENCY_SHIFTS = ['AG-E', 'AG-L', 'AG-EL', 'AG-N'];
export const BH_SHIFTS = ['BH-D', 'BH-N'];
export const DAY_SHIFTS = ['E', 'L', 'EL', 'OC-E', 'OC-L', 'OC-EL', 'AG-E', 'AG-L', 'AG-EL', 'BH-D', 'ADM', 'TRN'];

export const CARE_ROLES = ['Senior Carer', 'Carer', 'Team Lead', 'Night Senior', 'Night Carer', 'Float Senior', 'Float Carer'];

export const SHIFT_COLORS = {
  E: 'bg-blue-100 text-blue-700 border border-blue-200',
  L: 'bg-indigo-100 text-indigo-700 border border-indigo-200',
  EL: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  N: 'bg-purple-100 text-purple-700 border border-purple-200',
  OFF: 'bg-gray-100 text-gray-400',
  AL: 'bg-amber-100 text-amber-700 border border-amber-200',
  SICK: 'bg-red-100 text-red-700 border border-red-200',
  ADM: 'bg-cyan-100 text-cyan-700 border border-cyan-200',
  TRN: 'bg-teal-100 text-teal-700 border border-teal-200',
  AVL: 'bg-emerald-50 text-emerald-600 border border-emerald-200',
  'OC-E': 'bg-orange-100 text-orange-700 border border-orange-200',
  'OC-L': 'bg-orange-100 text-orange-700 border border-orange-200',
  'OC-EL': 'bg-orange-100 text-orange-700 border border-orange-200',
  'OC-N': 'bg-orange-100 text-orange-700 border border-orange-200',
  'AG-E': 'bg-red-200 text-red-800 border border-red-300',
  'AG-L': 'bg-red-200 text-red-800 border border-red-300',
  'AG-EL': 'bg-red-200 text-red-800 border border-red-300',
  'AG-N': 'bg-red-200 text-red-800 border border-red-300',
  'BH-D': 'bg-pink-100 text-pink-700 border border-pink-200',
  'BH-N': 'bg-pink-100 text-pink-700 border border-pink-200',
};

// Date utilities — use local-time getters so both local-midnight and UTC-midnight
// Date objects resolve to the correct calendar day in UK timezones (GMT/BST).
export function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Cycle calculations
export function getCycleDay(date, cycleStartDate) {
  const d = new Date(date);
  const start = new Date(cycleStartDate);
  // Use UTC to avoid DST off-by-one (BST spring-forward shifts midnight local → 23:00 UTC)
  const dUTC = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const startUTC = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const diffDays = Math.round((dUTC - startUTC) / (1000 * 60 * 60 * 24));
  return ((diffDays % 14) + 14) % 14;
}

export function getTeamBase(team) {
  if (team === 'Float') return null;
  const match = team.match(/[AB]$/);
  return match ? match[0] : null;
}

export function getScheduledShift(staff, cycleDay, date) {
  // If date is provided and staff has a start_date, don't schedule before they start
  if (date && staff.start_date) {
    const checkDate = typeof date === 'string' ? date : formatDate(date);
    if (checkDate < staff.start_date) return 'OFF';
  }
  if (staff.team === 'Float') return 'AVL';
  const teamBase = getTeamBase(staff.team);
  if (!teamBase) return 'OFF';
  const pattern = PANAMA_PATTERN[teamBase];
  if (!pattern) return 'OFF';
  const isOn = pattern[cycleDay] === 1;
  if (!isOn) return 'OFF';
  // Night teams
  if (staff.team.startsWith('Night')) return 'N';
  // Day teams — use preference (E, L, or EL)
  return staff.pref || staff.default_shift || 'EL';
}

export function getActualShift(staff, date, overrides, cycleStartDate) {
  const dateKey = formatDate(date);
  if (overrides[dateKey]?.[staff.id]) {
    return overrides[dateKey][staff.id];
  }
  const cycleDay = getCycleDay(date, cycleStartDate);
  return { shift: getScheduledShift(staff, cycleDay, date) };
}

// Shift classification
export function isWorkingShift(shift) {
  return WORKING_SHIFTS.includes(shift);
}

export function isCareRole(role) {
  return CARE_ROLES.includes(role);
}

export function isEarlyShift(shift) {
  return EARLY_SHIFTS.includes(shift);
}

export function isLateShift(shift) {
  return LATE_SHIFTS.includes(shift);
}

export function isNightShift(shift) {
  return NIGHT_SHIFTS.includes(shift);
}

export function isDayShift(shift) {
  return DAY_SHIFTS.includes(shift);
}

export function isOTShift(shift) {
  return OT_SHIFTS.includes(shift);
}

export function isAgencyShift(shift) {
  return AGENCY_SHIFTS.includes(shift);
}

export function isBHShift(shift) {
  return BH_SHIFTS.includes(shift);
}

// Get hours for a shift code from config
export function getShiftHours(shift, config) {
  const s = config?.shifts;
  if (!s) return 0;
  const map = {
    E: s.E?.hours, L: s.L?.hours, EL: s.EL?.hours, N: s.N?.hours,
    'OC-E': s.E?.hours, 'OC-L': s.L?.hours, 'OC-EL': s.EL?.hours, 'OC-N': s.N?.hours,
    'AG-E': s.E?.hours, 'AG-L': s.L?.hours, 'AG-EL': s.EL?.hours, 'AG-N': s.N?.hours,
    'BH-D': s.EL?.hours, 'BH-N': s.N?.hours,
    ADM: s.ADM?.hours ?? s.EL?.hours, TRN: s.TRN?.hours ?? s.EL?.hours,
  };
  return map[shift] || 0;
}

// Get 28-day cycle dates (two Panama cycles)
export function getCycleDates(cycleStartDate, date, days = 28) {
  const start = parseDate(cycleStartDate);
  const current = new Date(date);
  // Use UTC to avoid DST off-by-one
  const currentUTC = Date.UTC(current.getFullYear(), current.getMonth(), current.getDate());
  const startUTC = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const diffDays = Math.round((currentUTC - startUTC) / (1000 * 60 * 60 * 24));
  const cycleNumber = Math.floor(diffDays / days);
  const cycleStart = addDays(start, cycleNumber * days);
  const dates = [];
  for (let i = 0; i < days; i++) {
    dates.push(addDays(cycleStart, i));
  }
  return dates;
}

// Build staff for a given day with actual shifts
export function getStaffForDay(staff, date, overrides, config) {
  const result = [];
  const activeStaff = staff.filter(s => s.active !== false);
  const staffIds = new Set(activeStaff.map(s => s.id));
  const bankHol = isBankHoliday(date, config);
  for (const s of activeStaff) {
    const actual = getActualShift(s, date, overrides, config.cycle_start_date);
    const cycleDay = getCycleDay(date, config.cycle_start_date);
    const scheduled = getScheduledShift(s, cycleDay, date);
    let shift = actual.shift;
    // If staff hasn't started yet, force OFF regardless of overrides
    if (scheduled === 'OFF' && s.start_date && formatDate(date) < s.start_date) {
      shift = 'OFF';
    }
    // Auto-upgrade to BH-D/BH-N on bank holidays (unless already BH, agency, OT, or non-working)
    if (bankHol && isWorkingShift(shift) && !isBHShift(shift) && !isAgencyShift(shift) && !isOTShift(shift)) {
      shift = NIGHT_SHIFTS.includes(shift) ? 'BH-N' : 'BH-D';
    }
    result.push({
      ...s,
      shift,
      scheduledShift: scheduled,
      reason: actual.reason || null,
      source: actual.source || 'scheduled',
      sleep_in: actual.sleep_in || false,
      isOverride: shift !== scheduled,
      replaces_staff_id: actual.replaces_staff_id || null,
      override_hours: actual.override_hours ?? null,
    });
  }

  // Include agency bookings that aren't in the staff list (virtual agency staff)
  const dateKey = formatDate(date);
  const dayOverrides = overrides[dateKey];
  if (dayOverrides) {
    for (const [id, override] of Object.entries(dayOverrides)) {
      if (staffIds.has(id)) continue; // already processed
      if (!isAgencyShift(override.shift)) continue; // only agency virtual entries
      const isNight = override.shift === 'AG-N';
      result.push({
        id,
        name: `Agency (${override.shift})`,
        role: 'Carer',
        team: 'Agency',
        pref: 'ANY',
        skill: 0.5,
        hourly_rate: isNight ? config.agency_rate_night : config.agency_rate_day,
        active: true,
        wtr_opt_out: true,
        shift: override.shift,
        scheduledShift: 'OFF',
        reason: override.reason || 'Agency',
        source: override.source || 'agency',
        isOverride: true,
        isVirtualAgency: true,
        replaces_staff_id: override.replaces_staff_id || null,
      });
    }
  }

  return result;
}

// Calculate hours per staff for a period (variable length — works for 28-day cycles or calendar months)
export function calculateStaffPeriodHours(staff, dates, overrides, config) {
  let totalHours = 0;
  let otHours = 0;
  let bhHours = 0;
  let alDays = 0;
  let alHours = 0;
  let alPay = 0;
  const numWeeks = Math.max(1, Math.ceil(dates.length / 7));
  const weekHours = new Array(numWeeks).fill(0);

  dates.forEach((date, i) => {
    const actual = getActualShift(staff, date, overrides, config.cycle_start_date);
    const shift = actual.shift;
    let hours = getShiftHours(shift, config);
    // TRN/ADM: on-shift = full scheduled hours, off-day = override_hours or config
    if (shift === 'TRN' || shift === 'ADM') {
      const cycleDay = getCycleDay(date, config.cycle_start_date);
      const scheduled = getScheduledShift(staff, cycleDay, date);
      if (isWorkingShift(scheduled)) {
        hours = getShiftHours(scheduled, config);
      } else {
        hours = actual.override_hours ?? getShiftHours(shift, config);
      }
    }
    // Agency shifts on real staff = agency is working, not this staff member
    if (isWorkingShift(shift) && !isAgencyShift(shift)) {
      totalHours += hours;
      const weekIdx = Math.floor(i / 7);
      if (weekIdx < numWeeks) weekHours[weekIdx] += hours;
    }
    if (isOTShift(shift)) otHours += hours;
    if (isBHShift(shift)) bhHours += hours;
    // AL tracking: use stored al_hours or derive from scheduled shift
    if (shift === 'AL') {
      alDays += 1;
      const dateKey = formatDate(date);
      const stored = overrides[dateKey]?.[staff.id]?.al_hours;
      const hrs = stored != null ? parseFloat(stored) : getALDeductionHours(staff, dateKey, config);
      alHours += hrs;
      alPay += hrs * staff.hourly_rate;
    }
  });

  const grossPay = totalHours * staff.hourly_rate;
  const otPay = otHours * config.ot_premium;
  const bhPay = bhHours * staff.hourly_rate * (config.bh_premium_multiplier - 1);
  const weeks = dates.length / 7;
  const avgWeeklyHours = weeks > 0 ? totalHours / weeks : 0;

  let wtrStatus = 'OK';
  if (avgWeeklyHours > 48) wtrStatus = 'BREACH';
  else if (avgWeeklyHours > 44) wtrStatus = 'HIGH';

  const shortWeek = weekHours[0] < weekHours[1] ? 'Short W1' :
                    weekHours[1] < weekHours[0] ? 'Short W2' : 'Balanced';

  return {
    totalHours, grossPay, otHours, otPay, bhHours, bhPay, alDays, alHours, alPay,
    weekHours, avgWeeklyHours, wtrStatus, shortWeek,
    totalPay: grossPay + otPay + bhPay + alPay,
  };
}

// WTR check for a single staff member
export function checkWTR(staff, dates, overrides, config) {
  const stats = calculateStaffPeriodHours(staff, dates, overrides, config);
  return {
    avgWeekly: stats.avgWeeklyHours,
    status: stats.wtrStatus,
    optOut: staff.wtr_opt_out || false,
    safe: stats.wtrStatus === 'OK' || staff.wtr_opt_out,
  };
}

// Check if a date is a bank holiday
export function isBankHoliday(date, config) {
  const dateStr = formatDate(date);
  return config.bank_holidays?.some(bh => bh.date === dateStr) || false;
}

// Get bank holiday info
export function getBankHoliday(date, config) {
  const dateStr = formatDate(date);
  return config.bank_holidays?.find(bh => bh.date === dateStr) || null;
}

// ── Hours-based Annual Leave constants and helpers ─────────────────────────

export const STATUTORY_WEEKS = 5.6;
export const ASSUMED_WORKING_DAYS_PER_WEEK = 5;

/**
 * Returns the leave year boundaries that contain the given date.
 * Moved here from src/lib/accrual.js so backend can use it too.
 * @param {Date|string} date
 * @param {string} leaveYearStart - "MM-DD", e.g. "04-01"
 * @returns {{ start: Date, end: Date, startStr: string, endStr: string }}
 */
export function getLeaveYear(date, leaveYearStart) {
  const dateStr = typeof date === 'string' ? date : formatDate(date);
  const [mm, dd] = (leaveYearStart || '04-01').split('-').map(Number);
  const y = parseInt(dateStr.slice(0, 4), 10);
  const mmStr = String(mm).padStart(2, '0');
  const ddStr = String(dd).padStart(2, '0');

  const thisStartStr = `${y}-${mmStr}-${ddStr}`;
  const prevStartStr = `${y - 1}-${mmStr}-${ddStr}`;
  const nextStartStr = `${y + 1}-${mmStr}-${ddStr}`;

  if (dateStr >= thisStartStr) {
    const endStr = formatDate(addDays(parseDate(nextStartStr), -1));
    return { start: parseDate(thisStartStr), end: parseDate(endStr), startStr: thisStartStr, endStr };
  } else {
    const endStr = formatDate(addDays(parseDate(thisStartStr), -1));
    return { start: parseDate(prevStartStr), end: parseDate(endStr), startStr: prevStartStr, endStr };
  }
}

/**
 * Get AL deduction hours for one booking on a given date.
 * Uses scheduled shift to determine hours. AVL (Float) → contract_hours / 5.
 * OFF → 0 (but booking should be blocked by callers).
 * @param {object} staff
 * @param {string} dateStr "YYYY-MM-DD"
 * @param {object} config
 * @returns {number} hours to deduct
 */
export function getALDeductionHours(staff, dateStr, config) {
  const contractHours = parseFloat(staff.contract_hours) || 0;
  const cycleDay = getCycleDay(dateStr, config.cycle_start_date);
  const scheduled = getScheduledShift(staff, cycleDay, dateStr);

  if (scheduled === 'OFF') return 0;
  if (scheduled === 'AVL') {
    // Float staff: deduct contract_hours / working_days_per_week
    return contractHours > 0
      ? Math.round((contractHours / ASSUMED_WORKING_DAYS_PER_WEEK) * 10) / 10
      : 0; // no contract hours = cannot calculate deduction
  }
  // Normal shift — use config shift hours
  const hrs = getShiftHours(scheduled, config);
  return hrs > 0 ? hrs : 0; // missing config = cannot calculate deduction
}

// Count AL on a given date
export function countALOnDate(date, overrides) {
  const dateKey = formatDate(date);
  if (!overrides[dateKey]) return 0;
  return Object.values(overrides[dateKey]).filter(o => o.shift === 'AL').length;
}

// Get staff status label for daily view
export function getStaffStatus(shift) {
  if (['E', 'L', 'EL'].includes(shift)) return 'WORKING';
  if (shift === 'N') return 'WORKING';
  if (shift === 'OFF') return 'OFF';
  if (shift === 'AVL') return 'FLOAT';
  if (AGENCY_SHIFTS.includes(shift)) return 'AGENCY';
  if (OT_SHIFTS.includes(shift)) return 'ON-CALL';
  if (shift === 'SICK') return 'SICK';
  if (shift === 'AL') return 'AL';
  if (BH_SHIFTS.includes(shift)) return 'WORKING';
  if (['ADM', 'TRN'].includes(shift)) return 'WORKING';
  return shift;
}
