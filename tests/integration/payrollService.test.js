/**
 * Integration tests for payrollService.js — covers the full payroll lifecycle:
 *   seed rules → create run → calculate → approve → export → payslip assembly
 *
 * Requires: PostgreSQL running with all migrations applied.
 *
 * Staff setup: 4 staff with varied rates/roles, including one below NMW
 * to exercise flagging logic. Shift overrides create a realistic 2-week
 * period with early, late, night, overtime, and off shifts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db.js';
import {
  seedDefaultRulesIfNeeded,
  calculateRun,
  approveRun,
  exportRunCSV,
  assemblePayslipData,
  eachDayInRange,
} from '../../services/payrollService.js';
import * as payrollRunRepo from '../../repositories/payrollRunRepo.js';
import * as staffRepo from '../../repositories/staffRepo.js';
import { NotFoundError, ValidationError } from '../../errors.js';

// ── Test constants ────────────────────────────────────────────────────────────

const SLUG       = 'test-payroll-integ';
const HOME_NAME  = 'Payroll Integration Test Home';
const USERNAME   = 'test-payroll-admin';
const PERIOD_START = '2025-11-03'; // Monday
const PERIOD_END   = '2025-11-16'; // Sunday (2 weeks)
const CYCLE_START  = '2025-01-06'; // Panama cycle anchor

// Shift config matching the production schema
const HOME_CONFIG = {
  home_name: HOME_NAME,
  registered_beds: 30,
  care_type: 'residential',
  cycle_start_date: CYCLE_START,
  shifts: {
    E:  { hours: 8, start: '07:00', end: '15:00' },
    L:  { hours: 8, start: '14:00', end: '22:00' },
    EL: { hours: 12, start: '07:00', end: '19:00' },
    N:  { hours: 10, start: '21:00', end: '07:00' },
  },
  minimum_staffing: {
    early:  { heads: 3, skill_points: 3 },
    late:   { heads: 3, skill_points: 3 },
    night:  { heads: 2, skill_points: 2 },
  },
  agency_rate_day: 22, agency_rate_night: 25,
  ot_premium: 2, bh_premium_multiplier: 1.5,
  max_consecutive_days: 6, max_al_same_day: 2,
  al_entitlement_days: 28, leave_year_start: '04-01',
  bank_holidays: [],
};

// 4 test staff: varied rates, one below NMW (£10/hr for 21+)
const TEST_STAFF = [
  { id: 'TP01', name: 'Alice Senior',   role: 'Senior Carer', team: 'Day A', pref: 'E',  skill: 2, hourly_rate: 14.50, active: true, wtr_opt_out: false, start_date: '2024-01-15', date_of_birth: '1990-05-01', contract_hours: 37.5 },
  { id: 'TP02', name: 'Bob Carer',      role: 'Carer',        team: 'Day B', pref: 'L',  skill: 1, hourly_rate: 12.50, active: true, wtr_opt_out: false, start_date: '2024-06-01', date_of_birth: '1998-11-20', contract_hours: 37.5 },
  { id: 'TP03', name: 'Carol Night',    role: 'Night Carer',  team: 'Night A', pref: null, skill: 1, hourly_rate: 13.00, active: true, wtr_opt_out: true,  start_date: '2023-09-01', date_of_birth: '1985-03-12', contract_hours: 40 },
  { id: 'TP04', name: 'Dave Underpaid', role: 'Carer',        team: 'Day A', pref: 'E',  skill: 1, hourly_rate: 10.00, active: true, wtr_opt_out: false, start_date: '2025-01-10', date_of_birth: '2000-08-30', contract_hours: 37.5 },
];

// ── Shared state ──────────────────────────────────────────────────────────────

let homeId;
let runId;

// ── Setup & Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Clean up from any prior failed run
  await cleanup();

  // Create test home
  const { rows: [home] } = await pool.query(
    `INSERT INTO homes (slug, name, config) VALUES ($1, $2, $3) RETURNING id`,
    [SLUG, HOME_NAME, JSON.stringify(HOME_CONFIG)],
  );
  homeId = home.id;

  // Insert staff
  for (const s of TEST_STAFF) {
    await pool.query(
      `INSERT INTO staff (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out, start_date, date_of_birth, contract_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [s.id, homeId, s.name, s.role, s.team, s.pref, s.skill, s.hourly_rate, s.active, s.wtr_opt_out, s.start_date, s.date_of_birth, s.contract_hours],
    );
  }

  // Insert shift overrides for the test period:
  //   TP01: works E most days, OC-E on Wed Nov 5, OFF on Nov 15-16
  //   TP02: works L most days, N on Nov 8 (Sat — weekend enhancement)
  //   TP03: works N every day (night enhancement)
  //   TP04: works E every day (below NMW — should be flagged)
  const overrides = [
    // TP01
    { date: '2025-11-03', staff_id: 'TP01', shift: 'E' },
    { date: '2025-11-04', staff_id: 'TP01', shift: 'E' },
    { date: '2025-11-05', staff_id: 'TP01', shift: 'OC-E' },
    { date: '2025-11-06', staff_id: 'TP01', shift: 'E' },
    { date: '2025-11-07', staff_id: 'TP01', shift: 'E' },
    { date: '2025-11-08', staff_id: 'TP01', shift: 'E' },
    { date: '2025-11-09', staff_id: 'TP01', shift: 'OFF' },
    { date: '2025-11-10', staff_id: 'TP01', shift: 'E' },
    { date: '2025-11-11', staff_id: 'TP01', shift: 'E' },
    { date: '2025-11-12', staff_id: 'TP01', shift: 'E' },
    { date: '2025-11-13', staff_id: 'TP01', shift: 'E' },
    { date: '2025-11-14', staff_id: 'TP01', shift: 'E' },
    { date: '2025-11-15', staff_id: 'TP01', shift: 'OFF' },
    { date: '2025-11-16', staff_id: 'TP01', shift: 'OFF' },
    // TP02
    { date: '2025-11-03', staff_id: 'TP02', shift: 'L' },
    { date: '2025-11-04', staff_id: 'TP02', shift: 'L' },
    { date: '2025-11-05', staff_id: 'TP02', shift: 'L' },
    { date: '2025-11-06', staff_id: 'TP02', shift: 'OFF' },
    { date: '2025-11-07', staff_id: 'TP02', shift: 'L' },
    { date: '2025-11-08', staff_id: 'TP02', shift: 'N' },  // Saturday night
    { date: '2025-11-09', staff_id: 'TP02', shift: 'OFF' },
    { date: '2025-11-10', staff_id: 'TP02', shift: 'L' },
    { date: '2025-11-11', staff_id: 'TP02', shift: 'L' },
    { date: '2025-11-12', staff_id: 'TP02', shift: 'L' },
    { date: '2025-11-13', staff_id: 'TP02', shift: 'OFF' },
    { date: '2025-11-14', staff_id: 'TP02', shift: 'L' },
    { date: '2025-11-15', staff_id: 'TP02', shift: 'L' },
    { date: '2025-11-16', staff_id: 'TP02', shift: 'OFF' },
    // TP03 — night shifts every day
    ...eachDayInRange(PERIOD_START, PERIOD_END).map(d => ({ date: d, staff_id: 'TP03', shift: 'N' })),
    // TP04 — early every working day (below NMW)
    { date: '2025-11-03', staff_id: 'TP04', shift: 'E' },
    { date: '2025-11-04', staff_id: 'TP04', shift: 'E' },
    { date: '2025-11-05', staff_id: 'TP04', shift: 'E' },
    { date: '2025-11-06', staff_id: 'TP04', shift: 'E' },
    { date: '2025-11-07', staff_id: 'TP04', shift: 'E' },
    { date: '2025-11-08', staff_id: 'TP04', shift: 'OFF' },
    { date: '2025-11-09', staff_id: 'TP04', shift: 'OFF' },
    { date: '2025-11-10', staff_id: 'TP04', shift: 'E' },
    { date: '2025-11-11', staff_id: 'TP04', shift: 'E' },
    { date: '2025-11-12', staff_id: 'TP04', shift: 'E' },
    { date: '2025-11-13', staff_id: 'TP04', shift: 'E' },
    { date: '2025-11-14', staff_id: 'TP04', shift: 'E' },
    { date: '2025-11-15', staff_id: 'TP04', shift: 'OFF' },
    { date: '2025-11-16', staff_id: 'TP04', shift: 'OFF' },
  ];

  for (const o of overrides) {
    await pool.query(
      `INSERT INTO shift_overrides (home_id, date, staff_id, shift) VALUES ($1,$2,$3,$4)
       ON CONFLICT (home_id, date, staff_id) DO UPDATE SET shift = EXCLUDED.shift`,
      [homeId, o.date, o.staff_id, o.shift],
    );
  }

  // Create a draft payroll run
  const { rows: [run] } = await pool.query(
    `INSERT INTO payroll_runs (home_id, period_start, period_end, pay_frequency)
     VALUES ($1,$2,$3,'fortnightly') RETURNING id`,
    [homeId, PERIOD_START, PERIOD_END],
  );
  runId = run.id;
}, 30000);

afterAll(async () => {
  await cleanup();
}, 15000);

async function cleanup() {
  // Look up home by slug to clean up everything keyed by homeId
  const { rows } = await pool.query(`SELECT id FROM homes WHERE slug = $1`, [SLUG]);
  if (rows.length === 0) return;
  const hid = rows[0].id;

  // Reverse FK order: shifts → lines → runs → overrides → staff → home
  await pool.query(
    `DELETE FROM payroll_line_shifts WHERE payroll_line_id IN (
       SELECT pl.id FROM payroll_lines pl
       JOIN payroll_runs pr ON pr.id = pl.payroll_run_id WHERE pr.home_id = $1)`, [hid]);
  await pool.query(
    `DELETE FROM payroll_lines WHERE payroll_run_id IN (
       SELECT id FROM payroll_runs WHERE home_id = $1)`, [hid]);
  await pool.query(`DELETE FROM payroll_runs WHERE home_id = $1`, [hid]);
  await pool.query(`DELETE FROM pay_rate_rules WHERE home_id = $1`, [hid]);
  await pool.query(`DELETE FROM payroll_ytd WHERE home_id = $1`, [hid]);
  await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1`, [hid]);
  await pool.query(`DELETE FROM tax_codes WHERE home_id = $1`, [hid]);
  // Clean up HMRC liabilities if the table exists
  await pool.query(`DELETE FROM hmrc_liabilities WHERE home_id = $1`, [hid]).catch(() => {});
  // Clean up pension tables if they exist
  await pool.query(`DELETE FROM pension_contributions WHERE home_id = $1`, [hid]).catch(() => {});
  await pool.query(`DELETE FROM pension_enrolments WHERE home_id = $1`, [hid]).catch(() => {});
  await pool.query(`DELETE FROM staff WHERE home_id = $1`, [hid]);
  await pool.query(`DELETE FROM audit_log WHERE home_slug = $1`, [SLUG]);
  await pool.query(`DELETE FROM homes WHERE id = $1`, [hid]);
}

// ── seedDefaultRulesIfNeeded ────────────────────────────────────────────────

describe('seedDefaultRulesIfNeeded', () => {
  it('seeds 7 default rules for a home with none', async () => {
    // Ensure clean slate
    await pool.query(`DELETE FROM pay_rate_rules WHERE home_id = $1`, [homeId]);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await seedDefaultRulesIfNeeded(homeId, client);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const { rows } = await pool.query(
      `SELECT * FROM pay_rate_rules WHERE home_id = $1 AND effective_to IS NULL ORDER BY applies_to`,
      [homeId],
    );
    expect(rows).toHaveLength(7);

    const types = rows.map(r => r.applies_to).sort();
    expect(types).toContain('night');
    expect(types).toContain('weekend_sat');
    expect(types).toContain('weekend_sun');
    expect(types).toContain('bank_holiday');
    expect(types).toContain('sleep_in');
    expect(types).toContain('overtime');
    expect(types).toContain('on_call');
  });

  it('is idempotent — does not duplicate rules on second call', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await seedDefaultRulesIfNeeded(homeId, client);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM pay_rate_rules WHERE home_id = $1 AND effective_to IS NULL`,
      [homeId],
    );
    expect(rows[0].cnt).toBe(7);
  });
});

// ── calculateRun ────────────────────────────────────────────────────────────

describe('calculateRun', () => {
  it('calculates gross pay for all active staff', async () => {
    await calculateRun(runId, homeId, SLUG, USERNAME);

    // Verify run status changed to 'calculated'
    const { rows: [run] } = await pool.query(
      `SELECT status, staff_count, total_gross FROM payroll_runs WHERE id = $1`,
      [runId],
    );
    expect(run.status).toBe('calculated');
    expect(run.staff_count).toBe(TEST_STAFF.length);
    expect(parseFloat(run.total_gross)).toBeGreaterThan(0);
  }, 30000);

  it('creates one payroll_line per active staff member', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM payroll_lines WHERE payroll_run_id = $1 ORDER BY staff_id`,
      [runId],
    );
    expect(rows).toHaveLength(TEST_STAFF.length);

    const staffIds = rows.map(r => r.staff_id).sort();
    expect(staffIds).toEqual(['TP01', 'TP02', 'TP03', 'TP04']);
  });

  it('computes base_pay = hours x hourly_rate for TP01', async () => {
    const { rows: [line] } = await pool.query(
      `SELECT * FROM payroll_lines WHERE payroll_run_id = $1 AND staff_id = 'TP01'`,
      [runId],
    );
    // TP01 works 10 E shifts (8h each) + 1 OC-E shift (8h)
    // base_hours should be 88 (11 × 8h)
    expect(parseFloat(line.base_hours)).toBe(88);
    // base_pay = 88 × 14.50 = 1276.00
    expect(parseFloat(line.base_pay)).toBe(1276);
  });

  it('applies night enhancement for TP03 (all night shifts)', async () => {
    const { rows: [line] } = await pool.query(
      `SELECT * FROM payroll_lines WHERE payroll_run_id = $1 AND staff_id = 'TP03'`,
      [runId],
    );
    // TP03 works 14 N shifts (10h each) = 140 hours
    expect(parseFloat(line.base_hours)).toBe(140);
    expect(parseFloat(line.night_hours)).toBe(140);
    // Night enhancement: 15% of (10 × 13.00) = 15% of 130 = 19.50 per shift × 14 = 273.00
    expect(parseFloat(line.night_enhancement)).toBe(273);
    expect(parseFloat(line.total_enhancements)).toBeGreaterThanOrEqual(273);
  });

  it('applies on-call enhancement for TP01 OC-E shift', async () => {
    const { rows: [line] } = await pool.query(
      `SELECT * FROM payroll_lines WHERE payroll_run_id = $1 AND staff_id = 'TP01'`,
      [runId],
    );
    // 1 OC-E shift: on_call enhancement = 8h × £2.00 = £16.00
    expect(parseFloat(line.on_call_enhancement)).toBe(16);
  });

  it('applies weekend enhancement for TP02 Saturday night and TP03 weekend nights', async () => {
    const { rows: [line] } = await pool.query(
      `SELECT * FROM payroll_lines WHERE payroll_run_id = $1 AND staff_id = 'TP02'`,
      [runId],
    );
    // TP02 works N on Nov 8 (Saturday): weekend_sat + night enhancement both apply
    expect(parseFloat(line.weekend_hours)).toBeGreaterThan(0);
    expect(parseFloat(line.weekend_enhancement)).toBeGreaterThan(0);
  });

  it('computes gross = base + enhancements for each line', async () => {
    const { rows } = await pool.query(
      `SELECT staff_id, base_pay, total_enhancements, gross_pay
       FROM payroll_lines WHERE payroll_run_id = $1`,
      [runId],
    );
    for (const line of rows) {
      const basePay = parseFloat(line.base_pay);
      const totalEnh = parseFloat(line.total_enhancements);
      const grossPay = parseFloat(line.gross_pay);
      // gross_pay must equal base_pay + total_enhancements (within rounding tolerance)
      expect(Math.abs(grossPay - (basePay + totalEnh))).toBeLessThanOrEqual(0.01);
    }
  });

  it('records employer-only pension contributions when employee override is 0%', async () => {
    const { rows: existingConfigRows } = await pool.query(
      `SELECT effective_from::text
       FROM pension_config
       WHERE effective_from BETWEEN '2025-10-17' AND '2025-11-16'`
    );
    const usedDates = new Set(existingConfigRows.map(r => r.effective_from));
    let effectiveFrom = null;
    for (let day = 16; day >= 17 - 31; day--) {
      const candidate = new Date(Date.UTC(2025, 10, day));
      const dateStr = candidate.toISOString().slice(0, 10);
      if (!usedDates.has(dateStr) && dateStr <= '2025-11-16') {
        effectiveFrom = dateStr;
        break;
      }
    }
    expect(effectiveFrom).toBeTruthy();

    const { rows: [configRow] } = await pool.query(
      `INSERT INTO pension_config
         (effective_from, lower_qualifying_weekly, upper_qualifying_weekly, trigger_annual, employee_rate, employer_rate, state_pension_age)
       VALUES ($1, 120, 967, 10000, 0.05, 0.03, 66)
       RETURNING id`
      ,
      [effectiveFrom]
    );
    try {
      await pool.query(
        `INSERT INTO pension_enrolments
           (home_id, staff_id, status, enrolled_date, contribution_override_employee, contribution_override_employer)
         VALUES ($1, 'TP02', 'eligible_enrolled', $2, 0, 0.03)
         ON CONFLICT (home_id, staff_id) DO UPDATE SET
           status = EXCLUDED.status,
           enrolled_date = EXCLUDED.enrolled_date,
           contribution_override_employee = EXCLUDED.contribution_override_employee,
           contribution_override_employer = EXCLUDED.contribution_override_employer`,
        [homeId, PERIOD_END]
      );

      await calculateRun(runId, homeId, SLUG, USERNAME);

      const { rows } = await pool.query(
        `SELECT pc.employee_amount, pc.employer_amount
         FROM pension_contributions pc
         JOIN payroll_lines pl ON pl.id = pc.payroll_line_id
         WHERE pl.payroll_run_id = $1 AND pc.staff_id = 'TP02'`,
        [runId]
      );

      expect(rows).toHaveLength(1);
      expect(parseFloat(rows[0].employee_amount)).toBe(0);
      expect(parseFloat(rows[0].employer_amount)).toBeGreaterThan(0);
    } finally {
      await pool.query(`DELETE FROM pension_enrolments WHERE home_id = $1 AND staff_id = 'TP02'`, [homeId]);
      await pool.query(`DELETE FROM pension_config WHERE id = $1`, [configRow.id]);
      await calculateRun(runId, homeId, SLUG, USERNAME);
    }
  }, 30000);

  it('flags TP04 as NMW non-compliant', async () => {
    const { rows: [line] } = await pool.query(
      `SELECT nmw_compliant, nmw_lowest_rate, notes
       FROM payroll_lines WHERE payroll_run_id = $1 AND staff_id = 'TP04'`,
      [runId],
    );
    expect(line.nmw_compliant).toBe(false);
    expect(parseFloat(line.nmw_lowest_rate)).toBeLessThan(12.21);
  });

  it('marks NMW-compliant staff as compliant', async () => {
    const { rows: [line] } = await pool.query(
      `SELECT nmw_compliant FROM payroll_lines WHERE payroll_run_id = $1 AND staff_id = 'TP01'`,
      [runId],
    );
    expect(line.nmw_compliant).toBe(true);
  });

  it('creates payroll_line_shifts detail rows', async () => {
    const { rows } = await pool.query(
      `SELECT pls.* FROM payroll_line_shifts pls
       JOIN payroll_lines pl ON pl.id = pls.payroll_line_id
       WHERE pl.payroll_run_id = $1 AND pl.staff_id = 'TP01'
       ORDER BY pls.date`,
      [runId],
    );
    // TP01 works 11 shifts (10 E + 1 OC-E, OFF days produce no shift records)
    expect(rows).toHaveLength(11);
    // Each shift row should have hours, base_rate, and total_amount
    for (const row of rows) {
      expect(parseFloat(row.hours)).toBeGreaterThan(0);
      expect(parseFloat(row.base_rate)).toBe(14.50);
      expect(parseFloat(row.total_amount)).toBeGreaterThan(0);
    }
  });

  it('run totals aggregate across all staff', async () => {
    const { rows: [run] } = await pool.query(
      `SELECT total_gross, total_enhancements, total_sleep_ins
       FROM payroll_runs WHERE id = $1`,
      [runId],
    );
    const { rows: lines } = await pool.query(
      `SELECT gross_pay, total_enhancements, sleep_in_pay
       FROM payroll_lines WHERE payroll_run_id = $1`,
      [runId],
    );

    const sumGross = lines.reduce((s, l) => s + parseFloat(l.gross_pay), 0);
    // total_gross includes holiday_pay and ssp_amount, but in this test there are none
    // so it should roughly equal sum of gross_pay
    expect(parseFloat(run.total_gross)).toBeGreaterThan(0);
    expect(sumGross).toBeGreaterThan(0);

    const lineEnh = lines.reduce((s, l) => s + parseFloat(l.total_enhancements), 0);
    expect(Math.abs(parseFloat(run.total_enhancements) - lineEnh)).toBeLessThanOrEqual(0.01);
  });

  it('uses recorded payable hours plus hourly annual leave when a shortfall adjustment exists', async () => {
    await pool.query(
      `INSERT INTO timesheet_entries
         (home_id, staff_id, date, scheduled_start, scheduled_end, actual_start, actual_end, break_minutes, payable_hours, status)
       VALUES ($1, 'TP01', '2025-11-03', '07:00', '15:00', '07:00', '13:00', 0, 6, 'pending')
       ON CONFLICT (home_id, staff_id, date) DO UPDATE SET
         payable_hours = EXCLUDED.payable_hours,
         actual_end = EXCLUDED.actual_end,
         status = EXCLUDED.status`,
      [homeId],
    );
    await pool.query(
      `INSERT INTO shift_hour_adjustments (home_id, staff_id, date, kind, hours, note, source)
       VALUES ($1, 'TP01', '2025-11-03', 'annual_leave', 2, 'Medical appointment', 'test')
       ON CONFLICT (home_id, staff_id, date) DO UPDATE SET
         kind = EXCLUDED.kind,
         hours = EXCLUDED.hours,
         note = EXCLUDED.note,
         source = EXCLUDED.source`,
      [homeId],
    );

    try {
      await calculateRun(runId, homeId, SLUG, USERNAME);

      const { rows: [line] } = await pool.query(
        `SELECT base_hours, holiday_pay
         FROM payroll_lines
         WHERE payroll_run_id = $1 AND staff_id = 'TP01'`,
        [runId],
      );
      expect(parseFloat(line.base_hours)).toBe(86);
      expect(parseFloat(line.holiday_pay)).toBeGreaterThan(0);

      const { rows: [shift] } = await pool.query(
        `SELECT shift_code, hours, total_amount
         FROM payroll_line_shifts pls
         JOIN payroll_lines pl ON pl.id = pls.payroll_line_id
         WHERE pl.payroll_run_id = $1 AND pl.staff_id = 'TP01' AND pls.date = '2025-11-03' AND pls.shift_code = 'AL-H'`,
        [runId],
      );
      expect(shift.shift_code).toBe('AL-H');
      expect(parseFloat(shift.hours)).toBe(2);
      expect(parseFloat(shift.total_amount)).toBeGreaterThan(0);
    } finally {
      await pool.query(`DELETE FROM shift_hour_adjustments WHERE home_id = $1 AND staff_id = 'TP01' AND date = '2025-11-03'`, [homeId]);
      await pool.query(`DELETE FROM timesheet_entries WHERE home_id = $1 AND staff_id = 'TP01' AND date = '2025-11-03'`, [homeId]);
      await calculateRun(runId, homeId, SLUG, USERNAME);
    }
  }, 30000);

  it('adds paid authorised absence into gross pay and payroll line detail', async () => {
    await pool.query(
      `INSERT INTO timesheet_entries
         (home_id, staff_id, date, scheduled_start, scheduled_end, actual_start, actual_end, break_minutes, payable_hours, status)
       VALUES ($1, 'TP02', '2025-11-04', '14:00', '22:00', '14:00', '20:00', 0, 6, 'pending')
       ON CONFLICT (home_id, staff_id, date) DO UPDATE SET
         payable_hours = EXCLUDED.payable_hours,
         actual_end = EXCLUDED.actual_end,
         status = EXCLUDED.status`,
      [homeId],
    );
    await pool.query(
      `INSERT INTO shift_hour_adjustments (home_id, staff_id, date, kind, hours, note, source)
       VALUES ($1, 'TP02', '2025-11-04', 'paid_authorised_absence', 2, 'Managed shortfall', 'test')
       ON CONFLICT (home_id, staff_id, date) DO UPDATE SET
         kind = EXCLUDED.kind,
         hours = EXCLUDED.hours,
         note = EXCLUDED.note,
         source = EXCLUDED.source`,
      [homeId],
    );

    try {
      await calculateRun(runId, homeId, SLUG, USERNAME);

      const { rows: [line] } = await pool.query(
        `SELECT base_hours, authorised_absence_hours, authorised_absence_pay, gross_pay
         FROM payroll_lines
         WHERE payroll_run_id = $1 AND staff_id = 'TP02'`,
        [runId],
      );
      expect(parseFloat(line.base_hours)).toBe(80);
      expect(parseFloat(line.authorised_absence_hours)).toBe(2);
      expect(parseFloat(line.authorised_absence_pay)).toBeGreaterThan(0);
      expect(parseFloat(line.gross_pay)).toBeGreaterThan(0);

      const { rows: [shift] } = await pool.query(
        `SELECT shift_code, hours, total_amount
         FROM payroll_line_shifts pls
         JOIN payroll_lines pl ON pl.id = pls.payroll_line_id
         WHERE pl.payroll_run_id = $1 AND pl.staff_id = 'TP02' AND pls.date = '2025-11-04' AND pls.shift_code = 'AUTH-PAY'`,
        [runId],
      );
      expect(shift.shift_code).toBe('AUTH-PAY');
      expect(parseFloat(shift.hours)).toBe(2);
      expect(parseFloat(shift.total_amount)).toBeGreaterThan(0);
    } finally {
      await pool.query(`DELETE FROM shift_hour_adjustments WHERE home_id = $1 AND staff_id = 'TP02' AND date = '2025-11-04'`, [homeId]);
      await pool.query(`DELETE FROM timesheet_entries WHERE home_id = $1 AND staff_id = 'TP02' AND date = '2025-11-04'`, [homeId]);
      await calculateRun(runId, homeId, SLUG, USERNAME);
    }
  }, 30000);

  it('is safe to recalculate (wipes and recreates lines)', async () => {
    // Recalculate the same run — should not error or double-count
    await calculateRun(runId, homeId, SLUG, USERNAME);

    const { rows } = await pool.query(
      `SELECT * FROM payroll_lines WHERE payroll_run_id = $1`,
      [runId],
    );
    // Still exactly 4 lines (not 8)
    expect(rows).toHaveLength(TEST_STAFF.length);
  }, 30000);

});

// ── approveRun ──────────────────────────────────────────────────────────────

describe('approveRun', () => {
  it('rejects approval when NMW violations exist', async () => {
    // TP04 is below NMW, so approval should be blocked
    await expect(
      approveRun(runId, homeId, SLUG, USERNAME),
    ).rejects.toThrow(/National Minimum Wage/);
  });

  it('rejects approval of a draft (non-calculated) run', async () => {
    // Create a second draft run with a non-overlapping period
    const { rows: [draftRun] } = await pool.query(
      `INSERT INTO payroll_runs (home_id, period_start, period_end, pay_frequency)
       VALUES ($1, '2025-10-01', '2025-10-14', 'fortnightly') RETURNING id`,
      [homeId],
    );
    try {
      await expect(
        approveRun(draftRun.id, homeId, SLUG, USERNAME),
      ).rejects.toThrow(/calculated/);
    } finally {
      await pool.query(`DELETE FROM payroll_runs WHERE id = $1`, [draftRun.id]);
    }
  });

  it('approves a compliant run after fixing NMW violations', async () => {
    // Fix TP04's rate to be NMW-compliant
    await pool.query(
      `UPDATE staff SET hourly_rate = 12.50 WHERE home_id = $1 AND id = 'TP04'`,
      [homeId],
    );

    // Recalculate to pick up new rate
    await calculateRun(runId, homeId, SLUG, USERNAME);

    // Verify TP04 is now compliant
    const { rows: [line] } = await pool.query(
      `SELECT nmw_compliant FROM payroll_lines WHERE payroll_run_id = $1 AND staff_id = 'TP04'`,
      [runId],
    );
    expect(line.nmw_compliant).toBe(true);

    // Now approval should succeed
    await approveRun(runId, homeId, SLUG, USERNAME);

    const { rows: [run] } = await pool.query(
      `SELECT status, approved_by FROM payroll_runs WHERE id = $1`,
      [runId],
    );
    expect(run.status).toBe('approved');
    expect(run.approved_by).toBe(USERNAME);
  }, 30000);

  it('writes YTD records on approval', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM payroll_ytd WHERE home_id = $1`,
      [homeId],
    );
    // Should have one YTD row per active staff member
    expect(rows.length).toBeGreaterThanOrEqual(TEST_STAFF.length);
    for (const row of rows) {
      expect(parseFloat(row.gross_pay)).toBeGreaterThanOrEqual(0);
    }
  });

  it('rejects re-approval (ytd_applied guard or wrong status)', async () => {
    // The run is already approved — re-approving should fail with a status error
    await expect(
      approveRun(runId, homeId, SLUG, USERNAME),
    ).rejects.toThrow();
  });

  it('returns NotFoundError for non-existent run', async () => {
    await expect(
      approveRun(99999, homeId, SLUG, USERNAME),
    ).rejects.toThrow(NotFoundError);
  });
});

// ── exportRunCSV ────────────────────────────────────────────────────────────

describe('exportRunCSV', () => {
  it('exports generic CSV with correct headers and staff rows', async () => {
    const result = await exportRunCSV(runId, homeId, SLUG, USERNAME, 'generic');
    expect(result).toHaveProperty('csv');
    expect(result).toHaveProperty('filename');

    const lines = result.csv.split('\r\n');
    // Header + 4 staff rows
    expect(lines.length).toBe(5);

    const headers = lines[0].split(',');
    expect(headers).toContain('Staff_Name');
    expect(headers).toContain('Basic_Hours');
    expect(headers).toContain('Basic_Pay');
    expect(headers).toContain('Total_Gross_Pay');
    expect(headers).toContain('Night_Hours');
    expect(headers).toContain('Night_Enhancement');
    expect(headers).toContain('Ref:Est_PAYE');
    expect(headers).toContain('Ref:Est_Net_Pay');
  }, 15000);

  it('exports sage CSV with the same structure', async () => {
    const result = await exportRunCSV(runId, homeId, SLUG, USERNAME, 'sage');
    expect(result.csv).toContain('Staff_Name');
    expect(result.filename).toContain('sage');
    expect(result.filename).toContain(SLUG);
  }, 15000);

  it('marks run as exported after first export', async () => {
    const { rows: [run] } = await pool.query(
      `SELECT status, export_format FROM payroll_runs WHERE id = $1`,
      [runId],
    );
    expect(run.status).toBe('exported');
  });

  it('rejects export of a draft run', async () => {
    const { rows: [draftRun] } = await pool.query(
      `INSERT INTO payroll_runs (home_id, period_start, period_end, pay_frequency)
       VALUES ($1, '2025-09-01', '2025-09-14', 'fortnightly') RETURNING id`,
      [homeId],
    );
    try {
      await expect(
        exportRunCSV(draftRun.id, homeId, SLUG, USERNAME, 'generic'),
      ).rejects.toThrow(/approved/);
    } finally {
      await pool.query(`DELETE FROM payroll_runs WHERE id = $1`, [draftRun.id]);
    }
  });

  it('returns NotFoundError for non-existent run', async () => {
    await expect(
      exportRunCSV(99999, homeId, SLUG, USERNAME, 'generic'),
    ).rejects.toThrow(NotFoundError);
  });
});

// ── assemblePayslipData ─────────────────────────────────────────────────────

describe('assemblePayslipData', () => {
  it('returns payslip data for all staff', async () => {
    const payslips = await assemblePayslipData(runId, homeId, null);
    expect(payslips).toHaveLength(TEST_STAFF.length);

    for (const p of payslips) {
      expect(p).toHaveProperty('run');
      expect(p).toHaveProperty('line');
      expect(p).toHaveProperty('staff');
      expect(p).toHaveProperty('home');
      expect(p).toHaveProperty('shifts');
      expect(p.run.id).toBe(runId);
      expect(p.staff).toHaveProperty('name');
      expect(p.line).toHaveProperty('gross_pay');
      expect(p.line).toHaveProperty('net_pay');
    }
  });

  it('returns payslip data for a single staff member', async () => {
    const payslips = await assemblePayslipData(runId, homeId, 'TP01');
    expect(payslips).toHaveLength(1);
    expect(payslips[0].staff.id).toBe('TP01');
    expect(payslips[0].staff.name).toBe('Alice Senior');
  });

  it('limits payslip staff details to payslip-safe fields', async () => {
    const payslips = await assemblePayslipData(runId, homeId, 'TP01');
    const staff = payslips[0].staff;

    expect(staff).toEqual({
      id: 'TP01',
      name: 'Alice Senior',
      role: expect.any(String),
      ni_number: null,
    });
    expect(staff).not.toHaveProperty('date_of_birth');
    expect(staff).not.toHaveProperty('hourly_rate');
    expect(staff).not.toHaveProperty('address');
  });

  it('includes shift breakdown in payslip data', async () => {
    const payslips = await assemblePayslipData(runId, homeId, 'TP01');
    const tp01 = payslips[0];
    expect(tp01.shifts.length).toBeGreaterThan(0);
    for (const shift of tp01.shifts) {
      expect(shift).toHaveProperty('date');
      expect(shift).toHaveProperty('shift_code');
      expect(shift).toHaveProperty('hours');
      expect(shift).toHaveProperty('total_amount');
    }
  });

  it('includes YTD data for approved runs', async () => {
    const payslips = await assemblePayslipData(runId, homeId, 'TP01');
    const tp01 = payslips[0];
    // Run is exported (approved previously), so YTD should be present
    expect(tp01.ytd).not.toBeNull();
    expect(tp01.ytdEstimated).toBe(false);
    expect(tp01.ytd).toHaveProperty('gross_pay');
  });

  it('returns NotFoundError for non-existent run', async () => {
    await expect(
      assemblePayslipData(99999, homeId, null),
    ).rejects.toThrow(NotFoundError);
  });
});

// ── Error handling ──────────────────────────────────────────────────────────

describe('payroll hardening regressions', () => {
  it('excludes voided runs from holiday-pay lookback averages', async () => {
    const insertedRunIds = [];
    const insertedLineIds = [];
    try {
      const runRows = await Promise.all([
        pool.query(
          `INSERT INTO payroll_runs (home_id, period_start, period_end, pay_frequency, status)
           VALUES ($1, '2025-08-04', '2025-08-10', 'weekly', 'approved')
           RETURNING id`,
          [homeId],
        ),
        pool.query(
          `INSERT INTO payroll_runs (home_id, period_start, period_end, pay_frequency, status)
           VALUES ($1, '2025-08-11', '2025-08-17', 'weekly', 'voided')
           RETURNING id`,
          [homeId],
        ),
        pool.query(
          `INSERT INTO payroll_runs (home_id, period_start, period_end, pay_frequency, status)
           VALUES ($1, '2025-08-18', '2025-08-24', 'weekly', 'approved')
           RETURNING id`,
          [homeId],
        ),
      ]);
      const [approvedA, voidedRun, approvedB] = runRows.map((result) => result.rows[0].id);
      insertedRunIds.push(approvedA, voidedRun, approvedB);

      const lineRows = await Promise.all([
        pool.query(
          `INSERT INTO payroll_lines (payroll_run_id, staff_id, gross_pay)
           VALUES ($1, 'TP01', 500)
           RETURNING id`,
          [approvedA],
        ),
        pool.query(
          `INSERT INTO payroll_lines (payroll_run_id, staff_id, gross_pay)
           VALUES ($1, 'TP01', 1500)
           RETURNING id`,
          [voidedRun],
        ),
        pool.query(
          `INSERT INTO payroll_lines (payroll_run_id, staff_id, gross_pay)
           VALUES ($1, 'TP01', 700)
           RETURNING id`,
          [approvedB],
        ),
      ]);
      insertedLineIds.push(...lineRows.map((result) => result.rows[0].id));

      const avg = await payrollRunRepo.findAverageWeeklyPay(homeId, 'TP01', '2025-09-01');
      expect(avg).toMatchObject({
        total_gross: 1200,
        divisor_weeks: 2,
      });
    } finally {
      if (insertedLineIds.length > 0) {
        await pool.query(`DELETE FROM payroll_lines WHERE id = ANY($1::int[])`, [insertedLineIds]);
      }
      if (insertedRunIds.length > 0) {
        await pool.query(`DELETE FROM payroll_runs WHERE id = ANY($1::int[])`, [insertedRunIds]);
      }
    }
  });

  it('stamps leaving_date when a staff member is deactivated without one', async () => {
    await pool.query(
      `INSERT INTO staff (id, home_id, name, role, team, skill, hourly_rate, active)
       VALUES ('TP-LEAVER', $1, 'Temp Leaver', 'Carer', 'Day A', 1, 12.5, true)`,
      [homeId],
    );

    try {
      const updated = await staffRepo.updateOne(homeId, 'TP-LEAVER', { active: false }, null);
      expect(updated.active).toBe(false);
      expect(updated.leaving_date).toBe(new Date().toISOString().slice(0, 10));
    } finally {
      await pool.query(`DELETE FROM staff WHERE home_id = $1 AND id = 'TP-LEAVER'`, [homeId]);
    }
  });

  it('still pays a deactivated staff member who has period activity but no leaving_date', async () => {
    const tempStaffId = 'TP-INACTIVE-ACT';
    let tempRunId = null;
    try {
      await pool.query(
        `INSERT INTO staff (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out, start_date, contract_hours)
         VALUES ($1, $2, 'Inactive But Owed', 'Carer', 'Day A', 'E', 1, 12.5, false, false, '2025-01-01', 37.5)`,
        [tempStaffId, homeId],
      );
      await pool.query(
        `INSERT INTO shift_overrides (home_id, date, staff_id, shift)
         VALUES ($1, '2025-12-01', $2, 'E')
         ON CONFLICT (home_id, date, staff_id) DO UPDATE SET shift = EXCLUDED.shift`,
        [homeId, tempStaffId],
      );
      await pool.query(
        `INSERT INTO timesheet_entries
           (home_id, staff_id, date, scheduled_start, scheduled_end, actual_start, actual_end, break_minutes, payable_hours, status)
         VALUES ($1, $2, '2025-12-01', '07:00', '15:00', '07:00', '15:00', 0, 8, 'approved')
         ON CONFLICT (home_id, staff_id, date) DO UPDATE SET
           actual_start = EXCLUDED.actual_start,
           actual_end = EXCLUDED.actual_end,
           payable_hours = EXCLUDED.payable_hours,
           status = EXCLUDED.status`,
        [homeId, tempStaffId],
      );
      const { rows: [run] } = await pool.query(
        `INSERT INTO payroll_runs (home_id, period_start, period_end, pay_frequency)
         VALUES ($1, '2025-12-01', '2025-12-07', 'weekly')
         RETURNING id`,
        [homeId],
      );
      tempRunId = run.id;

      await calculateRun(tempRunId, homeId, SLUG, USERNAME);

      const { rows: [line] } = await pool.query(
        `SELECT gross_pay, base_hours
           FROM payroll_lines
          WHERE payroll_run_id = $1 AND staff_id = $2`,
        [tempRunId, tempStaffId],
      );
      expect(line).toBeTruthy();
      expect(parseFloat(line.base_hours)).toBeGreaterThan(0);
      expect(parseFloat(line.gross_pay)).toBeGreaterThan(0);
    } finally {
      if (tempRunId) {
        await pool.query(
          `DELETE FROM payroll_line_shifts
            WHERE payroll_line_id IN (
              SELECT id FROM payroll_lines WHERE payroll_run_id = $1
            )`,
          [tempRunId],
        );
        await pool.query(`DELETE FROM payroll_lines WHERE payroll_run_id = $1`, [tempRunId]);
        await pool.query(`DELETE FROM payroll_runs WHERE id = $1`, [tempRunId]);
      }
      await pool.query(`DELETE FROM timesheet_entries WHERE home_id = $1 AND staff_id = $2`, [homeId, tempStaffId]);
      await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1 AND staff_id = $2`, [homeId, tempStaffId]);
      await pool.query(`DELETE FROM staff WHERE home_id = $1 AND id = $2`, [homeId, tempStaffId]);
    }
  });

  it('uses the worker 22nd birthday as pension enrolled_date when that falls mid-run', async () => {
    const tempStaffId = 'TP-PEN-BDAY';
    let tempRunId = null;
    const overrideDates = ['2025-12-08', '2025-12-09', '2025-12-10'];
    try {
      await pool.query(
        `INSERT INTO staff (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out, start_date, date_of_birth, contract_hours)
         VALUES ($1, $2, 'Pension Birthday', 'Carer', 'Day A', 'E', 1, 13.00, true, false, '2025-01-01', '2003-12-10', 37.5)`,
        [tempStaffId, homeId],
      );
      for (const date of overrideDates) {
        await pool.query(
          `INSERT INTO shift_overrides (home_id, date, staff_id, shift)
           VALUES ($1, $2, $3, 'E')
           ON CONFLICT (home_id, date, staff_id) DO UPDATE SET shift = EXCLUDED.shift`,
          [homeId, date, tempStaffId],
        );
      }
      const { rows: [run] } = await pool.query(
        `INSERT INTO payroll_runs (home_id, period_start, period_end, pay_frequency)
         VALUES ($1, '2025-12-08', '2025-12-14', 'weekly')
         RETURNING id`,
        [homeId],
      );
      tempRunId = run.id;

      await calculateRun(tempRunId, homeId, SLUG, USERNAME);

      const { rows: [enrolment] } = await pool.query(
        `SELECT status, enrolled_date::text
         FROM pension_enrolments
         WHERE home_id = $1 AND staff_id = $2`,
        [homeId, tempStaffId],
      );
      expect(enrolment.status).toBe('eligible_enrolled');
      expect(enrolment.enrolled_date).toBe('2025-12-10');
    } finally {
      if (tempRunId) {
        await pool.query(
          `DELETE FROM payroll_line_shifts
            WHERE payroll_line_id IN (SELECT id FROM payroll_lines WHERE payroll_run_id = $1)`,
          [tempRunId],
        ).catch(() => {});
        await pool.query(`DELETE FROM payroll_lines WHERE payroll_run_id = $1`, [tempRunId]).catch(() => {});
        await pool.query(`DELETE FROM payroll_runs WHERE id = $1`, [tempRunId]).catch(() => {});
      }
      await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1 AND staff_id = $2`, [homeId, tempStaffId]).catch(() => {});
      await pool.query(`DELETE FROM pension_enrolments WHERE home_id = $1 AND staff_id = $2`, [homeId, tempStaffId]).catch(() => {});
      await pool.query(`DELETE FROM staff WHERE home_id = $1 AND id = $2`, [homeId, tempStaffId]).catch(() => {});
    }
  });

  it('re-enrols opted-out staff once reassessment_date falls inside the run', async () => {
    const tempStaffId = 'TP-PEN-REASS';
    let tempRunId = null;
    try {
      await pool.query(
        `INSERT INTO staff (id, home_id, name, role, team, pref, skill, hourly_rate, active, wtr_opt_out, start_date, date_of_birth, contract_hours)
         VALUES ($1, $2, 'Pension Reassess', 'Carer', 'Day A', 'E', 1, 13.00, true, false, '2024-01-01', '1990-05-01', 37.5)`,
        [tempStaffId, homeId],
      );
      await pool.query(
        `INSERT INTO shift_overrides (home_id, date, staff_id, shift)
         VALUES ($1, '2025-12-10', $2, 'EL')
         ON CONFLICT (home_id, date, staff_id) DO UPDATE SET shift = EXCLUDED.shift`,
        [homeId, tempStaffId],
      );
      await pool.query(
        `INSERT INTO pension_enrolments (home_id, staff_id, status, opted_out_date, reassessment_date)
         VALUES ($1, $2, 'opted_out', '2025-06-01', '2025-12-10')
         ON CONFLICT (home_id, staff_id) DO UPDATE SET
           status = EXCLUDED.status,
           opted_out_date = EXCLUDED.opted_out_date,
           reassessment_date = EXCLUDED.reassessment_date`,
        [homeId, tempStaffId],
      );
      const { rows: [run] } = await pool.query(
        `INSERT INTO payroll_runs (home_id, period_start, period_end, pay_frequency)
         VALUES ($1, '2025-12-08', '2025-12-14', 'weekly')
         RETURNING id`,
        [homeId],
      );
      tempRunId = run.id;

      await calculateRun(tempRunId, homeId, SLUG, USERNAME);

      const { rows: [enrolment] } = await pool.query(
        `SELECT status, enrolled_date::text, opted_out_date, reassessment_date
         FROM pension_enrolments
         WHERE home_id = $1 AND staff_id = $2`,
        [homeId, tempStaffId],
      );
      expect(enrolment.status).toBe('eligible_enrolled');
      expect(enrolment.enrolled_date).toBe('2025-12-10');
      expect(enrolment.opted_out_date).toBeNull();
      expect(enrolment.reassessment_date).toBeNull();
    } finally {
      if (tempRunId) {
        await pool.query(
          `DELETE FROM payroll_line_shifts
            WHERE payroll_line_id IN (SELECT id FROM payroll_lines WHERE payroll_run_id = $1)`,
          [tempRunId],
        ).catch(() => {});
        await pool.query(`DELETE FROM payroll_lines WHERE payroll_run_id = $1`, [tempRunId]).catch(() => {});
        await pool.query(`DELETE FROM payroll_runs WHERE id = $1`, [tempRunId]).catch(() => {});
      }
      await pool.query(`DELETE FROM shift_overrides WHERE home_id = $1 AND staff_id = $2`, [homeId, tempStaffId]).catch(() => {});
      await pool.query(`DELETE FROM pension_enrolments WHERE home_id = $1 AND staff_id = $2`, [homeId, tempStaffId]).catch(() => {});
      await pool.query(`DELETE FROM staff WHERE home_id = $1 AND id = $2`, [homeId, tempStaffId]).catch(() => {});
    }
  });
});

describe('error handling', () => {
  it('calculateRun throws NotFoundError for non-existent run', async () => {
    await expect(
      calculateRun(99999, homeId, SLUG, USERNAME),
    ).rejects.toThrow(NotFoundError);
  });

  it('calculateRun throws ValidationError on an approved/exported run', async () => {
    await expect(
      calculateRun(runId, homeId, SLUG, USERNAME),
    ).rejects.toThrow(ValidationError);
  });
});

// ── Audit trail ─────────────────────────────────────────────────────────────

describe('audit trail', () => {
  it('records payroll_calculate, payroll_approve, and payroll_export actions', async () => {
    const { rows } = await pool.query(
      `SELECT action FROM audit_log
       WHERE home_slug = $1 AND action LIKE 'payroll_%'
       ORDER BY ts`,
      [SLUG],
    );

    const actions = rows.map(r => r.action);
    expect(actions).toContain('payroll_calculate');
    expect(actions).toContain('payroll_approve');
    expect(actions).toContain('payroll_export');
  });
});
