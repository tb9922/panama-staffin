// Panama 2-2-3 Rotation Logic — Aligned with Excel v8

const PANAMA_PATTERN = {
  A: [1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0],
  B: [0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1],
};

// Exposed alias so callers don't import the private const.
export const DEFAULT_PATTERN = PANAMA_PATTERN;

// Cycle length is hardcoded to 14 for now. Centralised as a helper so a future
// non-14-day cycle (7-day, 28-day DuPont, etc.) is a single-site change.
export const CYCLE_LENGTH = 14;
export function resolveCycleLength() {
  return CYCLE_LENGTH;
}

// Library of 14-day two-team patterns. A and B are always complementary in the
// presets (B[i] = 1 - A[i]) so working days alternate — the Panama invariant.
// Custom editors can break complementarity if the manager really wants, but
// presets always present a clean A/B flip.
export const ROTATION_PRESETS = [
  {
    id: 'panama-223',
    name: 'Panama 2-2-3',
    description: '2 on, 2 off, 3 on alternating — the UK care-home default.',
    teams: {
      A: [1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0],
      B: [0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1],
    },
  },
  {
    id: 'pitman-fixed',
    name: 'Pitman Fixed',
    description: '2 on, 2 off, 3 on / 2 on, 2 off, 3 on — fixed weekends per team.',
    teams: {
      A: [1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1],
      B: [0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0],
    },
  },
  {
    id: 'continental-222',
    name: 'Continental 2-2-2',
    description: 'Steady 2 on / 2 off — low variance, lots of handovers.',
    teams: {
      A: [1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1],
      B: [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0],
    },
  },
  {
    id: '4on-4off',
    name: '4-on / 4-off',
    description: 'Long rest blocks, fewer transitions. Popular in acute nursing.',
    teams: {
      A: [1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0],
      B: [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1],
    },
  },
  {
    id: 'alt-weeks',
    name: 'Alternating Weeks',
    description: '7 on, 7 off. Simple but intense — used occasionally for specialist cover.',
    teams: {
      A: [1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
      B: [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1],
    },
  },
];

function isDateOnlyString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Returns the active teams pattern for a config — the configured one if present
// and valid, otherwise the Panama default. Never throws; bad config silently
// falls back so a corrupt config field can't take down scheduling.
export function resolvePattern(config) {
  const teams = config?.rotation_pattern?.teams;
  if (teams && isValidTeamsShape(teams)) return teams;
  return DEFAULT_PATTERN;
}

export function isNightTeam(team) {
  return typeof team === 'string' && team.startsWith('Night');
}

export function resolveRotationScopeForStaff(staff) {
  return isNightTeam(staff?.team) ? 'night' : 'day';
}

export function resolvePatternForScope(config, scope = 'day') {
  if (scope === 'night') {
    const nightTeams = config?.rotation_pattern_night?.teams;
    if (nightTeams && isValidTeamsShape(nightTeams)) return nightTeams;
  }
  return resolvePattern(config);
}

export function resolvePatternForStaff(config, staff) {
  return resolvePatternForScope(config, resolveRotationScopeForStaff(staff));
}

export function resolveCycleStartDateForScope(config, scope = 'day', fallbackCycleStartDate = null) {
  if (scope === 'night' && isDateOnlyString(config?.cycle_start_date_night)) {
    return config.cycle_start_date_night;
  }
  if (isDateOnlyString(config?.cycle_start_date)) {
    return config.cycle_start_date;
  }
  if (isDateOnlyString(fallbackCycleStartDate)) {
    return fallbackCycleStartDate;
  }
  return null;
}

export function resolveCycleStartDateForStaff(config, staff, fallbackCycleStartDate = null) {
  return resolveCycleStartDateForScope(config, resolveRotationScopeForStaff(staff), fallbackCycleStartDate);
}

export function resolveCycleDayForStaff(staff, date, config = null, fallbackCycleStartDate = null) {
  const cycleStartDate = resolveCycleStartDateForStaff(config, staff, fallbackCycleStartDate)
    || formatDate(date);
  return getCycleDay(date, cycleStartDate);
}

export function isValidTeamsShape(teams) {
  if (!teams || typeof teams !== 'object') return false;
  const { A, B } = teams;
  if (!Array.isArray(A) || !Array.isArray(B)) return false;
  if (A.length !== CYCLE_LENGTH || B.length !== CYCLE_LENGTH) return false;
  return A.every(v => v === 0 || v === 1) && B.every(v => v === 0 || v === 1);
}

// All shift codes from Excel
export const ALL_SHIFTS = [
  'E', 'L', 'EL', 'N', 'OFF', 'AL', 'SICK', 'NS', 'ADM', 'TRN', 'AVL',
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
  NS: 'bg-pink-100 text-pink-700 border border-pink-200',
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

// Date utilities — all use UTC to avoid timezone-dependent results.
// parseDate creates UTC midnight, addDays uses setUTCDate, formatDate uses getUTC*.
export function formatDate(date) {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// Cycle calculations
export function getCycleDay(date, cycleStartDate) {
  const d = new Date(date);
  const start = new Date(cycleStartDate);
  // Use UTC to avoid DST off-by-one (BST spring-forward shifts midnight local → 23:00 UTC)
  const dUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const startUTC = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const diffDays = Math.round((dUTC - startUTC) / (1000 * 60 * 60 * 24));
  return ((diffDays % CYCLE_LENGTH) + CYCLE_LENGTH) % CYCLE_LENGTH;
}

export function getTeamBase(team) {
  if (!team || team === 'Float') return null;
  const match = team.match(/[AB]$/);
  return match ? match[0] : null;
}

export function getScheduledShift(staff, cycleDay, date, config = null) {
  // If date is provided and staff has a start_date, don't schedule before they start
  if (date && staff.start_date) {
    const checkDate = typeof date === 'string' ? date : formatDate(date);
    if (checkDate < staff.start_date) return 'OFF';
  }
  if (staff.team === 'Float') return 'AVL';
  const teamBase = getTeamBase(staff.team);
  if (!teamBase) return 'OFF';
  // Resolve the active pattern from config; falls back to Panama 2-2-3 if
  // config is missing or the rotation_pattern is malformed. Never throws.
  const teams = resolvePatternForStaff(config, staff);
  const effectiveCycleDay = date && config
    ? resolveCycleDayForStaff(staff, date, config)
    : cycleDay;
  const pattern = teams[teamBase];
  if (!pattern) return 'OFF';
  const isOn = pattern[effectiveCycleDay] === 1;
  if (!isOn) return 'OFF';
  // Night teams
  if (isNightTeam(staff.team)) return 'N';
  // Day teams — use preference (E, L, or EL)
  return staff.pref || staff.default_shift || 'EL';
}

export function getActualShift(staff, date, overrides, cycleStartDate, config = null) {
  const dateKey = formatDate(date);
  if (overrides[dateKey]?.[staff.id]) {
    return overrides[dateKey][staff.id];
  }
  const cycleDay = resolveCycleDayForStaff(staff, date, config, cycleStartDate);
  return { shift: getScheduledShift(staff, cycleDay, date, config) };
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
  const currentUTC = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
  const startUTC = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
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
    const actual = getActualShift(s, date, overrides, config.cycle_start_date, config);
    const cycleDay = resolveCycleDayForStaff(s, date, config, config.cycle_start_date);
    const scheduled = getScheduledShift(s, cycleDay, date, config);
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
      al_hours: actual.al_hours ?? null,
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
    const actual = getActualShift(staff, date, overrides, config.cycle_start_date, config);
    const shift = actual.shift;
    let hours = getShiftHours(shift, config);
    // TRN/ADM: on-shift = full scheduled hours, off-day = override_hours or config
    if (shift === 'TRN' || shift === 'ADM') {
      const cycleDay = resolveCycleDayForStaff(staff, date, config, config.cycle_start_date);
      const scheduled = getScheduledShift(staff, cycleDay, date, config);
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
      alPay += hrs * (staff.hourly_rate || 0);
    }
  });

  const rate = staff.hourly_rate || 0;
  const grossPay = totalHours * rate;
  const otPay = otHours * config.ot_premium;
  const bhPay = bhHours * rate * (config.bh_premium_multiplier - 1);
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
    // paidHours = worked hours + AL hours. AL is paid, so it belongs in any user-facing
    // "hours this period" display. totalHours stays worked-only so WTR (48h/week) remains
    // correct — AL must not count toward the WTR limit.
    paidHours: totalHours + alHours,
  };
}

// ── WTR-aware OT limiter ────────────────────────────────────────────────────
//
// checkWTRImpact projects what a staff member's weekly worked hours WOULD be if
// we added the proposed shift, against the calendar week (Mon–Sun) containing
// the target date. WTR 1998 caps working time at 48h/week averaged over 17
// weeks; a weekly-rolling enforcement is the industry-standard conservative
// approximation used by care-home rostering products.
//
// Lives in shared/ so server (routes/scheduling.js) and client (DailyStatusModal)
// run identical logic — no chance of client-side bypass.
//
// Returns:
//   { ok, warn, projectedHours, message }
//   - ok:false  → block (client disables button, server returns 400)
//   - ok:true + warn:true  → require manager confirmation
//   - ok:true + warn:false → silent allow
//
// Opted-out staff (staff.wtr_opt_out === true) are always allowed. Non-working
// proposed shifts (OFF, AL, SICK, NS) skip the check — WTR is about hours
// actually worked, not scheduled absence. Agency proposed shifts (AG-*) skip
// too — those hours belong to agency staff, not this staff member.

export const WTR_WEEKLY_LIMIT = 48;
export const WTR_WEEKLY_WARN  = 44;

export function checkWTRImpact(staff, dateStr, overrides, config, proposedShift) {
  if (!staff) return { ok: true, warn: false, projectedHours: null, message: null };
  if (staff.wtr_opt_out) {
    return { ok: true, warn: false, projectedHours: null, message: 'WTR opt-out on file' };
  }
  if (!isWorkingShift(proposedShift)) {
    return { ok: true, warn: false, projectedHours: null, message: null };
  }
  if (isAgencyShift(proposedShift)) {
    return { ok: true, warn: false, projectedHours: null, message: null };
  }

  const targetDate = parseDate(dateStr);
  const dayOfWeek = targetDate.getUTCDay(); // 0 = Sunday
  const daysFromMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = addDays(targetDate, -daysFromMon);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const staffExisting = overrides?.[dateStr]?.[staff.id];
  const tempOverrides = {
    ...overrides,
    [dateStr]: {
      ...(overrides?.[dateStr] || {}),
      [staff.id]: { ...(staffExisting || {}), shift: proposedShift },
    },
  };

  const stats = calculateStaffPeriodHours(staff, weekDates, tempOverrides, config);
  const projected = stats.totalHours;

  if (projected > WTR_WEEKLY_LIMIT) {
    return {
      ok: false,
      warn: true,
      projectedHours: projected,
      message: `Projected ${projected.toFixed(1)}h this week — exceeds Working Time Regulations 48h limit. Staff has not opted out.`,
    };
  }
  if (projected > WTR_WEEKLY_WARN) {
    return {
      ok: true,
      warn: true,
      projectedHours: projected,
      message: `Projected ${projected.toFixed(1)}h this week — approaching 48h WTR limit.`,
    };
  }
  return { ok: true, warn: false, projectedHours: projected, message: null };
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
  const cycleDay = resolveCycleDayForStaff(staff, dateStr, config, config?.cycle_start_date);
  const scheduled = getScheduledShift(staff, cycleDay, dateStr, config);

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
  if (shift === 'NS') return 'NO_SHOW';
  if (BH_SHIFTS.includes(shift)) return 'WORKING';
  if (['ADM', 'TRN'].includes(shift)) return 'WORKING';
  return shift;
}
