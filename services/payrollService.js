/**
 * payrollService.js — Business logic for payroll calculation, approval, export, and seeding.
 *
 * Import chain:
 *   routes/payroll.js → payrollService → repos + shared/rotation.js + shared/payroll.js
 *
 * Shared libs (rotation, payroll, payrollTax) live in shared/ — pure ESM, no browser/React deps.
 */

import { pool, withTransaction } from '../db.js';
import * as homeRepo        from '../repositories/homeRepo.js';
import * as staffRepo       from '../repositories/staffRepo.js';
import * as overrideRepo    from '../repositories/overrideRepo.js';
import * as payRateRulesRepo from '../repositories/payRateRulesRepo.js';
import * as timesheetRepo   from '../repositories/timesheetRepo.js';
import * as payrollRunRepo  from '../repositories/payrollRunRepo.js';
import * as auditRepo       from '../repositories/auditRepo.js';
import * as taxRepo         from '../repositories/taxRepo.js';
import * as pensionRepo     from '../repositories/pensionRepo.js';
import * as sspRepo         from '../repositories/sspRepo.js';
import * as hmrcRepo        from '../repositories/hmrcRepo.js';

import {
  getActualShift,
  isBankHoliday,
  isWorkingShift,
  isAgencyShift,
} from '../shared/rotation.js';

import {
  calculateShiftPay,
  checkNMWCompliance,
  getDefaultShiftHours,
  buildSageCSV,
  buildGenericCSV,
} from '../shared/payroll.js';

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
  getTaxYear,
  getHMRCTaxMonth,
  getHMRCPaymentDueDate,
} from '../shared/payrollTax.js';

import { NotFoundError, ValidationError } from '../errors.js';

// Zero-value YTD — used when no approved run exists yet this tax year
const ZERO_YTD = { gross_pay: 0, taxable_pay: 0, tax_deducted: 0, employee_ni: 0, employer_ni: 0, student_loan: 0, pension_employee: 0, pension_employer: 0 };

// ── Default Pay Rate Rules (seeded once per home on first payroll access) ──────

const DEFAULT_RULES = [
  { name: 'Night Enhancement',     rate_type: 'percentage',    amount: 15,   applies_to: 'night',       priority: 0, effective_from: '2020-01-01' },
  { name: 'Saturday Enhancement',  rate_type: 'percentage',    amount: 10,   applies_to: 'weekend_sat', priority: 0, effective_from: '2020-01-01' },
  { name: 'Sunday Enhancement',    rate_type: 'percentage',    amount: 20,   applies_to: 'weekend_sun', priority: 0, effective_from: '2020-01-01' },
  { name: 'Bank Holiday Premium',  rate_type: 'percentage',    amount: 50,   applies_to: 'bank_holiday',priority: 0, effective_from: '2020-01-01' },
  { name: 'Sleep-in Flat Rate',    rate_type: 'flat_per_shift',amount: 50,   applies_to: 'sleep_in',    priority: 0, effective_from: '2020-01-01' },
  { name: 'Overtime Premium',      rate_type: 'fixed_hourly',  amount: 2.00, applies_to: 'overtime',    priority: 0, effective_from: '2020-01-01' },
  { name: 'On-Call Premium',       rate_type: 'fixed_hourly',  amount: 2.00, applies_to: 'on_call',     priority: 0, effective_from: '2020-01-01' },
];

/**
 * Seed default pay rate rules for a home if none exist yet.
 * Idempotent — checks count before inserting.
 */
export async function seedDefaultRulesIfNeeded(homeId, client) {
  const count = await payRateRulesRepo.countActiveByHome(homeId, client);
  if (count > 0) return;
  for (const rule of DEFAULT_RULES) {
    await payRateRulesRepo.create(homeId, rule, client);
  }
}

// ── Payroll Run Calculation ────────────────────────────────────────────────────

/**
 * Calculate gross pay for all active staff in a payroll run.
 * Wipes existing lines/shifts and recalculates from scratch (safe to re-run on draft).
 *
 * Algorithm per date per staff:
 *   1. getActualShift (override or pattern fallback)
 *   2. Skip non-working and agency shifts
 *   3. Hours: approved timesheet > config default
 *   4. calculateShiftPay (base + stacked enhancements)
 *   5. checkNMWCompliance
 *   6. Accumulate into payroll_line, insert payroll_line_shift
 *
 * @param {number} runId
 * @param {number} homeId
 * @param {string} homeSlug
 * @param {string} username  — from JWT, for audit log
 */
export async function calculateRun(runId, homeId, homeSlug, username) {
  return withTransaction(async (client) => {
    const run = await payrollRunRepo.findByIdForUpdate(runId, homeId, client);
    if (!run) throw new NotFoundError('Payroll run not found');
    if (!['draft', 'calculated'].includes(run.status)) {
      throw new ValidationError(`Cannot recalculate a run with status '${run.status}'`);
    }

    const home = await homeRepo.findById(homeId, client);
    if (!home) throw new NotFoundError('Home not found');

    const allStaffResult = await staffRepo.findByHome(homeId, {}, client);
    const allStaff    = allStaffResult.rows;
    const overrides   = await overrideRepo.findByHome(homeId, undefined, undefined, client);
    const rules       = await payRateRulesRepo.findForPeriod(homeId, run.period_start, run.period_end);
    const nmwRates    = await payRateRulesRepo.getAllNmwRates();

    // Wipe existing lines (cascades to payroll_line_shifts)
    await payrollRunRepo.deleteLines(runId, homeId, client);

    const dates = eachDayInRange(run.period_start, run.period_end);
    // Include staff who were active during any part of the period.
    // A carer deactivated mid-period still needs paying for days worked.
    const activeStaff = allStaff.filter(s =>
      s.active || (s.leaving_date && s.leaving_date >= run.period_start)
    );

    // Pre-load SSP configs once for the run (pick the right row per date inside the loop)
    const allSSPConfigs = await sspRepo.getAllSSPConfigs(client);

    // Pre-load constant tax/pension config once for the run (same for all staff)
    const taxYear       = getTaxYear(new Date(run.period_end));
    const periodsInYear = run.pay_frequency === 'weekly' ? 52 : run.pay_frequency === 'fortnightly' ? 26 : 12;
    const payPeriod     = getPayPeriodNumber(run.period_end, run.pay_frequency);
    const niThresholds  = await taxRepo.getNIThresholds(taxYear, client);
    const slThresholds  = await taxRepo.getStudentLoanThresholds(taxYear, client);
    const pensionConf   = await pensionRepo.getPensionConfig(run.period_end, client);
    const taxBandsCache = new Map();
    const niRatesCache  = new Map();

    // Payroll run totals (accumulated across all staff)
    let totalGross = 0;
    let totalEnhancements = 0;
    let totalSleepIns = 0;

    for (const s of activeStaff) {
      const line = await payrollRunRepo.createLine(runId, s.id, client);

      // Per-staff accumulators (gross pay components)
      const acc = {
        base_hours: 0, base_pay: 0,
        night_hours: 0, night_enhancement: 0,
        weekend_hours: 0, weekend_enhancement: 0,
        bank_holiday_hours: 0, bank_holiday_enhancement: 0,
        overtime_hours: 0, overtime_enhancement: 0,
        sleep_in_count: 0, sleep_in_pay: 0,
        on_call_hours: 0, on_call_enhancement: 0,
        total_hours: 0, total_enhancements: 0, gross_pay: 0,
        // Phase 2 additions
        holiday_days: 0, holiday_pay: 0,
        ssp_days: 0, ssp_amount: 0, enhanced_sick_amount: 0,
      };

      let nmwCompliant = true;
      let nmwLowest = Infinity;
      const nmwWarnings = [];

      for (const date of dates) {
        // Skip dates after staff left (deactivated mid-period leavers)
        if (s.leaving_date && date > s.leaving_date) continue;

        const actualShift = getActualShift(s, date, overrides, home.config.cycle_start_date);
        const { shift, sleep_in } = actualShift;

        // ── Phase 2: Annual Leave → Holiday Pay ──
        if (shift === 'AL') {
          const dailyRate = await calculateHolidayDailyRate(homeId, s.id, date, client, home.config, s);
          acc.holiday_days += 1;
          acc.holiday_pay = round2(acc.holiday_pay + dailyRate);
          // Record as a shift so lookback query can find it
          await payrollRunRepo.createLineShift(line.id, {
            date, shift_code: 'AL', hours: 0, base_rate: 0, base_amount: 0,
            enhancements_json: [], total_amount: dailyRate, effective_hourly_rate: 0,
          }, client);
          continue;
        }

        // ── Phase 2: Sick → SSP ──
        if (shift === 'SICK') {
          const sspConfig = getSSPConfig(date, allSSPConfigs);
          if (sspConfig) {
            const sickPeriod = await sspRepo.getActiveSickPeriod(homeId, s.id, date, date, client);
            if (sickPeriod) {
              const r = calculateSSP(sickPeriod, date, sspConfig);
              if (r.eligible) {
                acc.ssp_days += r.sspDays;
                acc.ssp_amount = round2(acc.ssp_amount + r.sspAmount);
              }
            }
          }
          continue;
        }

        // Skip non-working and agency (agency tracked separately)
        if (!isWorkingShift(shift) || isAgencyShift(shift)) continue;

        // Hours: approved/locked timesheet > config default
        const ts = await timesheetRepo.findByStaffDate(homeId, s.id, date, client);
        let hours;
        if (ts && ['approved', 'locked'].includes(ts.status) && ts.payable_hours != null) {
          hours = parseFloat(ts.payable_hours);
        } else {
          hours = getDefaultShiftHours(shift, home.config);
        }

        if (!hours || hours <= 0) continue;

        const isBH = isBankHoliday(date, home.config);
        const result = calculateShiftPay(shift, date, s, rules, home.config, !!sleep_in, isBH);

        // NMW compliance check
        const nmw = checkNMWCompliance(s, date, result.total, result.hours, nmwRates);
        if (!nmw.compliant) nmwCompliant = false;
        if (nmw.effectiveRate > 0 && nmw.effectiveRate < nmwLowest) nmwLowest = nmw.effectiveRate;
        if (nmw.warning) nmwWarnings.push(`${date}: ${nmw.warning}`);

        // Insert shift detail
        await payrollRunRepo.createLineShift(line.id, {
          date,
          shift_code:           shift,
          hours:                result.hours,
          base_rate:            parseFloat(s.hourly_rate),
          base_amount:          result.basePay,
          enhancements_json:    result.enhancements,
          total_amount:         result.total,
          effective_hourly_rate: nmw.effectiveRate,
        }, client);

        // Accumulate by enhancement type
        acc.base_hours += hours;
        acc.base_pay   += result.basePay;
        acc.total_hours += hours;

        for (const e of result.enhancements) {
          switch (e.type) {
            case 'night':
              acc.night_hours += hours;
              acc.night_enhancement += e.enhancementAmount;
              break;
            case 'weekend_sat':
            case 'weekend_sun':
              acc.weekend_hours += hours;
              acc.weekend_enhancement += e.enhancementAmount;
              break;
            case 'bank_holiday':
              acc.bank_holiday_hours += hours;
              acc.bank_holiday_enhancement += e.enhancementAmount;
              break;
            case 'overtime':
              acc.overtime_hours += hours;
              acc.overtime_enhancement += e.enhancementAmount;
              break;
            case 'sleep_in':
              acc.sleep_in_count += 1;
              acc.sleep_in_pay += e.enhancementAmount;
              break;
            case 'on_call':
              acc.on_call_hours += hours;
              acc.on_call_enhancement += e.enhancementAmount;
              break;
          }
        }
      }

      // Round gross accumulators
      for (const k of Object.keys(acc)) {
        acc[k] = round2(acc[k]);
      }
      acc.total_enhancements = round2(
        acc.night_enhancement + acc.weekend_enhancement +
        acc.bank_holiday_enhancement + acc.overtime_enhancement +
        acc.sleep_in_pay + acc.on_call_enhancement,
      );
      acc.gross_pay = round2(acc.base_pay + acc.total_enhancements);

      // ── Phase 2: Deductions block ──────────────────────────────────────────

      const taxCodeRow = await taxRepo.getTaxCodeForStaff(homeId, s.id, run.period_end, client);
      const parsedCode = parseTaxCode(taxCodeRow?.tax_code || null);
      // Preserve basis from DB record (cumulative vs w1m1)
      if (taxCodeRow?.basis) parsedCode.basis = taxCodeRow.basis;

      // YTD: read from approved runs only — never written here (written in approveRun)
      const priorYTD = await taxRepo.getYTD(homeId, s.id, taxYear, client) || ZERO_YTD;

      // Tax bands and NI rates: cached by country/category (same for most staff)
      const country = parsedCode.country;
      if (!taxBandsCache.has(country)) {
        taxBandsCache.set(country, await taxRepo.getTaxBands(country, taxYear, client));
      }
      const taxBands = taxBandsCache.get(country);

      const niCat = taxCodeRow?.ni_category || 'A';
      if (!niRatesCache.has(niCat)) {
        niRatesCache.set(niCat, await taxRepo.getNIRates(taxYear, niCat, client));
      }
      const niRates = niRatesCache.get(niCat);

      // Build notes array early — pension auto-enrolment may append
      const notesParts = [];
      if (parsedCode.missingCode) notesParts.push('WARNING: No tax code found — defaulted to 1257L');
      if (nmwWarnings.length > 0) notesParts.push(...nmwWarnings);

      // Gross for deductions = base pay + enhancements + holiday pay + SSP
      const grossForTax = round2(acc.gross_pay + acc.holiday_pay + acc.ssp_amount);

      const { tax, isRefund: _isRefund } = calculatePAYE(grossForTax, parsedCode, payPeriod, periodsInYear, priorYTD, taxBands);
      const taxDeducted = round2(tax); // may be negative (refund) — passed through to net pay

      const { employeeNI, employerNI } = calculateNI(grossForTax, run.pay_frequency, niThresholds, niRates);

      const planStr    = taxCodeRow?.student_loan_plan || null;
      const studentLoan = planStr ? calculateStudentLoan(grossForTax, planStr, run.pay_frequency, slThresholds) : 0;

      // Pension contributions — auto-enrol if eligible (Pensions Act 2008)
      let enrolment = await pensionRepo.getEnrolment(homeId, s.id, client);
      if (pensionConf && (!enrolment || enrolment.status === 'pending_assessment')) {
        const eligibility = assessPensionEligibility(s, grossForTax, run.pay_frequency, pensionConf, run.period_end);
        if (eligibility.shouldAutoEnrol) {
          await pensionRepo.upsertEnrolment(homeId, {
            staff_id: s.id, status: 'eligible_enrolled',
            enrolment_date: run.period_end, opt_in_date: null,
          }, client);
          // Set enrolment in-memory — calculatePensionContributions only needs .status
          enrolment = { staff_id: s.id, status: 'eligible_enrolled', enrolment_date: run.period_end };
          notesParts.push('AUTO-ENROLLED: Pension auto-enrolment triggered');
        }
      }
      let pensionEmployee = 0, pensionEmployer = 0;
      if (pensionConf && enrolment && ['eligible_enrolled', 'opt_in_enrolled'].includes(enrolment.status)) {
        const pr = calculatePensionContributions(grossForTax, run.pay_frequency, pensionConf, enrolment);
        pensionEmployee = pr.employeeAmount;
        pensionEmployer = pr.employerAmount;
        // Record contribution row (deletes+recreates on recalculate via cascade on payroll_lines)
        if (pr.employeeAmount > 0) {
          await pensionRepo.insertContribution(homeId, {
            payroll_line_id: line.id,
            staff_id: s.id,
            qualifying_pay: pr.qualifyingEarnings,
            employee_amount: pr.employeeAmount,
            employer_amount: pr.employerAmount,
          }, client);
        }
      }

      // taxDeducted may be negative (refund) — subtracting a negative increases net pay.
      // HMRC requires PAYE refunds to be paid through the payroll, not clamped to zero.
      const netPay = round2(grossForTax - taxDeducted - employeeNI - pensionEmployee - studentLoan);

      await payrollRunRepo.updateLine(line.id, homeId, {
        ...acc,
        nmw_compliant:   nmwCompliant,
        nmw_lowest_rate: nmwLowest === Infinity ? null : round2(nmwLowest),
        notes:           notesParts.length > 0 ? notesParts.join('; ') : null,
      }, client);

      await payrollRunRepo.updateLineDeductions(line.id, homeId, {
        holiday_days:        acc.holiday_days,
        holiday_pay:         acc.holiday_pay,
        holiday_daily_rate:  acc.holiday_days > 0 ? round2(acc.holiday_pay / acc.holiday_days) : null,
        ssp_days:            acc.ssp_days,
        ssp_amount:          acc.ssp_amount,
        enhanced_sick_amount: acc.enhanced_sick_amount,
        pension_employee:    pensionEmployee,
        pension_employer:    pensionEmployer,
        tax_deducted:        taxDeducted,
        employee_ni:         employeeNI,
        employer_ni:         employerNI,
        student_loan:        studentLoan,
        other_deductions:    0,
        net_pay:             netPay,
      }, client);

      totalGross        += round2(acc.gross_pay + acc.holiday_pay + acc.ssp_amount);
      totalEnhancements += acc.total_enhancements;
      totalSleepIns     += acc.sleep_in_pay;
    }

    await payrollRunRepo.updateTotals(runId, homeId, {
      total_gross:        round2(totalGross),
      total_enhancements: round2(totalEnhancements),
      total_sleep_ins:    round2(totalSleepIns),
      staff_count:        activeStaff.length,
    }, client, run.version);

    await auditRepo.log('payroll_calculate', homeSlug, username, `Run ID ${runId}`, client);
  });
}

// ── Payroll Run Approval ───────────────────────────────────────────────────────

/**
 * Approve a payroll run. Blocks if any payroll_line has nmw_compliant = false.
 * On approval: locks all approved timesheets for the period.
 */
export async function approveRun(runId, homeId, homeSlug, username) {
  return withTransaction(async (client) => {
    const run = await payrollRunRepo.findByIdForUpdate(runId, homeId, client);
    if (!run) throw new NotFoundError('Payroll run not found');
    if (run.status !== 'calculated') {
      throw new ValidationError(`Can only approve a 'calculated' run (current status: '${run.status}')`);
    }

    const hasViolations = await payrollRunRepo.hasNmwViolations(runId, homeId, client);
    if (hasViolations) {
      throw new ValidationError(
        'Payroll cannot be approved: one or more staff members are below National Minimum Wage. ' +
        'Review the NMW flags in the payroll detail before approving.',
      );
    }

    await payrollRunRepo.updateStatus(runId, homeId, 'approved', { approved_by: username }, client, run.version);

    // Lock all approved timesheets for the period (prevents further edits)
    await timesheetRepo.lockByPeriod(homeId, run.period_start, run.period_end, client);

    // ── Phase 2: Write YTD and HMRC liability ─────────────────────────────────

    // Guard: skip YTD upsert if already applied (prevents double-counting on re-approval)
    if (run.ytd_applied) {
      throw new ValidationError(
        'YTD has already been applied for this run. Void the run and create a new one to make corrections.',
      );
    }

    const taxYear  = getTaxYear(new Date(run.period_end));
    const taxMonth = getHMRCTaxMonth(new Date(run.period_end));
    const lines    = await payrollRunRepo.findLinesByRun(runId, homeId, client);

    // Write YTD increments for each staff member (upsert — adds to existing YTD)
    for (const l of lines) {
      const grossWithExtras = round2((l.gross_pay || 0) + (l.holiday_pay || 0) + (l.ssp_amount || 0));
      const taxablePay = round2(grossWithExtras - (l.pension_employee || 0));
      await taxRepo.upsertYTD(homeId, l.staff_id, taxYear, {
        gross_pay:        grossWithExtras,
        taxable_pay:      taxablePay,
        tax_deducted:     l.tax_deducted || 0,
        employee_ni:      l.employee_ni  || 0,
        employer_ni:      l.employer_ni  || 0,
        student_loan:     l.student_loan || 0,
        pension_employee: l.pension_employee || 0,
        pension_employer: l.pension_employer || 0,
        holiday_pay:      l.holiday_pay  || 0,
        ssp_amount:       l.ssp_amount   || 0,
        net_pay:          l.net_pay      || 0,
      }, client);
    }

    // Mark YTD as applied so re-approval cannot double-count
    await payrollRunRepo.markYtdApplied(runId, homeId, client);

    // Accumulate HMRC liability totals for this run and upsert into monthly tracker
    const totals = lines.reduce((acc, l) => ({
      paye:   round2(acc.paye   + (l.tax_deducted || 0)),
      emp_ni: round2(acc.emp_ni + (l.employee_ni  || 0)),
      er_ni:  round2(acc.er_ni  + (l.employer_ni  || 0)),
    }), { paye: 0, emp_ni: 0, er_ni: 0 });

    await hmrcRepo.upsertLiability(homeId, taxYear, taxMonth, {
      period_start: run.period_start,
      period_end:   run.period_end,
      total_paye:         totals.paye,
      total_employee_ni:  totals.emp_ni,
      total_employer_ni:  totals.er_ni,
      employment_allowance_offset: 0,
      total_due: round2(totals.paye + totals.emp_ni + totals.er_ni),
      payment_due_date: getHMRCPaymentDueDate(taxYear, taxMonth),
      status: 'unpaid',
    }, client);

    await auditRepo.log('payroll_approve', homeSlug, username, `Run ID ${runId}`, client);
  });
}

// ── CSV Export ────────────────────────────────────────────────────────────────

/**
 * Generate CSV export for an approved/exported payroll run.
 * format: 'sage' | 'xero' | 'generic'
 * Returns { csv: string, filename: string }
 */
export async function exportRunCSV(runId, homeId, homeSlug, username, format) {
  return withTransaction(async (client) => {
    const run = await payrollRunRepo.findById(runId, homeId, client);
    if (!run) throw new NotFoundError('Payroll run not found');
    if (!['approved', 'exported', 'locked'].includes(run.status)) {
      throw new ValidationError('Payroll run must be approved before exporting');
    }

    const lines    = await payrollRunRepo.findLinesByRun(runId, homeId, client);
    const allStaffResult = await staffRepo.findByHome(homeId, {}, client);
    const allStaff = allStaffResult.rows;
    const staffMap = new Map(allStaff.map(s => [s.id, s]));

    // Load YTD for each staff member for the CSV
    const taxYear = getTaxYear(new Date(run.period_end));
    const ytdMap = new Map();
    await Promise.all(
      lines.map(async line => {
        const ytd = await taxRepo.getYTD(homeId, line.staff_id, taxYear, client);
        if (ytd) ytdMap.set(line.staff_id, ytd);
      })
    );

    const csv = format === 'sage'
      ? buildSageCSV(lines, staffMap, run, ytdMap)
      : buildGenericCSV(lines, staffMap, run, ytdMap);

    const filename = `payroll_${homeSlug}_${run.period_start}_to_${run.period_end}_${format}.csv`;

    // Mark as exported (idempotent — OK to export multiple times)
    if (run.status === 'approved') {
      await payrollRunRepo.updateStatus(runId, homeId, 'exported', {
        exported_at: true,
        export_format: format,
      }, client);
    }

    await auditRepo.log('payroll_export', homeSlug, username, `Run ID ${runId} format=${format}`, client);

    return { csv, filename };
  });
}

// ── Holiday Daily Rate (52-week lookback) ─────────────────────────────────────

/**
 * Calculate the holiday daily rate for a staff member using a 52-week lookback.
 *
 * Uses a single aggregating SQL query — not a per-week loop — for performance at scale.
 * Index on payroll_line_shifts(payroll_line_id, date) added in migration 029.
 *
 * Note: The lookback includes all paid shifts, including overtime. Per Harpur Trust v Brazel
 * (2022), holiday pay should include regular overtime and shift premiums. Including occasional
 * OT is the safe position — excluding it risks underpayment claims. Accepted behaviour.
 *
 * Falls back to (contract_hours/5) × hourly_rate if fewer than 12 paid weeks of history.
 */
async function calculateHolidayDailyRate(homeId, staffId, holidayDate, client, config, staff) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `WITH weekly AS (
       SELECT date_trunc('week', pls.date) AS week_start,
              SUM(pls.total_amount) AS week_pay,
              COUNT(DISTINCT pls.date)::int AS days_worked
       FROM payroll_line_shifts pls
       JOIN payroll_lines pl ON pl.id = pls.payroll_line_id
       JOIN payroll_runs pr ON pr.id = pl.payroll_run_id
       WHERE pr.home_id = $1
         AND pl.staff_id = $2
         AND pls.date < $3
         AND pls.date >= $3::date - INTERVAL '104 weeks'
         AND pls.shift_code NOT IN ('AL','SICK','OFF','AVL')
         AND pr.status IN ('approved','exported','locked')
       GROUP BY week_start
     ),
     paid_52 AS (SELECT * FROM weekly WHERE week_pay > 0 ORDER BY week_start DESC LIMIT 52)
     SELECT
       COALESCE(SUM(week_pay), 0)    AS total_pay,
       COALESCE(SUM(days_worked), 0) AS total_days,
       COUNT(*)::int                  AS weeks_used
     FROM paid_52`,
    [homeId, staffId, holidayDate],
  );

  const { total_pay, total_days, weeks_used } = rows[0];
  const weeksUsed = parseInt(weeks_used, 10);
  const totalDays = parseInt(total_days, 10);
  const totalPay  = parseFloat(total_pay);

  if (weeksUsed >= 12 && totalDays > 0) {
    return round2(totalPay / totalDays);
  }

  // Fallback: contracted daily rate
  if (!staff) return 0;
  const contractHours = parseFloat(staff.contract_hours) || 0;
  const hourlyRate = parseFloat(staff.hourly_rate) || 0;
  const contractDailyRate = round2((contractHours / 5) * hourlyRate);
  return contractDailyRate;
}

// ── Payslip Assembly ──────────────────────────────────────────────────────────

/**
 * Assemble payslip data for one or all staff in a run.
 * staffId: optional — if null, returns data for all staff.
 * Returns array of payslip objects (one per staff).
 */
export async function assemblePayslipData(runId, homeId, staffId) {
  const run   = await payrollRunRepo.findById(runId, homeId);
  if (!run) throw new NotFoundError('Payroll run not found');

  const home  = await homeRepo.findById(homeId);
  if (!home) throw new NotFoundError('Home not found');
  const lines = await payrollRunRepo.findLinesByRun(runId, homeId);
  const shifts = await payrollRunRepo.findShiftsByRun(runId, homeId);

  const allStaffResult = await staffRepo.findByHome(homeId);
  const allStaff = allStaffResult.rows;
  const staffMap = new Map(allStaff.map(s => [s.id, s]));

  // Group shifts by staff_id
  const shiftsByStaff = {};
  for (const s of shifts) {
    if (!shiftsByStaff[s.staff_id]) shiftsByStaff[s.staff_id] = [];
    shiftsByStaff[s.staff_id].push(s);
  }

  const targetLines = staffId
    ? lines.filter(l => l.staff_id === staffId)
    : lines;

  // Fetch YTD for approved runs (null for draft/calculated — payslip shows "Estimated")
  const isApproved = ['approved', 'exported', 'locked'].includes(run.status);
  const taxYear = getTaxYear(new Date(run.period_end));
  const ytdMap = new Map();
  if (isApproved) {
    for (const line of targetLines) {
      const ytd = await taxRepo.getYTD(homeId, line.staff_id, taxYear);
      if (ytd) ytdMap.set(line.staff_id, ytd);
    }
  }

  return targetLines.map(line => ({
    run,
    line,
    staff: staffMap.get(line.staff_id) || { id: line.staff_id, name: 'Unknown' },
    home: { name: home?.config?.home_name || home?.name, config: home?.config },
    shifts: shiftsByStaff[line.staff_id] || [],
    ytd: ytdMap.get(line.staff_id) || null,
    ytdEstimated: !isApproved,
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Generate array of 'YYYY-MM-DD' date strings from start to end inclusive.
 * No external date library — pure Date arithmetic.
 */
export function eachDayInRange(start, end) {
  const dates = [];
  const s = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  const cur = new Date(s);
  while (cur <= e) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
