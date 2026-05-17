import { describe, it, expect } from 'vitest';
import {
  getTaxYear,
  getHMRCTaxMonth,
  getHMRCPaymentDueDate,
  getPayPeriodNumber,
  parseTaxCode,
  calculatePAYE,
  calculateNI,
  calculateStudentLoan,
  assessPensionEligibility,
  calculatePensionContributions,
  getSSPConfig,
  calculateSSP,
} from '../../shared/payrollTax.js';

describe('payrollTax', () => {
  it('derives tax year and HMRC month across the April boundary', () => {
    expect(getTaxYear('2026-04-05T00:00:00Z')).toBe(2025);
    expect(getTaxYear('2026-04-06T00:00:00Z')).toBe(2026);
    expect(getHMRCTaxMonth('2026-04-05T00:00:00Z')).toBe(12);
    expect(getHMRCTaxMonth('2026-04-06T00:00:00Z')).toBe(1);
  });

  it('calculates pay-period numbers for weekly, fortnightly, and monthly runs', () => {
    expect(getPayPeriodNumber('2026-04-06', 'weekly')).toBe(1);
    expect(getPayPeriodNumber('2026-04-20', 'fortnightly')).toBe(2);
    expect(getPayPeriodNumber('2026-06-30', 'monthly')).toBe(3);
  });

  it('uses HMRC tax months for monthly PAYE pay periods', () => {
    expect(getPayPeriodNumber('2026-05-01', 'monthly')).toBe(1);
    expect(getPayPeriodNumber('2026-05-05', 'monthly')).toBe(1);
    expect(getPayPeriodNumber('2026-05-06', 'monthly')).toBe(2);
  });

  it('derives the HMRC payment due date from tax year and tax month', () => {
    expect(getHMRCPaymentDueDate(2026, 1)).toBe('2026-05-19');
    expect(getHMRCPaymentDueDate(2026, 12)).toBe('2027-04-19');
  });

  it('parses standard, Scottish, Welsh, BR, D0, D1, D2, and K tax codes', () => {
    expect(parseTaxCode('1257L')).toMatchObject({
      type: 'standard',
      country: 'england_wales',
      annualAllowance: 12570,
    });
    expect(parseTaxCode('S1257L')).toMatchObject({
      type: 'standard',
      country: 'scotland',
      annualAllowance: 12570,
    });
    expect(parseTaxCode('C1257L')).toMatchObject({
      type: 'standard',
      country: 'wales',
      annualAllowance: 12570,
    });
    expect(parseTaxCode('BR')).toMatchObject({
      type: 'br',
      country: 'england_wales',
      annualAllowance: 0,
    });
    expect(parseTaxCode('D0')).toMatchObject({
      type: 'd0',
      country: 'england_wales',
      annualAllowance: 0,
    });
    expect(parseTaxCode('SD1')).toMatchObject({
      type: 'd1',
      country: 'scotland',
      annualAllowance: 0,
    });
    expect(parseTaxCode('SD2')).toMatchObject({
      type: 'd2',
      country: 'scotland',
      annualAllowance: 0,
    });
    expect(parseTaxCode('K500')).toMatchObject({
      type: 'k_code',
      annualAllowance: -5000,
    });
  });

  it('falls back to the default code when the tax code is missing or invalid', () => {
    expect(parseTaxCode(null)).toMatchObject({
      type: 'default',
      annualAllowance: 12570,
      missingCode: true,
    });
    expect(parseTaxCode('???')).toMatchObject({
      type: 'default',
      annualAllowance: 12570,
      missingCode: true,
    });
  });

  it('strips W1/M1 suffixes without changing the base code classification', () => {
    expect(parseTaxCode('1257L W1')).toMatchObject({
      type: 'standard',
      annualAllowance: 12570,
    });
    expect(parseTaxCode('S1257L M1')).toMatchObject({
      type: 'standard',
      country: 'scotland',
      annualAllowance: 12570,
    });
    expect(parseTaxCode('C1257L W1')).toMatchObject({
      type: 'standard',
      country: 'wales',
      annualAllowance: 12570,
    });
  });

  it('calculates PAYE cumulatively and permits refunds when prior deductions were too high', () => {
    const taxBands = [
      { band_name: 'basic', lower_limit: 0, upper_limit: 37700, rate: 0.20 },
      { band_name: 'higher', lower_limit: 37700, upper_limit: 125140, rate: 0.40 },
      { band_name: 'additional', lower_limit: 125140, upper_limit: null, rate: 0.45 },
    ];
    const parsed = parseTaxCode('1257L');

    const normal = calculatePAYE(2500, parsed, 2, 12, { gross_pay: 2500, tax_deducted: 100 }, taxBands);
    expect(normal.tax).toBeGreaterThanOrEqual(0);
    expect(normal.isRefund).toBe(false);

    const refund = calculatePAYE(0, parsed, 2, 12, { gross_pay: 1000, tax_deducted: 400 }, taxBands);
    expect(refund.tax).toBeLessThan(0);
    expect(refund.isRefund).toBe(true);
  });

  it('taxes Scottish SD2 codes at the flat advanced rate', () => {
    const taxBands = [
      { band_name: 'starter', lower_limit: 0, upper_limit: 2306, rate: 0.19 },
      { band_name: 'basic', lower_limit: 2306, upper_limit: 13991, rate: 0.20 },
      { band_name: 'intermediate', lower_limit: 13991, upper_limit: 31092, rate: 0.21 },
      { band_name: 'higher', lower_limit: 31092, upper_limit: 62570, rate: 0.42 },
      { band_name: 'advanced', lower_limit: 62570, upper_limit: 125140, rate: 0.45 },
      { band_name: 'top', lower_limit: 125140, upper_limit: null, rate: 0.48 },
    ];
    const result = calculatePAYE(5000, parseTaxCode('SD2'), 1, 12, { gross_pay: 0, tax_deducted: 0 }, taxBands);
    expect(result.tax).toBe(2250);
  });

  it('calculates monthly NI from monthly thresholds', () => {
    const niThresholds = [
      { threshold_name: 'PT', weekly_amount: 242, monthly_amount: 1048 },
      { threshold_name: 'UEL', weekly_amount: 967, monthly_amount: 4189 },
      { threshold_name: 'ST', weekly_amount: 175, monthly_amount: 758 },
    ];
    const niRates = [
      { rate_type: 'employee_main', rate: 0.08 },
      { rate_type: 'employee_above_uel', rate: 0.02 },
      { rate_type: 'employer', rate: 0.138 },
    ];

    const result = calculateNI(3000, 'monthly', niThresholds, niRates);
    expect(result).toEqual({ employeeNI: 156.16, employerNI: 309.4 });
  });

  it('calculates fortnightly NI from weekly thresholds', () => {
    const niThresholds = [
      { threshold_name: 'PT', weekly_amount: 242, monthly_amount: 1048 },
      { threshold_name: 'UEL', weekly_amount: 967, monthly_amount: 4189 },
      { threshold_name: 'ST', weekly_amount: 175, monthly_amount: 758 },
    ];
    const niRates = [
      { rate_type: 'employee_main', rate: 0.08 },
      { rate_type: 'employee_above_uel', rate: 0.02 },
      { rate_type: 'employer', rate: 0.138 },
    ];

    const result = calculateNI(2000, 'fortnightly', niThresholds, niRates);
    expect(result).toEqual({ employeeNI: 117.32, employerNI: 227.7 });
  });

  it('supports pensioner, apprentice and Freeport NI categories', () => {
    const niThresholds = [
      { threshold_name: 'ST', weekly_amount: 96, monthly_amount: 417 },
      { threshold_name: 'FUST', weekly_amount: 481, monthly_amount: 2083 },
      { threshold_name: 'PT', weekly_amount: 242, monthly_amount: 1048 },
      { threshold_name: 'UEL', weekly_amount: 967, monthly_amount: 4189 },
      { threshold_name: 'UST', weekly_amount: 967, monthly_amount: 4189 },
    ];

    const categoryC = calculateNI(1000, 'weekly', niThresholds, [
      { rate_type: 'employee_main', rate: 0 },
      { rate_type: 'employee_above_uel', rate: 0 },
      { rate_type: 'employer', rate: 0.15 },
    ]);
    expect(categoryC).toEqual({ employeeNI: 0, employerNI: 135.6 });

    const categoryH = calculateNI(1000, 'weekly', niThresholds, [
      { rate_type: 'employee_main', rate: 0.08 },
      { rate_type: 'employee_above_uel', rate: 0.02 },
      { rate_type: 'employer_above_ust', rate: 0.15 },
    ]);
    expect(categoryH).toEqual({ employeeNI: 58.66, employerNI: 4.95 });

    const categoryF = calculateNI(1000, 'weekly', niThresholds, [
      { rate_type: 'employee_main', rate: 0.08 },
      { rate_type: 'employee_above_uel', rate: 0.02 },
      { rate_type: 'employer_above_fust', rate: 0.15 },
    ]);
    expect(categoryF).toEqual({ employeeNI: 58.66, employerNI: 77.85 });

    const categoryX = calculateNI(1000, 'weekly', niThresholds, [
      { rate_type: 'employee_main', rate: 0 },
      { rate_type: 'employee_above_uel', rate: 0 },
      { rate_type: 'employer', rate: 0 },
    ]);
    expect(categoryX).toEqual({ employeeNI: 0, employerNI: 0 });
  });

  it('calculates student loan deductions across multiple plans', () => {
    const thresholds = [
      { plan: '1', annual_threshold: 26065, rate: 0.09 },
      { plan: 'postgraduate', annual_threshold: 21000, rate: 0.06 },
    ];
    expect(calculateStudentLoan(3000, '1, postgraduate', 'monthly', thresholds)).toBeGreaterThan(0);
    expect(calculateStudentLoan(100, '1', 'monthly', thresholds)).toBe(0);
  });

  it('auto-enrols a worker aged 22+ when gross pay crosses the trigger', () => {
    const pensionConfig = {
      trigger_annual: 10000,
      lower_qualifying_weekly: 120,
      upper_qualifying_weekly: 967,
      employee_rate: 0.05,
      employer_rate: 0.03,
      state_pension_age: 66,
    };

    const result = assessPensionEligibility(
      { date_of_birth: '1990-01-01' },
      1200,
      'monthly',
      pensionConfig,
      '2026-04-30',
    );

    expect(result).toEqual({
      category: 'eligible_jobholder',
      shouldAutoEnrol: true,
      assumedMissingDob: false,
    });
  });

  it('fails safe when DOB is missing by assessing the worker as 22+ based on earnings', () => {
    const pensionConfig = {
      trigger_annual: 10000,
      lower_qualifying_weekly: 120,
      upper_qualifying_weekly: 967,
      employee_rate: 0.05,
      employer_rate: 0.03,
      state_pension_age: 66,
    };

    const result = assessPensionEligibility(
      { date_of_birth: null },
      1200,
      'monthly',
      pensionConfig,
      '2026-04-30',
    );

    expect(result).toEqual({
      category: 'eligible_jobholder',
      shouldAutoEnrol: true,
      assumedMissingDob: true,
    });
  });

  it('calculates employer-only pension contributions when the employee override is zero', () => {
    const pensionConfig = {
      lower_qualifying_weekly: 120,
      upper_qualifying_weekly: 967,
      employee_rate: 0.05,
      employer_rate: 0.03,
    };
    const enrolment = {
      status: 'eligible_enrolled',
      contribution_override_employee: 0,
      contribution_override_employer: 0.03,
    };

    const result = calculatePensionContributions(2500, 'monthly', pensionConfig, enrolment);
    expect(result.employeeAmount).toBe(0);
    expect(result.employerAmount).toBeGreaterThan(0);
    expect(result.qualifyingEarnings).toBeGreaterThan(0);
  });

  it('selects the latest SSP config effective on or before the pay date', () => {
    const configs = [
      { effective_from: '2025-04-06', weekly_rate: 118.75 },
      { effective_from: '2026-04-06', weekly_rate: 123.25 },
    ];
    expect(getSSPConfig('2026-04-20', configs)).toMatchObject({ weekly_rate: 123.25 });
    expect(getSSPConfig('2025-05-01', configs)).toMatchObject({ weekly_rate: 118.75 });
    expect(getSSPConfig('2025-03-01', configs)).toBeNull();
  });

  it('applies SSP waiting days and pays from the fourth qualifying day', () => {
    const sspConfig = { weekly_rate: 118.75, waiting_days: 3, max_weeks: 28, lel_weekly: null };
    const sickPeriod = {
      start_date: '2026-04-06',
      end_date: null,
      qualifying_days_per_week: 5,
      waiting_days_served: 0,
      ssp_weeks_paid: 0,
    };

    expect(calculateSSP(sickPeriod, '2026-04-06', sspConfig)).toEqual({
      eligible: false,
      sspAmount: 0,
      sspDays: 0,
      waitingDaysUsed: 1,
    });
    expect(calculateSSP(sickPeriod, '2026-04-09', sspConfig)).toMatchObject({
      eligible: true,
      sspDays: 1,
      waitingDaysUsed: 0,
    });
  });

  it('does not pay SSP on weekends or below-LEL earnings', () => {
    const sspConfig = { weekly_rate: 118.75, waiting_days: 0, max_weeks: 28, lel_weekly: 123 };
    const sickPeriod = {
      start_date: '2026-04-06',
      end_date: null,
      qualifying_days_per_week: 5,
      waiting_days_served: 0,
      ssp_weeks_paid: 0,
    };

    expect(calculateSSP(sickPeriod, '2026-04-12', sspConfig, 500)).toEqual({
      eligible: false,
      sspAmount: 0,
      sspDays: 0,
      waitingDaysUsed: 0,
    });
    expect(calculateSSP(sickPeriod, '2026-04-10', sspConfig, 100)).toEqual({
      eligible: false,
      sspAmount: 0,
      sspDays: 0,
      waitingDaysUsed: 0,
    });
  });

  it('pays SSP on weekend qualifying days for six and seven day rotas', () => {
    const sspConfig = { weekly_rate: 118.75, waiting_days: 0, max_weeks: 28, lel_weekly: null };
    const sixDayPeriod = {
      start_date: '2026-04-06',
      end_date: null,
      qualifying_days_per_week: 6,
      waiting_days_served: 0,
      ssp_weeks_paid: 0,
    };
    const sevenDayPeriod = {
      ...sixDayPeriod,
      qualifying_days_per_week: 7,
    };

    expect(calculateSSP(sixDayPeriod, '2026-04-11', sspConfig, 500)).toEqual({
      eligible: true,
      sspAmount: 19.79,
      sspDays: 1,
      waitingDaysUsed: 0,
    });
    expect(calculateSSP(sevenDayPeriod, '2026-04-12', sspConfig, 500)).toEqual({
      eligible: true,
      sspAmount: 16.97,
      sspDays: 1,
      waitingDaysUsed: 0,
    });
  });

  it('uses cumulative SSP rounding so weekly totals reconcile', () => {
    const sspConfig = { weekly_rate: 123.25, waiting_days: 0, max_weeks: 28, lel_weekly: null };
    const sixDayPeriod = {
      start_date: '2026-04-06',
      end_date: null,
      qualifying_days_per_week: 6,
      waiting_days_served: 0,
      ssp_weeks_paid: 0,
    };

    expect(calculateSSP(sixDayPeriod, '2026-04-06', sspConfig, 500)).toMatchObject({
      eligible: true,
      sspAmount: 20.55,
    });
    expect(calculateSSP(sixDayPeriod, '2026-04-11', sspConfig, 500)).toMatchObject({
      eligible: true,
      sspAmount: 20.54,
    });
  });

  it('resets cumulative SSP rounding at each Sunday-to-Saturday SSP week', () => {
    const sspConfig = { weekly_rate: 123.25, waiting_days: 0, max_weeks: 28, lel_weekly: null };
    const sixDayPeriod = {
      start_date: '2026-04-08',
      end_date: null,
      qualifying_days_per_week: 6,
      waiting_days_served: 0,
      ssp_weeks_paid: 0,
    };

    expect(calculateSSP(sixDayPeriod, '2026-04-13', sspConfig, 500)).toMatchObject({
      eligible: true,
      sspAmount: 20.55,
    });
    expect(calculateSSP(sixDayPeriod, '2026-04-14', sspConfig, 500)).toMatchObject({
      eligible: true,
      sspAmount: 20.54,
    });
  });

  it('uses persisted SSP qualifying weekdays for non-standard rotas', () => {
    const sspConfig = { weekly_rate: 118.75, waiting_days: 0, max_weeks: 28, lel_weekly: null };
    const wedToSunPeriod = {
      start_date: '2026-04-08',
      end_date: null,
      qualifying_days_per_week: 5,
      qualifying_weekdays: [3, 4, 5, 6, 0],
      waiting_days_served: 0,
      ssp_weeks_paid: 0,
    };

    expect(calculateSSP(wedToSunPeriod, '2026-04-12', sspConfig, 500)).toEqual({
      eligible: true,
      sspAmount: 23.75,
      sspDays: 1,
      waitingDaysUsed: 0,
    });
    expect(calculateSSP(wedToSunPeriod, '2026-04-13', sspConfig, 500)).toEqual({
      eligible: false,
      sspAmount: 0,
      sspDays: 0,
      waitingDaysUsed: 0,
    });
  });

  it('stops SSP once the max-weeks cap is reached', () => {
    const sspConfig = { weekly_rate: 118.75, waiting_days: 0, max_weeks: 28, lel_weekly: null };
    const sickPeriod = {
      start_date: '2026-04-06',
      end_date: null,
      qualifying_days_per_week: 5,
      waiting_days_served: 0,
      ssp_weeks_paid: 28,
    };
    expect(calculateSSP(sickPeriod, '2026-04-10', sspConfig, 500)).toEqual({
      eligible: false,
      sspAmount: 0,
      sspDays: 0,
      waitingDaysUsed: 0,
    });
  });
});
