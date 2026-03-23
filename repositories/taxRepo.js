import { pool, toDateStr } from '../db.js';

function f(v) { return v != null ? parseFloat(v) : null; }

const TAX_CODE_COLS = `id, home_id, staff_id, tax_code, basis, ni_category,
  effective_from, previous_pay, previous_tax, student_loan_plan,
  source, notes, created_at, updated_at`;

const TAX_BAND_COLS = 'id, country, tax_year, band_name, lower_limit, upper_limit, rate';

const NI_THRESHOLD_COLS = 'id, tax_year, threshold_name, weekly_amount, monthly_amount, annual_amount';

const NI_RATE_COLS = 'id, tax_year, ni_category, rate_type, rate';

const STUDENT_LOAN_COLS = 'id, tax_year, plan, annual_threshold, rate';

const YTD_COLS = `id, home_id, staff_id, tax_year,
  gross_pay, taxable_pay, tax_deducted, employee_ni, employer_ni,
  student_loan, pension_employee, pension_employer,
  holiday_pay, ssp_amount, net_pay, updated_at`;

// ─── Tax Codes ────────────────────────────────────────────────────────────────

/**
 * Get the most recent tax code for a staff member as of a given date.
 * Returns null if no record exists (caller should default to 1257L).
 */
export async function getTaxCodeForStaff(homeId, staffId, asOfDate, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${TAX_CODE_COLS} FROM tax_codes
     WHERE home_id = $1 AND staff_id = $2 AND effective_from <= $3
     ORDER BY effective_from DESC
     LIMIT 1`,
    [homeId, staffId, asOfDate]
  );
  return rows[0] ? shapeCode(rows[0]) : null;
}

/**
 * Batch: get most recent tax code for multiple staff as of a given date.
 * Returns Map<staffId, shapedCode>.
 */
export async function getTaxCodeBatch(homeId, staffIds, asOfDate, client) {
  if (!staffIds.length) return new Map();
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT DISTINCT ON (staff_id) ${TAX_CODE_COLS}
     FROM tax_codes
     WHERE home_id = $1 AND staff_id = ANY($2) AND effective_from <= $3
     ORDER BY staff_id, effective_from DESC`,
    [homeId, staffIds, asOfDate]
  );
  return new Map(rows.map(r => [r.staff_id, shapeCode(r)]));
}

export async function listTaxCodesByHome(homeId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (tc.staff_id)
       ${TAX_CODE_COLS.split(',').map(c => `tc.${c.trim()}`).join(', ')}
     FROM tax_codes tc
     WHERE tc.home_id = $1
     ORDER BY tc.staff_id, tc.effective_from DESC`,
    [homeId]
  );
  return rows.map(shapeCode);
}

export async function upsertTaxCode(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO tax_codes
       (home_id, staff_id, tax_code, basis, ni_category, effective_from,
        previous_pay, previous_tax, student_loan_plan, source, notes, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     ON CONFLICT (home_id, staff_id, effective_from) DO UPDATE SET
       tax_code          = EXCLUDED.tax_code,
       basis             = EXCLUDED.basis,
       ni_category       = EXCLUDED.ni_category,
       previous_pay      = EXCLUDED.previous_pay,
       previous_tax      = EXCLUDED.previous_tax,
       student_loan_plan = EXCLUDED.student_loan_plan,
       source            = EXCLUDED.source,
       notes             = EXCLUDED.notes,
       updated_at        = NOW()
     RETURNING ${TAX_CODE_COLS}`,
    [
      homeId, data.staff_id, data.tax_code || '1257L',
      data.basis ?? 'cumulative', data.ni_category ?? 'A',
      data.effective_from || new Date().toISOString().slice(0, 10),
      data.previous_pay ?? 0, data.previous_tax ?? 0,
      data.student_loan_plan || null,
      data.source ?? 'manual', data.notes || null,
    ]
  );
  return shapeCode(rows[0]);
}

function shapeCode(row) {
  return {
    id: row.id,
    home_id: row.home_id,
    staff_id: row.staff_id,
    tax_code: row.tax_code,
    basis: row.basis,
    ni_category: row.ni_category,
    effective_from: toDateStr(row.effective_from),
    previous_pay: f(row.previous_pay),
    previous_tax: f(row.previous_tax),
    student_loan_plan: row.student_loan_plan || null,
    source: row.source,
    notes: row.notes || null,
  };
}

// ─── Tax Bands ────────────────────────────────────────────────────────────────

/**
 * Get income tax bands for a country and tax year.
 * country: 'england_wales' | 'scotland'
 * taxYear: integer e.g. 2025
 */
export async function getTaxBands(country, taxYear, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${TAX_BAND_COLS} FROM tax_bands
     WHERE country = $1 AND tax_year = $2
     ORDER BY lower_limit`,
    [country, taxYear]
  );
  return rows.map(r => ({
    band_name: r.band_name,
    lower_limit: f(r.lower_limit),
    upper_limit: r.upper_limit != null ? f(r.upper_limit) : null,
    rate: f(r.rate),
  }));
}

// ─── NI Thresholds & Rates ────────────────────────────────────────────────────

export async function getNIThresholds(taxYear, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${NI_THRESHOLD_COLS} FROM ni_thresholds WHERE tax_year = $1`,
    [taxYear]
  );
  return rows.map(r => ({
    threshold_name: r.threshold_name,
    weekly_amount: f(r.weekly_amount),
    monthly_amount: f(r.monthly_amount),
    annual_amount: f(r.annual_amount),
  }));
}

export async function getNIRates(taxYear, niCategory, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${NI_RATE_COLS} FROM ni_rates WHERE tax_year = $1 AND ni_category = $2`,
    [taxYear, niCategory]
  );
  return rows.map(r => ({
    rate_type: r.rate_type,
    rate: f(r.rate),
  }));
}

// ─── Student Loan ─────────────────────────────────────────────────────────────

export async function getStudentLoanThresholds(taxYear, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${STUDENT_LOAN_COLS} FROM student_loan_thresholds WHERE tax_year = $1`,
    [taxYear]
  );
  return rows.map(r => ({
    plan: r.plan,
    annual_threshold: f(r.annual_threshold),
    rate: f(r.rate),
  }));
}

// ─── YTD ─────────────────────────────────────────────────────────────────────

/**
 * Get the current YTD totals for a staff member in a tax year.
 * Returns null if no approved run exists yet for this year.
 */
export async function getYTD(homeId, staffId, taxYear, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${YTD_COLS} FROM payroll_ytd
     WHERE home_id = $1 AND staff_id = $2 AND tax_year = $3`,
    [homeId, staffId, taxYear]
  );
  return rows[0] ? shapeYTD(rows[0]) : null;
}

/**
 * Increment YTD totals. Called ONLY from approveRun.
 * Uses ON CONFLICT ... DO UPDATE with increments (NOT absolute values).
 */
export async function upsertYTD(homeId, staffId, taxYear, increments, client) {
  const conn = client || pool;
  const {
    gross_pay = 0, taxable_pay = 0, tax_deducted = 0,
    employee_ni = 0, employer_ni = 0, student_loan = 0,
    pension_employee = 0, pension_employer = 0,
    holiday_pay = 0, ssp_amount = 0, net_pay = 0,
  } = increments;
  const { rows } = await conn.query(
    `INSERT INTO payroll_ytd
       (home_id, staff_id, tax_year, gross_pay, taxable_pay, tax_deducted,
        employee_ni, employer_ni, student_loan, pension_employee, pension_employer,
        holiday_pay, ssp_amount, net_pay, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
     ON CONFLICT (home_id, staff_id, tax_year) DO UPDATE SET
       gross_pay        = payroll_ytd.gross_pay        + EXCLUDED.gross_pay,
       taxable_pay      = payroll_ytd.taxable_pay      + EXCLUDED.taxable_pay,
       tax_deducted     = payroll_ytd.tax_deducted     + EXCLUDED.tax_deducted,
       employee_ni      = payroll_ytd.employee_ni      + EXCLUDED.employee_ni,
       employer_ni      = payroll_ytd.employer_ni      + EXCLUDED.employer_ni,
       student_loan     = payroll_ytd.student_loan     + EXCLUDED.student_loan,
       pension_employee = payroll_ytd.pension_employee + EXCLUDED.pension_employee,
       pension_employer = payroll_ytd.pension_employer + EXCLUDED.pension_employer,
       holiday_pay      = payroll_ytd.holiday_pay      + EXCLUDED.holiday_pay,
       ssp_amount       = payroll_ytd.ssp_amount       + EXCLUDED.ssp_amount,
       net_pay          = payroll_ytd.net_pay          + EXCLUDED.net_pay,
       updated_at       = NOW()
     RETURNING ${YTD_COLS}`,
    [
      homeId, staffId, taxYear,
      gross_pay, taxable_pay, tax_deducted,
      employee_ni, employer_ni, student_loan,
      pension_employee, pension_employer,
      holiday_pay, ssp_amount, net_pay,
    ]
  );
  return shapeYTD(rows[0]);
}

/**
 * Batch-increment YTD totals for all staff in one INSERT ... ON CONFLICT.
 * Called ONLY from approveRun. Replaces N sequential upsertYTD calls.
 * @param {number} homeId
 * @param {number} taxYear
 * @param {Array<{staff_id, gross_pay, taxable_pay, ...}>} rows
 * @param {object} client - transaction client (required)
 */
export async function upsertYTDBatch(homeId, taxYear, rows, client) {
  if (!rows.length) return;
  const conn = client || pool;
  const valueParts = [];
  const params = [];
  for (const r of rows) {
    const base = params.length;
    const { gross_pay=0, taxable_pay=0, tax_deducted=0, employee_ni=0, employer_ni=0,
            student_loan=0, pension_employee=0, pension_employer=0,
            holiday_pay=0, ssp_amount=0, net_pay=0 } = r;
    params.push(homeId, r.staff_id, taxYear,
      gross_pay, taxable_pay, tax_deducted,
      employee_ni, employer_ni, student_loan,
      pension_employee, pension_employer,
      holiday_pay, ssp_amount, net_pay);
    const s = n => `$${base + n}`;
    valueParts.push(`(${s(1)},${s(2)},${s(3)},${s(4)},${s(5)},${s(6)},${s(7)},${s(8)},${s(9)},${s(10)},${s(11)},${s(12)},${s(13)},${s(14)},NOW())`);
  }
  await conn.query(
    `INSERT INTO payroll_ytd
       (home_id, staff_id, tax_year, gross_pay, taxable_pay, tax_deducted,
        employee_ni, employer_ni, student_loan, pension_employee, pension_employer,
        holiday_pay, ssp_amount, net_pay, updated_at)
     VALUES ${valueParts.join(', ')}
     ON CONFLICT (home_id, staff_id, tax_year) DO UPDATE SET
       gross_pay        = payroll_ytd.gross_pay        + EXCLUDED.gross_pay,
       taxable_pay      = payroll_ytd.taxable_pay      + EXCLUDED.taxable_pay,
       tax_deducted     = payroll_ytd.tax_deducted     + EXCLUDED.tax_deducted,
       employee_ni      = payroll_ytd.employee_ni      + EXCLUDED.employee_ni,
       employer_ni      = payroll_ytd.employer_ni      + EXCLUDED.employer_ni,
       student_loan     = payroll_ytd.student_loan     + EXCLUDED.student_loan,
       pension_employee = payroll_ytd.pension_employee + EXCLUDED.pension_employee,
       pension_employer = payroll_ytd.pension_employer + EXCLUDED.pension_employer,
       holiday_pay      = payroll_ytd.holiday_pay      + EXCLUDED.holiday_pay,
       ssp_amount       = payroll_ytd.ssp_amount       + EXCLUDED.ssp_amount,
       net_pay          = payroll_ytd.net_pay          + EXCLUDED.net_pay,
       updated_at       = NOW()`,
    params,
  );
}

/**
 * Batch-subtract YTD amounts for all staff in a voided payroll run.
 * Most fields are floored at 0 (they cannot legitimately go negative).
 * tax_deducted and net_pay are NOT floored — both can be legitimately negative:
 *   - tax_deducted goes negative when a refund period has already been approved
 *   - net_pay can go negative when deductions exceed gross
 * Clamping either to 0 would corrupt subsequent cumulative PAYE calculations.
 * Rows that don't exist are silently ignored (nothing to reverse).
 * Called ONLY from the void-approved-run path in routes/payroll.js.
 */
export async function subtractYTDBatch(homeId, taxYear, rows, client) {
  if (!rows.length) return;
  const conn = client || pool;
  for (const r of rows) {
    const { gross_pay=0, taxable_pay=0, tax_deducted=0, employee_ni=0, employer_ni=0,
            student_loan=0, pension_employee=0, pension_employer=0,
            holiday_pay=0, ssp_amount=0, net_pay=0 } = r;
    await conn.query(
      `UPDATE payroll_ytd SET
         gross_pay        = GREATEST(0, gross_pay        - $4),
         taxable_pay      = GREATEST(0, taxable_pay      - $5),
         tax_deducted     = tax_deducted - $6,
         employee_ni      = GREATEST(0, employee_ni      - $7),
         employer_ni      = GREATEST(0, employer_ni      - $8),
         student_loan     = GREATEST(0, student_loan     - $9),
         pension_employee = GREATEST(0, pension_employee - $10),
         pension_employer = GREATEST(0, pension_employer - $11),
         holiday_pay      = GREATEST(0, holiday_pay      - $12),
         ssp_amount       = GREATEST(0, ssp_amount       - $13),
         net_pay          = net_pay - $14,
         updated_at       = NOW()
       WHERE home_id = $1 AND staff_id = $2 AND tax_year = $3`,
      [homeId, r.staff_id, taxYear,
       gross_pay, taxable_pay, tax_deducted,
       employee_ni, employer_ni, student_loan,
       pension_employee, pension_employer,
       holiday_pay, ssp_amount, net_pay],
    );
  }
}

/**
 * Batch-fetch YTD totals for multiple staff in a single query.
 * Replaces N sequential getYTD calls.
 */
export async function getYTDBatch(homeId, staffIds, taxYear, client) {
  if (!staffIds.length) return new Map();
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${YTD_COLS} FROM payroll_ytd
     WHERE home_id = $1 AND staff_id = ANY($2) AND tax_year = $3`,
    [homeId, staffIds, taxYear]
  );
  return new Map(rows.map(r => [r.staff_id, shapeYTD(r)]));
}

function shapeYTD(row) {
  return {
    home_id: row.home_id,
    staff_id: row.staff_id,
    tax_year: row.tax_year,
    gross_pay: f(row.gross_pay),
    taxable_pay: f(row.taxable_pay),
    tax_deducted: f(row.tax_deducted),
    employee_ni: f(row.employee_ni),
    employer_ni: f(row.employer_ni),
    student_loan: f(row.student_loan),
    pension_employee: f(row.pension_employee),
    pension_employer: f(row.pension_employer),
    holiday_pay: f(row.holiday_pay),
    ssp_amount: f(row.ssp_amount),
    net_pay: f(row.net_pay),
  };
}
