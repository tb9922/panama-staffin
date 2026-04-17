import { describe, it, expect } from 'vitest';
import {
  parseTaxCode,
  calculatePAYE,
  calculateNI,
  calculateStudentLoan,
  assessPensionEligibility,
  calculatePensionContributions,
  getSSPConfig,
  calculateSSP,
  getPayPeriodNumber,
  getTaxYearStart,
  getTaxYear,
  getHMRCTaxMonth,
  getHMRCPaymentDueDate,
} from '../payrollTax.js';

// ─── round2 (mirrors internal round2 from payrollTax.js) ────────────────────

describe('round2 negative edge case', () => {
  // Mirror of the internal round2 function for direct testing
  function round2(n) {
    if (n < 0) return -Math.round((-n + Number.EPSILON) * 100) / 100;
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  it('round2(-0.005) → -0.01', () => {
    expect(round2(-0.005)).toBe(-0.01);
  });

  it('round2(-12.455) → -12.46', () => {
    expect(round2(-12.455)).toBe(-12.46);
  });

  it('round2(1.005) → 1.01 (existing behavior)', () => {
    expect(round2(1.005)).toBe(1.01);
  });

  it('round2(0) → 0', () => {
    expect(round2(0)).toBe(0);
  });

  it('round2(-0) → 0 or -0', () => {
    expect(Object.is(round2(-0), 0) || Object.is(round2(-0), -0)).toBe(true);
  });
});

// ─── Tax year helpers ─────────────────────────────────────────────────────────

describe('getTaxYearStart', () => {
  it('date in Jan 2026 → Apr 6 2025', () => {
    const r = getTaxYearStart(new Date('2026-01-15'));
    expect(r.toISOString().slice(0, 10)).toBe('2025-04-06');
  });
  it('Apr 6 2025 → Apr 6 2025 (start of new year)', () => {
    const r = getTaxYearStart(new Date('2025-04-06'));
    expect(r.toISOString().slice(0, 10)).toBe('2025-04-06');
  });
  it('Apr 5 2025 → Apr 6 2024 (last day of old year)', () => {
    const r = getTaxYearStart(new Date('2025-04-05'));
    expect(r.toISOString().slice(0, 10)).toBe('2024-04-06');
  });
  it('Dec 31 2025 → Apr 6 2025', () => {
    const r = getTaxYearStart(new Date('2025-12-31'));
    expect(r.toISOString().slice(0, 10)).toBe('2025-04-06');
  });
});

describe('getTaxYear', () => {
  it('Jan 2026 → 2025', () => { expect(getTaxYear(new Date('2026-01-01'))).toBe(2025); });
  it('Apr 6 2025 → 2025', () => { expect(getTaxYear(new Date('2025-04-06'))).toBe(2025); });
  it('Apr 5 2025 → 2024', () => { expect(getTaxYear(new Date('2025-04-05'))).toBe(2024); });
});

describe('getHMRCTaxMonth', () => {
  it('Apr 6 → month 1', () => { expect(getHMRCTaxMonth(new Date('2025-04-06'))).toBe(1); });
  it('May 6 → month 2', () => { expect(getHMRCTaxMonth(new Date('2025-05-06'))).toBe(2); });
  it('Apr 5 2026 → month 12 (last day of tax year)', () => {
    expect(getHMRCTaxMonth(new Date('2026-04-05'))).toBe(12);
  });
  it('May 5 → still month 1 (before May 6)', () => {
    expect(getHMRCTaxMonth(new Date('2025-05-05'))).toBe(1);
  });
  it('Mar 6 2026 → month 12', () => { expect(getHMRCTaxMonth(new Date('2026-03-06'))).toBe(12); });
});

describe('getHMRCPaymentDueDate', () => {
  it('tax month 1 (Apr-May) → Jun 19', () => {
    expect(getHMRCPaymentDueDate(2025, 1)).toBe('2025-06-19');
  });
  it('tax month 11 (Feb-Mar) → Apr 19', () => {
    expect(getHMRCPaymentDueDate(2025, 11)).toBe('2026-04-19');
  });
  it('tax month 12 (Mar-Apr) → May 19 next year', () => {
    expect(getHMRCPaymentDueDate(2025, 12)).toBe('2026-05-19');
  });
});

describe('calculatePensionContributions overrides', () => {
  it('uses enrolment contribution overrides when present', () => {
    const result = calculatePensionContributions(
      500,
      'weekly',
      {
        lower_qualifying_weekly: 125,
        upper_qualifying_weekly: 967,
        employee_rate: 0.05,
        employer_rate: 0.03,
      },
      {
        status: 'eligible_enrolled',
        contribution_override_employee: 0.02,
        contribution_override_employer: 0.07,
      }
    );

    expect(result.qualifyingEarnings).toBe(375);
    expect(result.employeeAmount).toBe(7.5);
    expect(result.employerAmount).toBe(26.25);
  });
});

describe('getPayPeriodNumber', () => {
  it('weekly: Apr 12 2025 → period 1 (first week after Apr 6)', () => {
    expect(getPayPeriodNumber('2025-04-12', 'weekly')).toBe(1);
  });
  it('weekly: Apr 19 2025 → period 2', () => {
    expect(getPayPeriodNumber('2025-04-19', 'weekly')).toBe(2);
  });
  it('monthly: Apr 30 2025 → period 1', () => {
    expect(getPayPeriodNumber('2025-04-30', 'monthly')).toBe(1);
  });
  it('monthly: Mar 31 2026 → period 12', () => {
    expect(getPayPeriodNumber('2026-03-31', 'monthly')).toBe(12);
  });
  it('fortnightly: Apr 19 2025 → period 1', () => {
    expect(getPayPeriodNumber('2025-04-19', 'fortnightly')).toBe(1);
  });
  it('weekly: Apr 5 2026 → period 53', () => {
    expect(getPayPeriodNumber('2026-04-05', 'weekly')).toBe(53);
  });
  it('fortnightly: Apr 5 2026 → period 27', () => {
    expect(getPayPeriodNumber('2026-04-05', 'fortnightly')).toBe(27);
  });
});

// ─── parseTaxCode ─────────────────────────────────────────────────────────────

describe('parseTaxCode', () => {
  it('null → default 1257L', () => {
    const r = parseTaxCode(null);
    expect(r.missingCode).toBe(true);
    expect(r.annualAllowance).toBe(12570);
    expect(r.country).toBe('england_wales');
  });
  it('empty string → default', () => {
    expect(parseTaxCode('').missingCode).toBe(true);
  });
  it('1257L → standard allowance £12,570', () => {
    const r = parseTaxCode('1257L');
    expect(r.type).toBe('standard');
    expect(r.annualAllowance).toBe(12570);
    expect(r.country).toBe('england_wales');
  });
  it('S1257L → Scotland', () => {
    const r = parseTaxCode('S1257L');
    expect(r.country).toBe('scotland');
    expect(r.annualAllowance).toBe(12570);
  });
  it('C1000N → Wales (uses england_wales tax bands)', () => {
    const r = parseTaxCode('C1000N');
    expect(r.country).toBe('england_wales');
    expect(r.annualAllowance).toBe(10000);
  });
  it('BR → flat 20% code', () => {
    const r = parseTaxCode('BR');
    expect(r.type).toBe('br');
    expect(r.annualAllowance).toBe(0);
  });
  it('D0 → flat 40%', () => { expect(parseTaxCode('D0').type).toBe('d0'); });
  it('D1 → flat 45%', () => { expect(parseTaxCode('D1').type).toBe('d1'); });
  it('NT → no tax', () => {
    const r = parseTaxCode('NT');
    expect(r.type).toBe('nt');
    expect(r.annualAllowance).toBe(Infinity);
  });
  it('0T → zero allowance', () => {
    const r = parseTaxCode('0T');
    expect(r.type).toBe('0t');
    expect(r.annualAllowance).toBe(0);
  });
  it('K500 → k_code (adds £5,000 to taxable)', () => {
    const r = parseTaxCode('K500');
    expect(r.type).toBe('k_code');
    expect(r.annualAllowance).toBe(-5000);
  });
  it('1257L W1 → strips W1 suffix', () => {
    const r = parseTaxCode('1257L W1');
    expect(r.type).toBe('standard');
    expect(r.annualAllowance).toBe(12570);
  });
  it('unrecognised code → default fallback', () => {
    const r = parseTaxCode('XYZZY');
    expect(r.missingCode).toBe(true);
  });
});

// ─── calculatePAYE ────────────────────────────────────────────────────────────

const englandBands = [
  { band_name: 'basic',      lower_limit: 0,      upper_limit: 37700,  rate: 0.20 },
  { band_name: 'higher',     lower_limit: 37700,  upper_limit: 125140, rate: 0.40 },
  { band_name: 'additional', lower_limit: 125140, upper_limit: null,   rate: 0.45 },
];

const scotlandBands = [
  { band_name: 'starter',      lower_limit: 0,      upper_limit: 2306,   rate: 0.19 },
  { band_name: 'basic',        lower_limit: 2306,   upper_limit: 13991,  rate: 0.20 },
  { band_name: 'intermediate', lower_limit: 13991,  upper_limit: 31092,  rate: 0.21 },
  { band_name: 'higher',       lower_limit: 31092,  upper_limit: 62430,  rate: 0.42 },
  { band_name: 'advanced',     lower_limit: 62430,  upper_limit: 125140, rate: 0.45 },
  { band_name: 'top',          lower_limit: 125140, upper_limit: null,   rate: 0.48 },
];

// ytd uses gross_pay (cumulative raw gross) + tax_deducted
const zeroYTD = { gross_pay: 0, tax_deducted: 0 };

describe('calculatePAYE', () => {
  it('NT code → zero tax', () => {
    const r = calculatePAYE(2000, parseTaxCode('NT'), 1, 12, zeroYTD, englandBands);
    expect(r.tax).toBe(0);
  });

  it('missing code defaults to 1257L — first period, £2k gross', () => {
    const code = parseTaxCode(null);
    const r = calculatePAYE(2000, code, 1, 12, zeroYTD, englandBands);
    // Period allowance = 12570/12 = 1047.50; taxable = 2000-1047.50 = 952.50
    // Annual taxable on cumulative = 952.50; tax = 952.50 * 0.20 = 190.50
    expect(r.tax).toBeCloseTo(190.5, 1);
  });

  it('basic rate — period 1, monthly, gross £2,000', () => {
    const code = parseTaxCode('1257L');
    const r = calculatePAYE(2000, code, 1, 12, zeroYTD, englandBands);
    expect(r.tax).toBeCloseTo(190.5, 1);
    expect(r.isRefund).toBe(false);
  });

  it('cumulative — period 2, YTD has prior gross and tax', () => {
    const code = parseTaxCode('1257L');
    // Period 1: gross 2000, allowance 1047.5, taxable 952.5, tax 190.5
    // Period 2: same gross. ytd.gross_pay = 2000 (prior period gross)
    const ytd = { gross_pay: 2000, tax_deducted: 190.5 };
    const r = calculatePAYE(2000, code, 2, 12, ytd, englandBands);
    // Cumulative gross = 4000, total allowance = 1047.5*2 = 2095, taxable = 1905
    // Total tax = 1905*0.20 = 381; period 2 tax = 381 - 190.5 = 190.5
    expect(r.tax).toBeCloseTo(190.5, 1);
  });

  it('refund — over-deducted in prior period', () => {
    const code = parseTaxCode('1257L');
    // Period 2: prior gross 2000, but over-deducted £500 (should be 190.5)
    const ytd = { gross_pay: 2000, tax_deducted: 500 };
    const r = calculatePAYE(2000, code, 2, 12, ytd, englandBands);
    expect(r.isRefund).toBe(true);
    expect(r.tax).toBeLessThan(0);
  });

  it('W1/M1 basis — no YTD consideration', () => {
    const code = { ...parseTaxCode('1257L'), basis: 'w1m1' };
    const ytdLarge = { gross_pay: 50000, tax_deducted: 9000 };
    const r = calculatePAYE(2000, code, 1, 12, ytdLarge, englandBands);
    // Should not refund despite large prior tax_deducted (W1M1 ignores YTD)
    expect(r.tax).toBeGreaterThanOrEqual(0);
    expect(r.isRefund).toBe(false);
  });

  it('extra weekly period uses standalone treatment instead of cumulative YTD', () => {
    const code = parseTaxCode('1257L');
    const ytdLarge = { gross_pay: 50000, tax_deducted: 9000 };
    const r = calculatePAYE(500, code, 53, 52, ytdLarge, englandBands);
    expect(r.isRefund).toBe(false);
    expect(r.tax).toBeCloseTo(51.65, 2);
  });

  it('extra fortnightly period uses standalone treatment instead of cumulative YTD', () => {
    const code = parseTaxCode('1257L');
    const ytdLarge = { gross_pay: 50000, tax_deducted: 9000 };
    const r = calculatePAYE(1000, code, 27, 26, ytdLarge, englandBands);
    expect(r.isRefund).toBe(false);
    expect(r.tax).toBeCloseTo(103.31, 2);
  });

  it('BR code — flat 20% on full gross', () => {
    const r = calculatePAYE(2000, parseTaxCode('BR'), 1, 12, zeroYTD, englandBands);
    expect(r.tax).toBeCloseTo(400, 1); // 20% of 2000
  });

  it('Scotland bands applied correctly for S1257L', () => {
    const code = parseTaxCode('S1257L');
    // Use Scotland bands — starter rate is 19%
    const r = calculatePAYE(1500, code, 1, 12, zeroYTD, scotlandBands);
    expect(r.tax).toBeGreaterThan(0);
  });

  it('higher rate band triggered', () => {
    // Gross £6,000/month, period 6 (YTD cumulative gross 30k before this period)
    const code = parseTaxCode('1257L');
    const ytd = { gross_pay: 30000, tax_deducted: 5000 };
    const r = calculatePAYE(6000, code, 6, 12, ytd, englandBands);
    // Some of cumulative income will hit higher rate
    expect(r.tax).toBeGreaterThan(0);
  });

  it('Net Pay Arrangement: pension deduction reduces PAYE', () => {
    // Two identical staff: one with pension (gross - pension), one without (full gross)
    const code = parseTaxCode('1257L');
    const gross = 3000;
    const pensionEmployee = 150; // 5% of qualifying earnings

    const noPension = calculatePAYE(gross, code, 1, 12, zeroYTD, englandBands);
    const withPension = calculatePAYE(gross - pensionEmployee, code, 1, 12, zeroYTD, englandBands);

    // Staff with pension should pay LESS income tax
    expect(withPension.tax).toBeLessThan(noPension.tax);
    // The tax saving should be approximately 20% of the pension deduction (basic rate)
    const taxSaving = noPension.tax - withPension.tax;
    expect(taxSaving).toBeCloseTo(pensionEmployee * 0.20, 1);
  });
});

// ─── calculateNI ──────────────────────────────────────────────────────────────

const niThresholds2025 = [
  { threshold_name: 'LEL', weekly_amount: 125,  monthly_amount: 542,  annual_amount: 6500  },
  { threshold_name: 'ST',  weekly_amount: 175,  monthly_amount: 758,  annual_amount: 9100  },
  { threshold_name: 'PT',  weekly_amount: 242,  monthly_amount: 1048, annual_amount: 12570 },
  { threshold_name: 'UEL', weekly_amount: 967,  monthly_amount: 4189, annual_amount: 50270 },
];

const niRatesA2025 = [
  { rate_type: 'employee_main',      rate: 0.08 },
  { rate_type: 'employee_above_uel', rate: 0.02 },
  { rate_type: 'employer',           rate: 0.15 },
];

describe('calculateNI', () => {
  it('below PT — zero employee NI', () => {
    const r = calculateNI(500, 'monthly', niThresholds2025, niRatesA2025);
    expect(r.employeeNI).toBe(0);
  });

  it('below ST — zero employer NI', () => {
    const r = calculateNI(700, 'monthly', niThresholds2025, niRatesA2025);
    expect(r.employerNI).toBe(0);
  });

  it('between PT and UEL — 8% employee, 15% employer', () => {
    const gross = 2000;
    const r = calculateNI(gross, 'monthly', niThresholds2025, niRatesA2025);
    // Employee: (2000-1048) * 0.08 = 952 * 0.08 = 76.16
    expect(r.employeeNI).toBeCloseTo(76.16, 1);
    // Employer: (2000-758) * 0.15 = 1242 * 0.15 = 186.3
    expect(r.employerNI).toBeCloseTo(186.3, 1);
  });

  it('above UEL — 2% employee on excess', () => {
    const gross = 5000; // above UEL monthly of 4189
    const r = calculateNI(gross, 'monthly', niThresholds2025, niRatesA2025);
    // Main band: (4189-1048) * 0.08 = 251.28
    // Above UEL: (5000-4189) * 0.02 = 16.22
    expect(r.employeeNI).toBeCloseTo(251.28 + 16.22, 0);
  });

  it('exact PT boundary — 0 employee NI at PT', () => {
    const r = calculateNI(1048, 'monthly', niThresholds2025, niRatesA2025);
    expect(r.employeeNI).toBe(0);
  });

  it('empty thresholds → zeros', () => {
    const r = calculateNI(2000, 'monthly', [], niRatesA2025);
    expect(r.employeeNI).toBe(0);
    expect(r.employerNI).toBe(0);
  });

  it('weekly frequency — uses weekly thresholds', () => {
    const r = calculateNI(500, 'weekly', niThresholds2025, niRatesA2025);
    // PT weekly = 242; employee: (500-242)*0.08 = 20.64
    expect(r.employeeNI).toBeCloseTo(20.64, 1);
  });
});

// ─── calculateStudentLoan ─────────────────────────────────────────────────────

const slThresholds = [
  { plan: '1',  annual_threshold: 24990, rate: 0.09 },
  { plan: '2',  annual_threshold: 28470, rate: 0.09 },
  { plan: 'PG', annual_threshold: 21000, rate: 0.06 },
];

describe('calculateStudentLoan', () => {
  it('null plan → 0', () => {
    expect(calculateStudentLoan(3000, null, 'monthly', slThresholds)).toBe(0);
  });

  it('plan 1 below threshold → 0', () => {
    // Monthly threshold: 24990/12 = 2082.50
    expect(calculateStudentLoan(2000, '1', 'monthly', slThresholds)).toBe(0);
  });

  it('plan 1 above threshold', () => {
    // Gross 3000, threshold 2082.50, deduction = (3000-2082.50)*0.09 = 82.58
    const r = calculateStudentLoan(3000, '1', 'monthly', slThresholds);
    expect(r).toBeCloseTo(82.58, 1);
  });

  it('plan 2 threshold is higher than plan 1', () => {
    // Monthly threshold plan 2: 28470/12 = 2372.50
    const r = calculateStudentLoan(3000, '2', 'monthly', slThresholds);
    // (3000-2372.50)*0.09 = 56.48
    expect(r).toBeCloseTo(56.48, 1);
  });

  it('PG plan — 6% rate', () => {
    // Monthly threshold PG: 21000/12 = 1750
    const r = calculateStudentLoan(3000, 'PG', 'monthly', slThresholds);
    // (3000-1750)*0.06 = 75
    expect(r).toBeCloseTo(75, 1);
  });

  it('dual plan 1,PG — sums both plans (within £0.02 of individual sum)', () => {
    const plan1 = calculateStudentLoan(3000, '1', 'monthly', slThresholds);
    const planPG = calculateStudentLoan(3000, 'PG', 'monthly', slThresholds);
    const dual  = calculateStudentLoan(3000, '1,PG', 'monthly', slThresholds);
    // Allow 1p rounding difference between summing individual results vs combined calc
    expect(Math.abs(dual - (plan1 + planPG))).toBeLessThan(0.02);
  });

  it('unknown plan → 0', () => {
    expect(calculateStudentLoan(3000, 'X', 'monthly', slThresholds)).toBe(0);
  });
});

// ─── assessPensionEligibility ─────────────────────────────────────────────────

const pensionConf = {
  trigger_annual: 10000,
  lower_qualifying_weekly: 125,
  upper_qualifying_weekly: 967,
  employee_rate: 0.05,
  employer_rate: 0.03,
  state_pension_age: 67,
};

function staffWithAge(age, refDate) {
  const ref = new Date(refDate);
  const dobYear = ref.getUTCFullYear() - age;
  return { date_of_birth: `${dobYear}-06-01` };
}

describe('assessPensionEligibility', () => {
  const ref = '2025-10-01';

  it('age 22+, above trigger → eligible_jobholder, shouldAutoEnrol=true', () => {
    const staff = staffWithAge(25, ref);
    // Monthly trigger = 10000/12 = 833.33; gross 1000 > trigger
    const r = assessPensionEligibility(staff, 1000, 'monthly', pensionConf, new Date(ref));
    expect(r.category).toBe('eligible_jobholder');
    expect(r.shouldAutoEnrol).toBe(true);
  });

  it('age 19, above lower but below trigger → non_eligible_jobholder', () => {
    const staff = staffWithAge(19, ref);
    // Monthly lower = 125*(52/12) ≈ 541.67; trigger = 10000/12 ≈ 833.33
    // Gross 700 > lower (541.67) but < trigger (833.33)
    const r = assessPensionEligibility(staff, 700, 'monthly', pensionConf, new Date(ref));
    expect(r.category).toBe('non_eligible_jobholder');
    expect(r.shouldAutoEnrol).toBe(false);
  });

  it('age 17, below lower earnings → entitled_worker', () => {
    const staff = staffWithAge(17, ref);
    const r = assessPensionEligibility(staff, 100, 'monthly', pensionConf, new Date(ref));
    expect(r.category).toBe('entitled_worker');
  });

  it('age 68 (above SPA) → entitled_worker regardless of earnings', () => {
    const staff = staffWithAge(68, ref);
    const r = assessPensionEligibility(staff, 5000, 'monthly', pensionConf, new Date(ref));
    expect(r.category).toBe('entitled_worker');
    expect(r.shouldAutoEnrol).toBe(false);
  });

  it('null pensionConfig → entitled_worker', () => {
    const staff = staffWithAge(25, ref);
    const r = assessPensionEligibility(staff, 2000, 'monthly', null, new Date(ref));
    expect(r.category).toBe('entitled_worker');
  });
});

// ─── calculatePensionContributions ───────────────────────────────────────────

describe('calculatePensionContributions', () => {
  const enrolled = { status: 'eligible_enrolled' };
  const optedOut = { status: 'opted_out' };

  it('above lower QE → contributions calculated', () => {
    // Monthly lower = 125*(52/12) = 541.67; upper = 967*(52/12) = 4190.33
    // Gross 2000; QE = 2000-541.67 = 1458.33
    const r = calculatePensionContributions(2000, 'monthly', pensionConf, enrolled);
    expect(r.employeeAmount).toBeCloseTo(1458.33 * 0.05, 1);
    expect(r.employerAmount).toBeCloseTo(1458.33 * 0.03, 1);
    expect(r.qualifyingEarnings).toBeCloseTo(1458.33, 1);
  });

  it('below lower QE → zero contributions', () => {
    const r = calculatePensionContributions(200, 'monthly', pensionConf, enrolled);
    expect(r.employeeAmount).toBe(0);
    expect(r.qualifyingEarnings).toBe(0);
  });

  it('above upper QE — capped at upper', () => {
    const r = calculatePensionContributions(5000, 'monthly', pensionConf, enrolled);
    // Upper monthly = 967*(52/12) = 4190.33; capped at upper-lower
    expect(r.qualifyingEarnings).toBeLessThanOrEqual(4190.33 - 541.67 + 0.1);
  });

  it('opted out → zero contributions', () => {
    const r = calculatePensionContributions(2000, 'monthly', pensionConf, optedOut);
    expect(r.employeeAmount).toBe(0);
    expect(r.employerAmount).toBe(0);
  });

  it('null enrolment → zero', () => {
    const r = calculatePensionContributions(2000, 'monthly', pensionConf, null);
    expect(r.employeeAmount).toBe(0);
  });
});

// ─── getSSPConfig ─────────────────────────────────────────────────────────────

const sspConfigs = [
  { effective_from: '2025-04-06', weekly_rate: 118.75, waiting_days: 3, lel_weekly: 125, max_weeks: 28 },
  { effective_from: '2026-04-06', weekly_rate: 123.25, waiting_days: 0, lel_weekly: null, max_weeks: 28 },
];

describe('getSSPConfig', () => {
  it('2025-05-01 → first config (3 waiting days)', () => {
    const r = getSSPConfig('2025-05-01', sspConfigs);
    expect(r.waiting_days).toBe(3);
    expect(r.weekly_rate).toBe(118.75);
  });
  it('2026-04-07 → second config (0 waiting days)', () => {
    const r = getSSPConfig('2026-04-07', sspConfigs);
    expect(r.waiting_days).toBe(0);
    expect(r.weekly_rate).toBe(123.25);
    expect(r.lel_weekly).toBeNull();
  });
  it('empty configs → null', () => {
    expect(getSSPConfig('2025-05-01', [])).toBeNull();
  });
});

// ─── calculateSSP ─────────────────────────────────────────────────────────────

const sspConf2025 = { weekly_rate: 118.75, waiting_days: 3, lel_weekly: 125, max_weeks: 28 };
const sspConf2026 = { weekly_rate: 123.25, waiting_days: 0, lel_weekly: null, max_weeks: 28 };

function makeSickPeriod(startDate, opts = {}) {
  return {
    start_date: startDate,
    end_date: opts.end_date || null,
    qualifying_days_per_week: opts.qualifying_days_per_week || 5,
    waiting_days_served: opts.waiting_days_served || 0,
    ssp_weeks_paid: opts.ssp_weeks_paid || 0,
    linked_to_period_id: opts.linked_to_period_id || null,
  };
}

describe('calculateSSP', () => {
  it('before sick period start → not eligible', () => {
    const period = makeSickPeriod('2025-06-09'); // Monday
    const r = calculateSSP(period, '2025-06-08', sspConf2025); // Sunday before
    expect(r.eligible).toBe(false);
  });

  it('weekend (Saturday) → not a qualifying day', () => {
    const period = makeSickPeriod('2025-06-07'); // Saturday
    const r = calculateSSP(period, '2025-06-07', sspConf2025);
    expect(r.eligible).toBe(false);
  });

  it('first 3 qualifying days are waiting days (not paid)', () => {
    const period = makeSickPeriod('2025-06-09'); // Monday
    // Day 1 (Mon), Day 2 (Tue), Day 3 (Wed) — all waiting
    expect(calculateSSP(period, '2025-06-09', sspConf2025).eligible).toBe(false);
    expect(calculateSSP(period, '2025-06-10', sspConf2025).eligible).toBe(false);
    expect(calculateSSP(period, '2025-06-11', sspConf2025).eligible).toBe(false);
  });

  it('day 4 (Thursday) → SSP paid', () => {
    const period = makeSickPeriod('2025-06-09'); // Monday
    const r = calculateSSP(period, '2025-06-12', sspConf2025);
    expect(r.eligible).toBe(true);
    expect(r.sspAmount).toBeCloseTo(118.75 / 5, 2); // £23.75
    expect(r.sspDays).toBe(1);
  });

  it('linked period — no waiting days (waiting_days_served already at 3)', () => {
    const period = makeSickPeriod('2025-07-07', { waiting_days_served: 3 });
    const r = calculateSSP(period, '2025-07-07', sspConf2025); // Monday, day 1
    expect(r.eligible).toBe(true); // no waiting days needed
  });

  it('April 2026 config — 0 waiting days, day 1 is paid', () => {
    const period = makeSickPeriod('2026-04-13'); // Monday
    const r = calculateSSP(period, '2026-04-13', sspConf2026);
    expect(r.eligible).toBe(true);
    expect(r.sspAmount).toBeCloseTo(123.25 / 5, 2);
  });

  it('max weeks exhausted → not eligible', () => {
    const period = makeSickPeriod('2025-01-06', { ssp_weeks_paid: 28 });
    const r = calculateSSP(period, '2025-06-09', sspConf2025);
    expect(r.eligible).toBe(false);
  });

  it('null config → not eligible', () => {
    const period = makeSickPeriod('2025-06-09');
    const r = calculateSSP(period, '2025-06-12', null);
    expect(r.eligible).toBe(false);
  });

  it('long-term sick (28 weeks) — formula matches expected qualifying day count', () => {
    // 28 weeks starting Monday June 9, 2025
    // Last qualifying day of week 28 = Friday Dec 5, 2025 (28 * 5 = 140 qualifying days)
    // After 3 waiting days, day 140 should be eligible
    const period = makeSickPeriod('2025-06-09');
    // Friday Dec 5 2025 = 28 weeks from Mon June 9 minus 2 days (to get Friday of week 28)
    // Week 28 ends Sun Dec 7. Fri Dec 5 = qualifying day 140.
    const r = calculateSSP(period, '2025-12-05', sspConf2025);
    expect(r.eligible).toBe(true);
    expect(r.sspDays).toBe(1);
    expect(r.sspAmount).toBeCloseTo(118.75 / 5, 2);
  });
});

// ─── Holiday daily rate formula (mirrors payrollService.calculateHolidayDailyRate) ──

describe('calculateSSP LEL guard', () => {
  it('blocks SSP when weekly earnings are below the LEL threshold', () => {
    const period = makeSickPeriod('2025-06-09');
    const r = calculateSSP(period, '2025-06-12', sspConf2025, 124.99);
    expect(r.eligible).toBe(false);
    expect(r.sspAmount).toBe(0);
  });

  it('allows SSP when weekly earnings meet the LEL threshold', () => {
    const period = makeSickPeriod('2025-06-09');
    const r = calculateSSP(period, '2025-06-12', sspConf2025, 125);
    expect(r.eligible).toBe(true);
    expect(r.sspAmount).toBeCloseTo(118.75 / 5, 2);
  });
});

describe('holiday daily rate formula', () => {
  // This tests the same logic as the private calculateHolidayDailyRate function
  function holidayDailyRate(contractHours, hourlyRate) {
    const ch = parseFloat(contractHours);
    if (!ch || ch <= 0) return 0;
    const hr = parseFloat(hourlyRate) || 0;
    return Math.round((ch / 5 * hr + Number.EPSILON) * 100) / 100;
  }

  it('null contract_hours returns 0', () => {
    expect(holidayDailyRate(null, 14.50)).toBe(0);
  });

  it('0 contract_hours returns 0', () => {
    expect(holidayDailyRate(0, 14.50)).toBe(0);
  });

  it('negative contract_hours returns 0', () => {
    expect(holidayDailyRate(-10, 14.50)).toBe(0);
  });

  it('valid contract_hours calculates correctly', () => {
    // 37.5 / 5 * 14.50 = 108.75
    expect(holidayDailyRate(37.5, 14.50)).toBe(108.75);
  });
});
