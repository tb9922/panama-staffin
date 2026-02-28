/**
 * payroll.js — Pure calculation functions for the Panama payroll module.
 * No DB calls, no React. Importable server-side and client-side.
 *
 * Enhancement stacking: ADDITIVE.
 *   total = base_pay + Σ(enhancement_amounts)
 * NOT multiplicative: do NOT chain percentages.
 *
 * Cross-midnight rule: classify entire shift by START DATE.
 * A night shift starting Saturday is a Saturday shift for all hours.
 */

import { NIGHT_SHIFTS, getShiftHours, isOTShift } from './rotation.js';

// ── Age & NMW ─────────────────────────────────────────────────────────────────

/**
 * Calculate age in completed years as of asOfDate.
 * Both inputs: 'YYYY-MM-DD' strings or Date objects.
 */
export function calculateAge(dateOfBirth, asOfDate) {
  const dob = typeof dateOfBirth === 'string'
    ? new Date(dateOfBirth + 'T00:00:00Z')
    : dateOfBirth;
  const ref = typeof asOfDate === 'string'
    ? new Date(asOfDate + 'T00:00:00Z')
    : asOfDate;

  let age = ref.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = ref.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/**
 * Map age to NMW age bracket.
 * Apprentice status (first year of apprenticeship or under 19) must be
 * passed separately — not calculable from age alone.
 */
export function getNMWBracket(age) {
  if (age >= 21) return '21+';
  if (age >= 18) return '18-20';
  return '16-17';
}

/**
 * Look up the applicable NMW hourly rate for a given bracket on a given date.
 * nmwRates: array of { effective_from: 'YYYY-MM-DD', age_bracket, hourly_rate }
 * Returns the rate from the most recent row where effective_from <= date.
 * Returns null if no applicable rate found.
 */
export function getApplicableNMWRate(bracket, date, nmwRates) {
  const dateStr = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  const applicable = nmwRates
    .filter(r => r.age_bracket === bracket && r.effective_from <= dateStr)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return applicable.length > 0 ? parseFloat(applicable[0].hourly_rate) : null;
}

/**
 * Check NMW compliance for a single shift.
 * If staff.date_of_birth is null, defaults to '21+' bracket.
 * Returns { compliant, effectiveRate, nmwRate, shortfall, bracket, warning }
 */
export function checkNMWCompliance(staff, shiftDate, totalPay, hours, nmwRates) {
  if (!hours || hours <= 0) {
    return { compliant: true, effectiveRate: 0, nmwRate: 0, shortfall: 0, bracket: '21+', warning: null };
  }

  let bracket = '21+';
  let warning = null;
  if (staff.date_of_birth) {
    const age = calculateAge(staff.date_of_birth, shiftDate);
    bracket = getNMWBracket(age);
  } else {
    warning = 'Date of birth not set — defaulting to 21+ NMW bracket';
  }

  const nmwRate = getApplicableNMWRate(bracket, shiftDate, nmwRates);
  if (nmwRate === null) {
    return { compliant: true, effectiveRate: round2(totalPay / hours), nmwRate: 0, shortfall: 0, bracket, warning };
  }

  const effectiveRate = round2(totalPay / hours);
  const shortfall = round2(Math.max(0, nmwRate - effectiveRate));
  return {
    compliant: effectiveRate >= nmwRate,
    effectiveRate,
    nmwRate,
    shortfall,
    bracket,
    warning,
  };
}

// ── Enhancement Classification ────────────────────────────────────────────────

/**
 * Determine which enhancement types apply to a shift.
 * Returns an array of applies_to strings.
 *
 * Stacking examples:
 *   N shift on Sunday + BH + sleep_in → ['night', 'weekend_sun', 'bank_holiday', 'sleep_in']
 *   BH-N shift → ['night', 'bank_holiday']   (BH-N was originally N, still night)
 *   OC-E on Tuesday → ['on_call']
 *   E shift on Saturday → ['weekend_sat']
 */
export function classifyShiftEnhancements(shift, date, isBankHoliday, isSleepIn) {
  const types = [];
  const dateStr = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  const dayOfWeek = new Date(dateStr + 'T12:00:00Z').getUTCDay(); // 0=Sun, 6=Sat

  // Night enhancement: N and BH-N (BH-N was originally a night shift)
  if (NIGHT_SHIFTS.includes(shift)) {
    types.push('night');
  }

  // Weekend: classified by start date (cross-midnight rule)
  if (dayOfWeek === 6) types.push('weekend_sat');
  if (dayOfWeek === 0) types.push('weekend_sun');

  // Bank holiday
  if (isBankHoliday) types.push('bank_holiday');

  // Sleep-in: flat rate on top, regardless of other enhancements
  if (isSleepIn) types.push('sleep_in');

  // On-call / overtime (OC-* shifts)
  if (isOTShift(shift)) types.push('on_call');

  return types;
}

// ── Pay Calculation ───────────────────────────────────────────────────────────

/**
 * Calculate the monetary amount for a single enhancement rule.
 * rate_type: 'percentage'    → hours × (baseRate × amount / 100)
 * rate_type: 'fixed_hourly'  → hours × amount
 * rate_type: 'flat_per_shift' → amount (sleep-in style, ignores hours)
 */
export function calculateEnhancement(rule, hours, baseRate) {
  switch (rule.rate_type) {
    case 'percentage':
      return round2(hours * (baseRate * rule.amount / 100));
    case 'fixed_hourly':
      return round2(hours * rule.amount);
    case 'flat_per_shift':
      return round2(parseFloat(rule.amount));
    default:
      return 0;
  }
}

/**
 * Calculate total pay for a single shift.
 * rules: array of active pay_rate_rules for the home.
 * Returns:
 *   { hours, basePay, enhancements, totalEnhancement, total, effectiveRate }
 *   enhancements: [{ type, ruleName, rateType, amount, enhancementAmount }]
 */
export function calculateShiftPay(shift, date, staff, rules, config, isSleepIn, isBankHoliday) {
  const hours = getDefaultShiftHours(shift, config);
  const baseRate = parseFloat(staff.hourly_rate) || 0;
  const basePay = round2(hours * baseRate);

  const applicableTypes = classifyShiftEnhancements(shift, date, isBankHoliday, isSleepIn);

  const enhancements = [];
  for (const type of applicableTypes) {
    const rule = rules.find(r => r.applies_to === type);
    if (!rule) continue;
    const enhancementAmount = calculateEnhancement(rule, hours, baseRate);
    enhancements.push({
      type,
      ruleName: rule.name,
      rateType: rule.rate_type,
      amount: parseFloat(rule.amount),
      enhancementAmount,
    });
  }

  const totalEnhancement = round2(enhancements.reduce((s, e) => s + e.enhancementAmount, 0));
  const total = round2(basePay + totalEnhancement);
  const effectiveRate = hours > 0 ? round2(total / hours) : 0;

  return { hours, basePay, enhancements, totalEnhancement, total, effectiveRate };
}

/**
 * Get default shift hours from home config.
 * Mirrors getShiftHours from rotation.js — returns 0 for non-working shifts.
 */
export function getDefaultShiftHours(shift, config) {
  return getShiftHours(shift, config);
}

// ── Snap-to-Shift (Timesheet) ─────────────────────────────────────────────────

/**
 * Apply snap-to-shift logic to a clock-in time.
 * All times as 'HH:MM' strings.
 *
 * Rules:
 *   - Clock-in early within window → snap to scheduled start (saves money)
 *   - Clock-in early outside window → use actual (genuinely working early)
 *   - Clock-in late → use actual (always — they weren't working)
 *   - Exactly on time → use scheduled
 *   - Snap disabled → always use actual
 *
 * Returns { snapped: 'HH:MM', savedMinutes: number, applied: boolean }
 */
export function snapToShift(scheduledTime, actualTime, snapWindowMinutes, isEnabled) {
  if (!isEnabled || !scheduledTime || !actualTime) {
    return { snapped: actualTime || scheduledTime, savedMinutes: 0, applied: false };
  }

  const scheduled = parseTimeMinutes(scheduledTime);
  const actual = parseTimeMinutes(actualTime);
  const diffMinutes = scheduled - actual; // positive = clocked in early

  // Early, within window → snap
  if (diffMinutes > 0 && diffMinutes <= snapWindowMinutes) {
    return { snapped: scheduledTime, savedMinutes: diffMinutes, applied: true };
  }

  // Early, outside window → use actual (genuinely working early)
  // Late → use actual
  return { snapped: actualTime, savedMinutes: 0, applied: false };
}

/**
 * Calculate payable hours from snapped start/end times, minus break.
 * Handles cross-midnight (night shifts): if snappedEnd < snappedStart,
 * adds 24 hours to snappedEnd.
 * Returns decimal hours rounded to 2dp.
 */
export function calculatePayableHours(snappedStart, snappedEnd, breakMinutes) {
  if (!snappedStart || !snappedEnd) return 0;

  let startMins = parseTimeMinutes(snappedStart);
  let endMins = parseTimeMinutes(snappedEnd);

  // Cross-midnight detection
  if (endMins <= startMins) {
    endMins += 24 * 60;
  }

  const payableMinutes = Math.max(0, endMins - startMins - (breakMinutes || 0));
  return round2(payableMinutes / 60);
}

// ── Period Utilities ──────────────────────────────────────────────────────────

/**
 * Suggest the next payroll period based on the most recent run and pay frequency.
 * lastRun: { period_end: 'YYYY-MM-DD' } or null (first run ever)
 * payFrequency: 'weekly' | 'fortnightly' | 'monthly'
 * Returns { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
 */
export function suggestNextPeriod(lastRun, payFrequency) {
  const today = new Date().toISOString().slice(0, 10);

  if (!lastRun) {
    // First run: default to current calendar month
    const d = new Date(today + 'T00:00:00Z');
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
      .toISOString().slice(0, 10);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
      .toISOString().slice(0, 10);
    return { start, end };
  }

  const lastEnd = new Date(lastRun.period_end + 'T00:00:00Z');
  const nextStart = new Date(Date.UTC(
    lastEnd.getUTCFullYear(), lastEnd.getUTCMonth(), lastEnd.getUTCDate() + 1,
  ));

  if (payFrequency === 'weekly') {
    const nextEnd = new Date(Date.UTC(
      nextStart.getUTCFullYear(), nextStart.getUTCMonth(), nextStart.getUTCDate() + 6,
    ));
    return { start: nextStart.toISOString().slice(0, 10), end: nextEnd.toISOString().slice(0, 10) };
  }

  if (payFrequency === 'fortnightly') {
    const nextEnd = new Date(Date.UTC(
      nextStart.getUTCFullYear(), nextStart.getUTCMonth(), nextStart.getUTCDate() + 13,
    ));
    return { start: nextStart.toISOString().slice(0, 10), end: nextEnd.toISOString().slice(0, 10) };
  }

  // monthly (default): start to last day of same calendar month
  const nextEnd = new Date(Date.UTC(
    nextStart.getUTCFullYear(), nextStart.getUTCMonth() + 1, 0,
  ));
  return { start: nextStart.toISOString().slice(0, 10), end: nextEnd.toISOString().slice(0, 10) };
}

// ── CSV Export Builders ───────────────────────────────────────────────────────

/**
 * Build Sage Payroll CSV string from payroll lines.
 * staffMap: Map<staffId, staffObject> with .name, .hourly_rate
 * run: payroll_run object with period_start, period_end
 */
/**
 * Build CSV for Sage 50 Payroll import.
 *
 * @param {Array}  payrollLines
 * @param {Map}    staffMap  Map<staffId, staffObject>
 * @param {object} run  payroll_run row
 * @param {Map|null} ytdMap  Map<staffId, ytdObject> — null for draft/calculated runs
 */
export function buildSageCSV(payrollLines, staffMap, run, ytdMap = null) {
  // Primary columns: gross pay data the accountant enters into Sage/Xero
  // Reference columns: Panama estimates the accountant cross-checks (prefixed "Ref:")
  const headers = [
    'Staff_Name', 'NI_Number', 'Tax_Code', 'Student_Loan_Plan',
    'Pay_Period_Start', 'Pay_Period_End',
    'Basic_Hours', 'Basic_Rate', 'Basic_Pay',
    'Night_Hours', 'Night_Enhancement',
    'Weekend_Hours', 'Weekend_Enhancement',
    'Bank_Holiday_Hours', 'Bank_Holiday_Enhancement',
    'Overtime_Hours', 'Overtime_Pay',
    'Sleep_In_Count', 'Sleep_In_Pay',
    'On_Call_Hours', 'On_Call_Enhancement',
    'Holiday_Days', 'Holiday_Pay',
    'SSP_Days', 'SSP_Amount',
    'Total_Gross_Pay',
    'Ref:Est_PAYE', 'Ref:Est_Employee_NI', 'Ref:Est_Employer_NI',
    'Ref:Est_Pension_Employee', 'Ref:Est_Pension_Employer', 'Ref:Est_Student_Loan',
    'Ref:Est_Net_Pay',
    'YTD_Gross', 'YTD_Tax', 'YTD_Employee_NI', 'YTD_Net',
  ];

  const rows = payrollLines.map(line => {
    const staff = staffMap.get(line.staff_id) || {};
    const ytd   = ytdMap ? (ytdMap.get(line.staff_id) || null) : null;
    return [
      csvEscape(staff.name || ''),
      csvEscape(staff.ni_number || ''),
      csvEscape(line.tax_code || ''),
      csvEscape(line.student_loan_plan || ''),
      run.period_start,
      run.period_end,
      (line.base_hours || 0).toFixed(2),
      (parseFloat(staff.hourly_rate) || 0).toFixed(2),
      (line.base_pay || 0).toFixed(2),
      (line.night_hours || 0).toFixed(2),
      (line.night_enhancement || 0).toFixed(2),
      (line.weekend_hours || 0).toFixed(2),
      (line.weekend_enhancement || 0).toFixed(2),
      (line.bank_holiday_hours || 0).toFixed(2),
      (line.bank_holiday_enhancement || 0).toFixed(2),
      (line.overtime_hours || 0).toFixed(2),
      (line.overtime_enhancement || 0).toFixed(2),
      line.sleep_in_count || 0,
      (line.sleep_in_pay || 0).toFixed(2),
      (line.on_call_hours || 0).toFixed(2),
      (line.on_call_enhancement || 0).toFixed(2),
      (line.holiday_days || 0).toFixed(1),
      (line.holiday_pay || 0).toFixed(2),
      line.ssp_days || 0,
      (line.ssp_amount || 0).toFixed(2),
      (line.gross_pay || 0).toFixed(2),
      (line.tax_deducted || 0).toFixed(2),
      (line.employee_ni || 0).toFixed(2),
      (line.employer_ni || 0).toFixed(2),
      (line.pension_employee || 0).toFixed(2),
      (line.pension_employer || 0).toFixed(2),
      (line.student_loan || 0).toFixed(2),
      (line.net_pay || 0).toFixed(2),
      ytd ? (ytd.gross_pay || 0).toFixed(2) : '',
      ytd ? (ytd.tax_deducted || 0).toFixed(2) : '',
      ytd ? (ytd.employee_ni || 0).toFixed(2) : '',
      ytd ? (ytd.net_pay || 0).toFixed(2) : '',
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\r\n');
}

/**
 * Generic CSV — same columns as Sage, works with any payroll bureau.
 * ytdMap is optional (null for draft runs).
 */
export function buildGenericCSV(payrollLines, staffMap, run, ytdMap = null) {
  return buildSageCSV(payrollLines, staffMap, run, ytdMap);
}

// ── Internal Helpers ──────────────────────────────────────────────────────────

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Parse 'HH:MM' to minutes since midnight. */
function parseTimeMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function csvEscape(str) {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
