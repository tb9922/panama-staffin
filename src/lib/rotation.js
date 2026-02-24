// Panama 2-2-3 Rotation Logic — Aligned with Excel v8

const PANAMA_PATTERN = {
  A: [1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0],
  B: [0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1],
};

// All shift codes from Excel
export const ALL_SHIFTS = [
  'E', 'L', 'EL', 'N', 'OFF', 'AL', 'SICK', 'ADM', 'TRN', 'AVL',
  'OC-E', 'OC-L', 'OC-EL', 'OC-N',
  'AG-E', 'AG-L', 'AG-N',
  'BH-D', 'BH-N',
];

export const WORKING_SHIFTS = ['E', 'L', 'EL', 'N', 'OC-E', 'OC-L', 'OC-EL', 'OC-N', 'AG-E', 'AG-L', 'AG-N', 'BH-D', 'BH-N', 'ADM', 'TRN'];
export const EARLY_SHIFTS = ['E', 'EL', 'OC-E', 'OC-EL', 'AG-E', 'BH-D'];
export const LATE_SHIFTS = ['L', 'EL', 'OC-L', 'OC-EL', 'AG-L', 'BH-D'];
export const NIGHT_SHIFTS = ['N', 'OC-N', 'AG-N', 'BH-N'];
export const OT_SHIFTS = ['OC-E', 'OC-L', 'OC-EL', 'OC-N'];
export const AGENCY_SHIFTS = ['AG-E', 'AG-L', 'AG-N'];
export const BH_SHIFTS = ['BH-D', 'BH-N'];
export const DAY_SHIFTS = ['E', 'L', 'EL', 'OC-E', 'OC-L', 'OC-EL', 'AG-E', 'AG-L', 'BH-D', 'ADM', 'TRN'];

export const CARE_ROLES = ['Senior Carer', 'Carer', 'Team Lead', 'Night Senior', 'Night Carer', 'Float Senior', 'Float Carer'];

export const SHIFT_COLORS = {
  E: 'bg-blue-100 text-blue-800',
  L: 'bg-indigo-100 text-indigo-800',
  EL: 'bg-green-100 text-green-800',
  N: 'bg-purple-100 text-purple-800',
  OFF: 'bg-gray-100 text-gray-400',
  AL: 'bg-yellow-100 text-yellow-800',
  SICK: 'bg-red-100 text-red-800',
  ADM: 'bg-cyan-100 text-cyan-800',
  TRN: 'bg-teal-100 text-teal-800',
  AVL: 'bg-emerald-100 text-emerald-800',
  'OC-E': 'bg-orange-100 text-orange-800',
  'OC-L': 'bg-orange-100 text-orange-800',
  'OC-EL': 'bg-orange-100 text-orange-800',
  'OC-N': 'bg-orange-100 text-orange-800',
  'AG-E': 'bg-red-200 text-red-900',
  'AG-L': 'bg-red-200 text-red-900',
  'AG-N': 'bg-red-200 text-red-900',
  'BH-D': 'bg-pink-100 text-pink-800',
  'BH-N': 'bg-pink-100 text-pink-800',
};

// Date utilities
export function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
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
  d.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((d - start) / (1000 * 60 * 60 * 24));
  return ((diffDays % 14) + 14) % 14;
}

export function getTeamBase(team) {
  if (team === 'Float') return null;
  const match = team.match(/[AB]$/);
  return match ? match[0] : null;
}

export function getScheduledShift(staff, cycleDay) {
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
  return { shift: getScheduledShift(staff, cycleDay) };
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
  const map = {
    E: config.shifts.E.hours,
    L: config.shifts.L.hours,
    EL: config.shifts.EL.hours,
    N: config.shifts.N.hours,
    'OC-E': config.shifts.E.hours,
    'OC-L': config.shifts.L.hours,
    'OC-EL': config.shifts.EL.hours,
    'OC-N': config.shifts.N.hours,
    'AG-E': config.shifts.E.hours,
    'AG-L': config.shifts.L.hours,
    'AG-N': config.shifts.N.hours,
    'BH-D': config.shifts.EL.hours,
    'BH-N': config.shifts.N.hours,
    ADM: config.shifts.EL.hours,
    TRN: config.shifts.EL.hours,
  };
  return map[shift] || 0;
}

// Get 28-day cycle dates (two Panama cycles)
export function getCycleDates(cycleStartDate, date, days = 28) {
  const start = parseDate(cycleStartDate);
  const current = new Date(date);
  current.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((current - start) / (1000 * 60 * 60 * 24));
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
  for (const s of activeStaff) {
    const actual = getActualShift(s, date, overrides, config.cycle_start_date);
    const cycleDay = getCycleDay(date, config.cycle_start_date);
    const scheduled = getScheduledShift(s, cycleDay);
    result.push({
      ...s,
      shift: actual.shift,
      scheduledShift: scheduled,
      reason: actual.reason || null,
      source: actual.source || 'scheduled',
      isOverride: actual.shift !== scheduled,
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
  const numWeeks = Math.max(1, Math.ceil(dates.length / 7));
  const weekHours = new Array(numWeeks).fill(0);

  dates.forEach((date, i) => {
    const actual = getActualShift(staff, date, overrides, config.cycle_start_date);
    const shift = actual.shift;
    const hours = getShiftHours(shift, config);
    if (isWorkingShift(shift)) {
      totalHours += hours;
      const weekIdx = Math.floor(i / 7);
      if (weekIdx < numWeeks) weekHours[weekIdx] += hours;
    }
    if (isOTShift(shift)) otHours += hours;
    if (isBHShift(shift)) bhHours += hours;
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
    totalHours, grossPay, otHours, otPay, bhHours, bhPay,
    weekHours, avgWeeklyHours, wtrStatus, shortWeek,
    totalPay: grossPay + otPay + bhPay,
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
