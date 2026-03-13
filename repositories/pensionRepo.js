import { pool, toDateStr } from '../db.js';

function f(v) { return v != null ? parseFloat(v) : null; }

const CONFIG_COLS = `id, effective_from, lower_qualifying_weekly, upper_qualifying_weekly,
  trigger_annual, employee_rate, employer_rate, state_pension_age`;

const ENROLMENT_COLS = `id, home_id, staff_id, status,
  enrolled_date, opted_out_date, postponed_until, reassessment_date,
  notes, updated_at`;

const CONTRIBUTION_COLS = `id, home_id, payroll_line_id, staff_id,
  qualifying_pay, employee_amount, employer_amount`;

// ─── Pension Config ───────────────────────────────────────────────────────────

/**
 * Get the most recent pension config effective on or before payDate.
 */
export async function getPensionConfig(payDate, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${CONFIG_COLS} FROM pension_config
     WHERE effective_from <= $1
     ORDER BY effective_from DESC
     LIMIT 1`,
    [payDate]
  );
  return rows[0] ? shapeConfig(rows[0]) : null;
}

function shapeConfig(row) {
  return {
    id: row.id,
    effective_from: toDateStr(row.effective_from),
    lower_qualifying_weekly: f(row.lower_qualifying_weekly),
    upper_qualifying_weekly: f(row.upper_qualifying_weekly),
    trigger_annual: f(row.trigger_annual),
    employee_rate: f(row.employee_rate),
    employer_rate: f(row.employer_rate),
    state_pension_age: row.state_pension_age,
  };
}

// ─── Enrolments ───────────────────────────────────────────────────────────────

export async function getEnrolment(homeId, staffId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${ENROLMENT_COLS} FROM pension_enrolments WHERE home_id = $1 AND staff_id = $2`,
    [homeId, staffId]
  );
  return rows[0] ? shapeEnrolment(rows[0]) : null;
}

export async function getEnrolmentBatch(homeId, staffIds, client) {
  if (!staffIds.length) return new Map();
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${ENROLMENT_COLS} FROM pension_enrolments WHERE home_id = $1 AND staff_id = ANY($2)`,
    [homeId, staffIds]
  );
  return new Map(rows.map(r => [r.staff_id, shapeEnrolment(r)]));
}

export async function listEnrolmentsByHome(homeId) {
  const { rows } = await pool.query(
    `SELECT ${ENROLMENT_COLS} FROM pension_enrolments WHERE home_id = $1 ORDER BY staff_id`,
    [homeId]
  );
  return rows.map(shapeEnrolment);
}

export async function upsertEnrolment(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO pension_enrolments
       (home_id, staff_id, status, enrolled_date, opted_out_date, postponed_until,
        reassessment_date, notes, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (home_id, staff_id) DO UPDATE SET
       status            = EXCLUDED.status,
       enrolled_date     = EXCLUDED.enrolled_date,
       opted_out_date    = EXCLUDED.opted_out_date,
       postponed_until   = EXCLUDED.postponed_until,
       reassessment_date = EXCLUDED.reassessment_date,
       notes             = EXCLUDED.notes,
       updated_at        = NOW()
     RETURNING ${ENROLMENT_COLS}`,
    [
      homeId, data.staff_id, data.status ?? 'pending_assessment',
      data.enrolled_date || null, data.opted_out_date || null,
      data.postponed_until || null, data.reassessment_date || null,
      data.notes || null,
    ]
  );
  return shapeEnrolment(rows[0]);
}

function shapeEnrolment(row) {
  return {
    id: row.id,
    home_id: row.home_id,
    staff_id: row.staff_id,
    status: row.status,
    enrolled_date: toDateStr(row.enrolled_date),
    opted_out_date: toDateStr(row.opted_out_date),
    postponed_until: toDateStr(row.postponed_until),
    reassessment_date: toDateStr(row.reassessment_date),
    notes: row.notes || null,
    updated_at: row.updated_at,
  };
}

// ─── Contributions ────────────────────────────────────────────────────────────

function shapeContribution(row) {
  return {
    id: row.id,
    payroll_line_id: row.payroll_line_id,
    staff_id: row.staff_id,
    qualifying_pay:  f(row.qualifying_pay),
    employee_amount: f(row.employee_amount),
    employer_amount: f(row.employer_amount),
  };
}

/**
 * Insert a contribution record. Previous records for this payroll_line_id
 * are deleted via ON DELETE CASCADE when the payroll line is replaced on recalculate.
 */
export async function insertContribution(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO pension_contributions
       (home_id, payroll_line_id, staff_id, qualifying_pay, employee_amount, employer_amount)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING ${CONTRIBUTION_COLS}`,
    [
      homeId, data.payroll_line_id, data.staff_id,
      data.qualifying_pay, data.employee_amount, data.employer_amount,
    ]
  );
  return shapeContribution(rows[0]);
}

export async function getContributionsByRun(homeId, runId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${CONTRIBUTION_COLS.split(',').map(c => `pc.${c.trim()}`).join(', ')}
     FROM pension_contributions pc
     JOIN payroll_lines pl ON pl.id = pc.payroll_line_id
     JOIN payroll_runs pr ON pr.id = pl.payroll_run_id
     WHERE pl.payroll_run_id = $1 AND pr.home_id = $2
     ORDER BY pc.staff_id`,
    [runId, homeId]
  );
  return rows.map(shapeContribution);
}
