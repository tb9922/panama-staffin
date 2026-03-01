/**
 * payrollTax.js — Pure PAYE/NI/pension/SSP calculation functions.
 *
 * NO database imports. All functions take plain data arguments and return plain values.
 * This makes them fully unit-testable without a DB connection.
 *
 * Tax year boundary note: these functions treat a run's period_end as the tax year anchor.
 * A run spanning April 5-6 will use the period_end tax year for all staff. This is a known
 * approximation — per-day attribution is Phase 4.
 */

import { calculateAge } from './payroll.js';

// ─── Utility ──────────────────────────────────────────────────────────────────

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ─── Tax Year Helpers ─────────────────────────────────────────────────────────

/**
 * Returns the Date for April 6 of the tax year containing the given date.
 * Tax year 2025-26 starts 2025-04-06.
 */
export function getTaxYearStart(date) {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-indexed
  const day = d.getUTCDate();
  // If before April 6, tax year started in previous calendar year
  const taxStartYear = (month < 3 || (month === 3 && day < 6)) ? year - 1 : year;
  return new Date(Date.UTC(taxStartYear, 3, 6)); // April 6
}

/**
 * Returns the integer tax year start year (e.g. 2025 for 2025-26).
 */
export function getTaxYear(date) {
  const start = getTaxYearStart(date);
  return start.getUTCFullYear();
}

/**
 * Returns the HMRC tax month number (1-12, where 1 = April 6 to May 5).
 */
export function getHMRCTaxMonth(date) {
  const d = new Date(date);
  const _taxStart = getTaxYearStart(d);
  const _month = d.getUTCMonth();
  const day = d.getUTCDate();
  // Months within tax year (April = 3, May = 4 ... March = 2)
  const calMonth = d.getUTCMonth(); // 0-indexed
  const calYear = d.getUTCFullYear();
  // Tax month starts on 6th. If day < 6, we're still in the previous tax month.
  const adjustedMonth = day < 6 ? calMonth - 1 : calMonth;
  const _adjustedYear = adjustedMonth < 0 ? calYear - 1 : calYear;
  const finalMonth = ((adjustedMonth + 12) % 12);
  // April (3) = tax month 1, March (2) = tax month 12
  return ((finalMonth - 3 + 12) % 12) + 1;
}

/**
 * Returns the HMRC payment due date string (YYYY-MM-DD) — 19th of the month
 * following the tax month end.
 * taxMonth 1 (Apr 6 - May 5) → due June 19.
 * taxMonth 12 (Mar 6 - Apr 5) → due May 19 of taxYear+1.
 */
export function getHMRCPaymentDueDate(taxYear, taxMonth) {
  // Tax month 1 starts April (month 4). Tax month n starts at: ((taxMonth + 2) % 12) + 1
  const startCalMonth = ((taxMonth + 2) % 12) + 1; // April=4, May=5, ..., Jan=1, Feb=2, Mar=3

  // Tax months 1-9 start in Apr-Dec of taxYear; months 10-12 start in Jan-Mar of taxYear+1.
  let dueYear = startCalMonth < 4 ? taxYear + 1 : taxYear;

  // Due on 19th of month 2 months after start (month after the end month).
  let dueMonth = startCalMonth + 2;
  if (dueMonth > 12) {
    dueMonth -= 12;
    dueYear += 1;
  }

  const mm = String(dueMonth).padStart(2, '0');
  return `${dueYear}-${mm}-19`;
}

/**
 * Returns the pay period number within the tax year.
 * Weekly: 1-52, fortnightly: 1-26, monthly: 1-12.
 */
export function getPayPeriodNumber(periodEndDate, payFrequency) {
  const d = new Date(periodEndDate);
  const taxStart = getTaxYearStart(d);
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysDiff = Math.floor((d.getTime() - taxStart.getTime()) / msPerDay);
  if (payFrequency === 'weekly') {
    return Math.min(52, Math.max(1, Math.floor(daysDiff / 7) + 1));
  }
  if (payFrequency === 'fortnightly') {
    return Math.min(26, Math.max(1, Math.floor(daysDiff / 14) + 1));
  }
  // monthly
  const endMonth = d.getUTCMonth();
  const endYear = d.getUTCFullYear();
  const startMonth = taxStart.getUTCMonth();
  const startYear = taxStart.getUTCFullYear();
  const months = (endYear - startYear) * 12 + (endMonth - startMonth);
  return Math.min(12, Math.max(1, months + 1));
}

// ─── Tax Code Parsing ─────────────────────────────────────────────────────────

/**
 * Parses an HMRC tax code string into a structured object.
 * Never throws — returns the 1257L default with missingCode:true for null/empty input.
 *
 * Returns:
 *   { type, country, annualAllowance, basis, missingCode?, addToTaxable? }
 *   type: 'standard' | 'br' | 'd0' | 'd1' | 'nt' | '0t' | 'k_code' | 'default'
 *   country: 'england_wales' | 'scotland' | 'wales'
 *   annualAllowance: annual tax-free amount (negative for K codes)
 *   basis: 'cumulative' (default) — basis override via separate tax_codes.basis field
 */
export function parseTaxCode(taxCode) {
  const DEFAULT = {
    type: 'default',
    country: 'england_wales',
    annualAllowance: 12570,
    basis: 'cumulative',
    missingCode: true,
  };

  if (!taxCode || typeof taxCode !== 'string') return DEFAULT;

  let code = taxCode.trim().toUpperCase();

  // Strip W1/M1 suffix (week1/month1 basis indicated via tax_codes.basis field)
  code = code.replace(/\s*(W1|M1|W1\/M1)$/, '').trim();

  // Determine country prefix
  let country = 'england_wales';
  if (code.startsWith('S')) { country = 'scotland'; code = code.slice(1); }
  else if (code.startsWith('C')) { country = 'england_wales'; code = code.slice(1); }

  // Special codes
  if (code === 'NT')  return { type: 'nt',  country, annualAllowance: Infinity, basis: 'cumulative' };
  if (code === '0T')  return { type: '0t',  country, annualAllowance: 0,        basis: 'cumulative' };
  if (code === 'BR')  return { type: 'br',  country, annualAllowance: 0,        basis: 'cumulative' };
  if (code === 'D0')  return { type: 'd0',  country, annualAllowance: 0,        basis: 'cumulative' };
  if (code === 'D1')  return { type: 'd1',  country, annualAllowance: 0,        basis: 'cumulative' };

  // K code: adds to taxable income rather than deducting from it
  const kMatch = code.match(/^K(\d+)$/);
  if (kMatch) {
    return {
      type: 'k_code',
      country,
      annualAllowance: -(parseInt(kMatch[1], 10) * 10),
      basis: 'cumulative',
    };
  }

  // Standard codes: digits + letter suffix (L, M, N, T, Y, P, etc.)
  const standardMatch = code.match(/^(\d+)[A-Z]+$/);
  if (standardMatch) {
    return {
      type: 'standard',
      country,
      annualAllowance: parseInt(standardMatch[1], 10) * 10,
      basis: 'cumulative',
    };
  }

  // Unrecognised — fall back to default
  return { ...DEFAULT, missingCode: true };
}

// ─── PAYE ─────────────────────────────────────────────────────────────────────

/**
 * Calculate income tax deduction for a pay period.
 *
 * @param {number} grossPay  Gross pay this period (including holiday pay, SSP).
 * @param {object} parsedCode  Result of parseTaxCode().
 * @param {number} payPeriod  Current period number (1-52/26/12).
 * @param {number} periodsInYear  52 | 26 | 12.
 * @param {object} ytd  { taxable_pay, tax_deducted } — cumulative from prior approved runs.
 * @param {Array}  taxBands  From getTaxBands() — [{band_name, lower_limit, upper_limit, rate}].
 * @returns {{ tax: number, taxableIncome: number, isRefund: boolean }}
 */
export function calculatePAYE(grossPay, parsedCode, payPeriod, periodsInYear, ytd, taxBands) {
  // NT code — no tax
  if (parsedCode.type === 'nt') {
    return { tax: 0, taxableIncome: grossPay, isRefund: false };
  }

  // ytd.gross_pay = cumulative GROSS pay from all prior approved periods this tax year.
  // ytd.tax_deducted = cumulative tax already paid.
  const priorGross    = ytd?.gross_pay ?? 0;
  const priorTaxPaid  = ytd?.tax_deducted ?? 0;

  const basis = parsedCode.basis || 'cumulative';
  const periodAllowance = isFinite(parsedCode.annualAllowance)
    ? parsedCode.annualAllowance / periodsInYear
    : 0;

  if (basis === 'w1m1' || parsedCode.type === '0t') {
    // Week1/Month1: treat each period as standalone — no YTD
    const taxableThisPeriod = Math.max(0, grossPay - periodAllowance);
    const totalTaxDue = computeTax(taxableThisPeriod, taxBands, parsedCode);
    const tax = Math.max(0, round2(totalTaxDue));
    return { tax, taxableIncome: round2(taxableThisPeriod), isRefund: false };
  }

  // Cumulative basis: compare total tax due on cumulative income vs tax already paid.
  const cumulativeGross = priorGross + grossPay;
  const totalAllowanceToDate = periodAllowance * payPeriod;

  let cumulativeTaxableIncome;
  if (parsedCode.type === 'k_code') {
    // K code: negative allowance adds to taxable
    cumulativeTaxableIncome = cumulativeGross + Math.abs(totalAllowanceToDate);
  } else if (parsedCode.type === 'br' || parsedCode.type === 'd0' || parsedCode.type === 'd1') {
    cumulativeTaxableIncome = cumulativeGross;
  } else {
    cumulativeTaxableIncome = Math.max(0, cumulativeGross - totalAllowanceToDate);
  }

  const totalTaxOnCumulative = computeTax(cumulativeTaxableIncome, taxBands, parsedCode);
  const taxThisPeriod = round2(totalTaxOnCumulative - priorTaxPaid);
  const isRefund = taxThisPeriod < 0;

  return {
    tax: round2(taxThisPeriod), // allow negative for refund — payroll service clamps to 0 for payment
    taxableIncome: round2(Math.max(0, grossPay - periodAllowance)),
    isRefund,
  };
}

/** Compute total tax on an annual taxable income figure using the band table. */
function computeTax(annualTaxable, taxBands, parsedCode) {
  if (!taxBands || taxBands.length === 0) {
    // Fallback: basic rate 20%
    return annualTaxable * 0.20;
  }

  // BR code: flat 20% on everything
  if (parsedCode.type === 'br') return annualTaxable * 0.20;
  // D0: flat 40%
  if (parsedCode.type === 'd0') return annualTaxable * 0.40;
  // D1: flat 45%
  if (parsedCode.type === 'd1') return annualTaxable * 0.45;

  let tax = 0;
  let remaining = annualTaxable;

  // Bands are sorted ascending by lower_limit
  const sorted = [...taxBands].sort((a, b) => a.lower_limit - b.lower_limit);
  for (const band of sorted) {
    if (remaining <= 0) break;
    const upper = band.upper_limit ?? Infinity;
    const taxable = Math.min(remaining, upper - band.lower_limit);
    tax += taxable * band.rate;
    remaining -= taxable;
  }
  return tax;
}

// ─── National Insurance ───────────────────────────────────────────────────────

/**
 * Calculate employee and employer NI for a pay period.
 *
 * @param {number} grossPay  Gross pay this period.
 * @param {string} payFrequency  'weekly' | 'fortnightly' | 'monthly'.
 * @param {Array}  niThresholds  From getNIThresholds() — [{threshold_name, weekly_amount, monthly_amount, annual_amount}].
 * @param {Array}  niRates  From getNIRates() — [{rate_type, rate}].
 * @returns {{ employeeNI: number, employerNI: number }}
 */
export function calculateNI(grossPay, payFrequency, niThresholds, niRates) {
  if (!niThresholds || niThresholds.length === 0 || !niRates || niRates.length === 0) {
    return { employeeNI: 0, employerNI: 0 };
  }

  const _periodKey = payFrequency === 'monthly' ? 'monthly_amount' : 'weekly_amount';
  const _weeks = payFrequency === 'monthly' ? (52 / 12) : payFrequency === 'fortnightly' ? 2 : 1;

  function threshold(name) {
    const row = niThresholds.find(t => t.threshold_name === name);
    if (!row) return 0;
    if (payFrequency === 'monthly') return row.monthly_amount;
    if (payFrequency === 'fortnightly') return row.weekly_amount * 2;
    return row.weekly_amount;
  }

  function rate(type) {
    const row = niRates.find(r => r.rate_type === type);
    return row ? row.rate : 0;
  }

  const pt  = threshold('PT');  // employee primary threshold
  const uel = threshold('UEL'); // upper earnings limit
  const st  = threshold('ST');  // employer secondary threshold

  // Employee NI:  8% on PT-UEL, 2% above UEL
  let employeeNI = 0;
  if (grossPay > pt) {
    const mainBand = Math.min(grossPay, uel) - pt;
    employeeNI += mainBand * rate('employee_main');
  }
  if (grossPay > uel) {
    employeeNI += (grossPay - uel) * rate('employee_above_uel');
  }

  // Employer NI: 15% on everything above ST (no upper limit from April 2025)
  let employerNI = 0;
  if (grossPay > st) {
    employerNI = (grossPay - st) * rate('employer');
  }

  return { employeeNI: round2(employeeNI), employerNI: round2(employerNI) };
}

// ─── Student Loan ─────────────────────────────────────────────────────────────

/**
 * Calculate student loan repayment for a pay period.
 *
 * @param {number} grossPay  Gross pay this period.
 * @param {string|null} planTypeStr  Comma-separated plan codes e.g. '1', '2', 'PG', '1,PG'.
 * @param {string} payFrequency  'weekly' | 'fortnightly' | 'monthly'.
 * @param {Array}  thresholds  From getStudentLoanThresholds() — [{plan, annual_threshold, rate}].
 * @returns {number} Total deduction amount (sum of all plans).
 */
export function calculateStudentLoan(grossPay, planTypeStr, payFrequency, thresholds) {
  if (!planTypeStr || !thresholds || thresholds.length === 0) return 0;

  const periodsInYear = payFrequency === 'weekly' ? 52 : payFrequency === 'fortnightly' ? 26 : 12;
  const plans = planTypeStr.split(',').map(p => p.trim()).filter(Boolean);

  let total = 0;
  for (const plan of plans) {
    const config = thresholds.find(t => t.plan === plan);
    if (!config) continue;
    const periodThreshold = config.annual_threshold / periodsInYear;
    if (grossPay > periodThreshold) {
      total += (grossPay - periodThreshold) * config.rate;
    }
  }
  return round2(total);
}

// ─── Pension ──────────────────────────────────────────────────────────────────

/**
 * Assess pension eligibility for a worker.
 *
 * @param {object} staff  Staff record with date_of_birth (string YYYY-MM-DD).
 * @param {number} grossThisPeriod  Gross pay this period.
 * @param {string} payFrequency  'weekly' | 'fortnightly' | 'monthly'.
 * @param {object} pensionConfig  From getPensionConfig() — {trigger_annual, lower_qualifying_weekly, state_pension_age}.
 * @param {Date} asOfDate  Date to use for age calculation (defaults to today).
 * @returns {{ category: string, shouldAutoEnrol: boolean }}
 *   category: 'eligible_jobholder' | 'non_eligible_jobholder' | 'entitled_worker'
 */
export function assessPensionEligibility(staff, grossThisPeriod, payFrequency, pensionConfig, asOfDate) {
  if (!pensionConfig) return { category: 'entitled_worker', shouldAutoEnrol: false };

  const refDate = asOfDate ? new Date(asOfDate) : new Date();
  const age = staff.date_of_birth ? calculateAge(staff.date_of_birth, refDate) : null;

  const periodsInYear = payFrequency === 'weekly' ? 52 : payFrequency === 'fortnightly' ? 26 : 12;
  const _annualisedGross = grossThisPeriod * periodsInYear;
  const triggerPeriod = pensionConfig.trigger_annual / periodsInYear;
  const lowerPeriod = pensionConfig.lower_qualifying_weekly * (payFrequency === 'monthly' ? (52 / 12) : payFrequency === 'fortnightly' ? 2 : 1);

  const aboveSPA = age !== null && age >= pensionConfig.state_pension_age;
  const aboveTrigger = grossThisPeriod >= triggerPeriod;
  const aboveLower = grossThisPeriod >= lowerPeriod;

  if (aboveSPA) {
    return { category: 'entitled_worker', shouldAutoEnrol: false };
  }

  if (age !== null && age >= 22 && aboveTrigger) {
    return { category: 'eligible_jobholder', shouldAutoEnrol: true };
  }

  if (aboveLower) {
    return { category: 'non_eligible_jobholder', shouldAutoEnrol: false };
  }

  return { category: 'entitled_worker', shouldAutoEnrol: false };
}

/**
 * Calculate pension contributions for an enrolled worker.
 *
 * @param {number} grossPay  Gross pay this period.
 * @param {string} payFrequency  'weekly' | 'fortnightly' | 'monthly'.
 * @param {object} pensionConfig  {lower_qualifying_weekly, upper_qualifying_weekly, employee_rate, employer_rate}.
 * @param {object} enrolment  {status} — contribution calculated only if enrolled.
 * @returns {{ employeeAmount: number, employerAmount: number, qualifyingEarnings: number }}
 */
export function calculatePensionContributions(grossPay, payFrequency, pensionConfig, enrolment) {
  const ZERO = { employeeAmount: 0, employerAmount: 0, qualifyingEarnings: 0 };

  if (!enrolment || !['eligible_enrolled', 'opt_in_enrolled'].includes(enrolment.status)) {
    return ZERO;
  }
  if (!pensionConfig) return ZERO;

  const weeks = payFrequency === 'monthly' ? (52 / 12) : payFrequency === 'fortnightly' ? 2 : 1;
  const lowerPeriod = pensionConfig.lower_qualifying_weekly * weeks;
  const upperPeriod = pensionConfig.upper_qualifying_weekly * weeks;

  const qualifyingEarnings = Math.max(0, Math.min(grossPay, upperPeriod) - lowerPeriod);

  if (qualifyingEarnings <= 0) return ZERO;

  return {
    employeeAmount: round2(qualifyingEarnings * pensionConfig.employee_rate),
    employerAmount: round2(qualifyingEarnings * pensionConfig.employer_rate),
    qualifyingEarnings: round2(qualifyingEarnings),
  };
}

// ─── SSP ─────────────────────────────────────────────────────────────────────

/**
 * Pick the applicable SSP config for a given pay date.
 * Selects the most recent row where effective_from <= payDate.
 *
 * @param {string} payDate  YYYY-MM-DD.
 * @param {Array}  sspConfigs  All rows from ssp_config table.
 * @returns {object|null} The applicable SSP config row.
 */
export function getSSPConfig(payDate, sspConfigs) {
  if (!sspConfigs || sspConfigs.length === 0) return null;
  const sorted = [...sspConfigs]
    .filter(c => c.effective_from <= payDate)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return sorted[0] || null;
}

/**
 * Calculate SSP for a single sick day within a sick period.
 *
 * SSP is paid per qualifying day (Mon-Fri by default).
 * Waiting days: first 3 qualifying days are not paid (before April 2026: 0 from April 2026).
 * Linked periods (gap <= 56 days): waiting days already served — no new waiting period.
 *
 * @param {object} sickPeriod  From sick_periods table.
 * @param {string} payDate  YYYY-MM-DD — the date we're calculating SSP for.
 * @param {object} sspConfig  From getSSPConfig().
 * @returns {{ eligible: boolean, sspAmount: number, sspDays: number, waitingDaysUsed: number }}
 */
export function calculateSSP(sickPeriod, payDate, sspConfig) {
  const ZERO = { eligible: false, sspAmount: 0, sspDays: 0, waitingDaysUsed: 0 };

  if (!sspConfig || !sickPeriod) return ZERO;

  const startDate = new Date(sickPeriod.start_date);
  const payD = new Date(payDate);

  // Must be within the sick period
  if (payD < startDate) return ZERO;
  if (sickPeriod.end_date && payD > new Date(sickPeriod.end_date)) return ZERO;

  // 28-week cap: each week = 5 qualifying days; daily rate = weekly / qualifying_days_per_week
  const maxWeeks = sspConfig.max_weeks || 28;
  if ((sickPeriod.ssp_weeks_paid || 0) >= maxWeeks) return ZERO;

  // LEL check (abolished April 2026)
  // We trust that the caller has verified LEL at the start of the sick period.
  // sspConfig.lel_weekly === null means LEL abolished — no check needed.

  // Waiting days: linked period means waiting_days_served may already be ≥ waiting_days
  const waitingDaysRequired = sspConfig.waiting_days || 0;
  const waitingDaysAlreadyServed = sickPeriod.waiting_days_served || 0;

  // Calculate which qualifying day of the period this date falls on
  // Qualifying days are typically Monday-Friday (qualifying_days_per_week)
  const dayOfWeek = payD.getUTCDay(); // 0=Sun, 6=Sat
  const isQualifyingDay = dayOfWeek >= 1 && dayOfWeek <= 5; // Mon-Fri default

  if (!isQualifyingDay) return ZERO;

  // Count qualifying days from start of period to this date
  let qualDayCount = 0;
  const cursor = new Date(startDate);
  while (cursor <= payD) {
    const dow = cursor.getUTCDay();
    if (dow >= 1 && dow <= 5) qualDayCount++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  // If still within waiting period
  if (qualDayCount <= (waitingDaysRequired - waitingDaysAlreadyServed)) {
    return { eligible: false, sspAmount: 0, sspDays: 0, waitingDaysUsed: 1 };
  }

  // SSP daily rate = weekly_rate / qualifying_days_per_week
  const qualDaysPerWeek = sickPeriod.qualifying_days_per_week || 5;
  const dailyRate = round2(sspConfig.weekly_rate / qualDaysPerWeek);

  return {
    eligible: true,
    sspAmount: dailyRate,
    sspDays: 1,
    waitingDaysUsed: 0,
  };
}
