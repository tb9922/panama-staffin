import { pool } from '../db.js';

// ── payroll_runs ──────────────────────────────────────────────────────────────

function shapeRun(row) {
  const toDate = (v) => v
    ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
    : null;
  const toTs = (v) => v instanceof Date ? v.toISOString() : v;

  return {
    id: row.id,
    home_id: row.home_id,
    period_start: toDate(row.period_start),
    period_end: toDate(row.period_end),
    pay_frequency: row.pay_frequency,
    status: row.status,
    total_gross: row.total_gross != null ? parseFloat(row.total_gross) : null,
    total_enhancements: row.total_enhancements != null ? parseFloat(row.total_enhancements) : null,
    total_sleep_ins: row.total_sleep_ins != null ? parseFloat(row.total_sleep_ins) : null,
    staff_count: row.staff_count,
    calculated_at: toTs(row.calculated_at),
    approved_by: row.approved_by,
    approved_at: toTs(row.approved_at),
    exported_at: toTs(row.exported_at),
    export_format: row.export_format,
    ytd_applied: !!row.ytd_applied,
    notes: row.notes,
    version: row.version,
    created_at: toTs(row.created_at),
    updated_at: toTs(row.updated_at),
  };
}

export async function findByHome(homeId) {
  const { rows } = await pool.query(
    `SELECT * FROM payroll_runs WHERE home_id = $1 ORDER BY period_start DESC`,
    [homeId],
  );
  return rows.map(shapeRun);
}

export async function findById(runId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT * FROM payroll_runs WHERE id = $1 AND home_id = $2`,
    [runId, homeId],
  );
  return rows.length > 0 ? shapeRun(rows[0]) : null;
}

/** Lock the row for the duration of the transaction — prevents concurrent calculate/approve races. */
export async function findByIdForUpdate(runId, homeId, client) {
  if (!client) throw new Error('findByIdForUpdate requires a transaction client');
  const { rows } = await client.query(
    `SELECT * FROM payroll_runs WHERE id = $1 AND home_id = $2 FOR UPDATE`,
    [runId, homeId],
  );
  return rows.length > 0 ? shapeRun(rows[0]) : null;
}

/** Check if any non-voided run overlaps the given date range for this home. */
export async function hasOverlap(homeId, periodStart, periodEnd, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT COUNT(*) AS cnt FROM payroll_runs
     WHERE home_id = $1 AND status NOT IN ('voided')
       AND period_start <= $3 AND period_end >= $2`,
    [homeId, periodStart, periodEnd],
  );
  return parseInt(rows[0].cnt, 10) > 0;
}

export async function create(homeId, run, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO payroll_runs (home_id, period_start, period_end, pay_frequency, notes)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [homeId, run.period_start, run.period_end, run.pay_frequency, run.notes || null],
  );
  return shapeRun(rows[0]);
}

export async function updateStatus(runId, homeId, status, extra, client, version) {
  const conn = client || pool;
  // extra: { approved_by, exported_at, export_format, calculated_at } — any combination
  const sets = ['status = $1', 'updated_at = NOW()', 'version = version + 1'];
  const params = [status, runId, homeId];
  if (extra?.approved_by !== undefined) {
    params.push(extra.approved_by);
    sets.push(`approved_by = $${params.length}`);
    sets.push('approved_at = NOW()');
  }
  if (extra?.calculated_at) {
    sets.push('calculated_at = NOW()');
  }
  if (extra?.exported_at) {
    params.push(extra.export_format || null);
    sets.push(`exported_at = NOW()`);
    sets.push(`export_format = $${params.length}`);
  }
  let sql = `UPDATE payroll_runs SET ${sets.join(', ')} WHERE id = $2 AND home_id = $3`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ' RETURNING *';
  const { rows, rowCount } = await conn.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows.length > 0 ? shapeRun(rows[0]) : null;
}

export async function updateTotals(runId, homeId, totals, client, version) {
  const conn = client || pool;
  const params = [totals.total_gross, totals.total_enhancements, totals.total_sleep_ins, totals.staff_count, runId, homeId];
  let sql = `UPDATE payroll_runs
     SET total_gross = $1, total_enhancements = $2, total_sleep_ins = $3,
         staff_count = $4, calculated_at = NOW(), status = 'calculated', updated_at = NOW(),
         version = version + 1
     WHERE id = $5 AND home_id = $6`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ' RETURNING *';
  const { rows, rowCount } = await conn.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows.length > 0 ? shapeRun(rows[0]) : null;
}

/** Mark a run as having had YTD applied (prevents double-counting on re-approval). */
export async function markYtdApplied(runId, homeId, client) {
  const conn = client || pool;
  await conn.query(
    `UPDATE payroll_runs SET ytd_applied = true, updated_at = NOW() WHERE id = $1 AND home_id = $2`,
    [runId, homeId],
  );
}

/** Delete all lines + shifts for a run (used when recalculating). */
export async function deleteLines(runId, homeId, client) {
  const conn = client || pool;
  // payroll_line_shifts cascade deletes when payroll_lines are deleted
  await conn.query(
    `DELETE FROM payroll_lines
     WHERE payroll_run_id = $1
       AND payroll_run_id IN (SELECT id FROM payroll_runs WHERE id = $1 AND home_id = $2)`,
    [runId, homeId]
  );
}

// ── payroll_lines ─────────────────────────────────────────────────────────────

function shapeLine(row) {
  const f = (v) => v != null ? parseFloat(v) : 0;
  return {
    id: row.id,
    payroll_run_id: row.payroll_run_id,
    staff_id: row.staff_id,
    base_hours: f(row.base_hours),
    base_pay: f(row.base_pay),
    night_hours: f(row.night_hours),
    night_enhancement: f(row.night_enhancement),
    weekend_hours: f(row.weekend_hours),
    weekend_enhancement: f(row.weekend_enhancement),
    bank_holiday_hours: f(row.bank_holiday_hours),
    bank_holiday_enhancement: f(row.bank_holiday_enhancement),
    overtime_hours: f(row.overtime_hours),
    overtime_enhancement: f(row.overtime_enhancement),
    sleep_in_count: row.sleep_in_count ?? 0,
    sleep_in_pay: f(row.sleep_in_pay),
    on_call_hours: f(row.on_call_hours),
    on_call_enhancement: f(row.on_call_enhancement),
    total_hours: f(row.total_hours),
    total_enhancements: f(row.total_enhancements),
    gross_pay: f(row.gross_pay),
    nmw_compliant: row.nmw_compliant,
    nmw_lowest_rate: row.nmw_lowest_rate != null ? parseFloat(row.nmw_lowest_rate) : null,
    tax_code: row.tax_code,
    student_loan_plan: row.student_loan_plan,
    notes: row.notes,
    // Phase 2 deduction columns (default 0 for Phase 1 runs where columns are NULL)
    holiday_days: f(row.holiday_days),
    holiday_pay: f(row.holiday_pay),
    holiday_daily_rate: row.holiday_daily_rate != null ? parseFloat(row.holiday_daily_rate) : null,
    ssp_days: row.ssp_days != null ? parseInt(row.ssp_days, 10) : 0,
    ssp_amount: f(row.ssp_amount),
    enhanced_sick_amount: f(row.enhanced_sick_amount),
    pension_employee: f(row.pension_employee),
    pension_employer: f(row.pension_employer),
    tax_deducted: f(row.tax_deducted),
    employee_ni: f(row.employee_ni),
    employer_ni: f(row.employer_ni),
    student_loan: f(row.student_loan),
    other_deductions: f(row.other_deductions),
    net_pay: f(row.net_pay),
  };
}

export async function findLinesByRun(runId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT pl.* FROM payroll_lines pl
     JOIN payroll_runs pr ON pr.id = pl.payroll_run_id
     WHERE pl.payroll_run_id = $1 AND pr.home_id = $2
     ORDER BY pl.staff_id`,
    [runId, homeId],
  );
  return rows.map(shapeLine);
}

export async function createLine(runId, staffId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO payroll_lines (payroll_run_id, staff_id) VALUES ($1,$2) RETURNING *`,
    [runId, staffId],
  );
  return shapeLine(rows[0]);
}

export async function updateLine(lineId, homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE payroll_lines SET
       base_hours = $1, base_pay = $2,
       night_hours = $3, night_enhancement = $4,
       weekend_hours = $5, weekend_enhancement = $6,
       bank_holiday_hours = $7, bank_holiday_enhancement = $8,
       overtime_hours = $9, overtime_enhancement = $10,
       sleep_in_count = $11, sleep_in_pay = $12,
       on_call_hours = $13, on_call_enhancement = $14,
       total_hours = $15, total_enhancements = $16, gross_pay = $17,
       nmw_compliant = $18, nmw_lowest_rate = $19, notes = $20
     WHERE id = $21
       AND payroll_run_id IN (SELECT id FROM payroll_runs WHERE home_id = $22)
     RETURNING *`,
    [
      data.base_hours, data.base_pay,
      data.night_hours, data.night_enhancement,
      data.weekend_hours, data.weekend_enhancement,
      data.bank_holiday_hours, data.bank_holiday_enhancement,
      data.overtime_hours, data.overtime_enhancement,
      data.sleep_in_count, data.sleep_in_pay,
      data.on_call_hours, data.on_call_enhancement,
      data.total_hours, data.total_enhancements, data.gross_pay,
      data.nmw_compliant, data.nmw_lowest_rate ?? null, data.notes || null,
      lineId, homeId,
    ],
  );
  return rows.length > 0 ? shapeLine(rows[0]) : null;
}

/**
 * Update the 14 Phase 2 deduction columns on a payroll line.
 * Kept separate from updateLine to avoid changing its fixed 20-param signature.
 */
export async function updateLineDeductions(lineId, homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE payroll_lines SET
       holiday_days         = $1,
       holiday_pay          = $2,
       holiday_daily_rate   = $3,
       ssp_days             = $4,
       ssp_amount           = $5,
       enhanced_sick_amount = $6,
       pension_employee     = $7,
       pension_employer     = $8,
       tax_deducted         = $9,
       employee_ni          = $10,
       employer_ni          = $11,
       student_loan         = $12,
       other_deductions     = $13,
       net_pay              = $14
     WHERE id = $15
       AND payroll_run_id IN (SELECT id FROM payroll_runs WHERE home_id = $16)
     RETURNING *`,
    [
      data.holiday_days ?? 0,
      data.holiday_pay ?? 0,
      data.holiday_daily_rate ?? null,
      data.ssp_days ?? 0,
      data.ssp_amount ?? 0,
      data.enhanced_sick_amount ?? 0,
      data.pension_employee ?? 0,
      data.pension_employer ?? 0,
      data.tax_deducted ?? 0,
      data.employee_ni ?? 0,
      data.employer_ni ?? 0,
      data.student_loan ?? 0,
      data.other_deductions ?? 0,
      data.net_pay ?? 0,
      lineId, homeId,
    ],
  );
  return rows.length > 0 ? shapeLine(rows[0]) : null;
}

/** Check if any line in this run has nmw_compliant = false. */
export async function hasNmwViolations(runId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT COUNT(*) AS cnt FROM payroll_lines pl
     JOIN payroll_runs pr ON pr.id = pl.payroll_run_id
     WHERE pl.payroll_run_id = $1 AND pr.home_id = $2 AND pl.nmw_compliant = false`,
    [runId, homeId],
  );
  return parseInt(rows[0].cnt, 10) > 0;
}

// ── payroll_line_shifts ───────────────────────────────────────────────────────

function shapeLineShift(row) {
  const toDate = (v) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const f = (v) => v != null ? parseFloat(v) : 0;
  return {
    id: row.id,
    payroll_line_id: row.payroll_line_id,
    date: toDate(row.date),
    shift_code: row.shift_code,
    hours: f(row.hours),
    base_rate: f(row.base_rate),
    base_amount: f(row.base_amount),
    enhancements_json: row.enhancements_json,
    total_amount: f(row.total_amount),
    effective_hourly_rate: f(row.effective_hourly_rate),
  };
}

export async function createLineShift(lineId, shift, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO payroll_line_shifts
       (payroll_line_id, date, shift_code, hours, base_rate, base_amount,
        enhancements_json, total_amount, effective_hourly_rate)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      lineId, shift.date, shift.shift_code, shift.hours,
      shift.base_rate, shift.base_amount,
      shift.enhancements_json ? JSON.stringify(shift.enhancements_json) : null,
      shift.total_amount, shift.effective_hourly_rate,
    ],
  );
  return shapeLineShift(rows[0]);
}

export async function findShiftsByLine(lineId, homeId) {
  const { rows } = await pool.query(
    `SELECT pls.* FROM payroll_line_shifts pls
     JOIN payroll_lines pl ON pl.id = pls.payroll_line_id
     JOIN payroll_runs pr ON pr.id = pl.payroll_run_id
     WHERE pls.payroll_line_id = $1 AND pr.home_id = $2
     ORDER BY pls.date`,
    [lineId, homeId],
  );
  return rows.map(shapeLineShift);
}

/** Find all shift detail rows for a full run (used for payslip generation). */
export async function findShiftsByRun(runId, homeId) {
  const { rows } = await pool.query(
    `SELECT pls.*, pl.staff_id
     FROM payroll_line_shifts pls
     JOIN payroll_lines pl ON pl.id = pls.payroll_line_id
     JOIN payroll_runs pr ON pr.id = pl.payroll_run_id
     WHERE pl.payroll_run_id = $1 AND pr.home_id = $2
     ORDER BY pl.staff_id, pls.date`,
    [runId, homeId],
  );
  return rows.map(r => ({ ...shapeLineShift(r), staff_id: r.staff_id }));
}

/** Count SSP-paid sick days per staff in a run (for incrementing ssp_weeks_paid on approval). */
export async function getSSPDaysByRun(runId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT pl.staff_id,
            COUNT(*) FILTER (WHERE pls.total_amount > 0)::int AS ssp_days
     FROM payroll_line_shifts pls
     JOIN payroll_lines pl ON pl.id = pls.payroll_line_id
     JOIN payroll_runs pr ON pr.id = pl.payroll_run_id
     WHERE pl.payroll_run_id = $1 AND pr.home_id = $2
       AND pls.shift_code = 'SICK'
     GROUP BY pl.staff_id`,
    [runId, homeId],
  );
  return rows.map(r => ({ staff_id: r.staff_id, ssp_days: parseInt(r.ssp_days, 10) }));
}
