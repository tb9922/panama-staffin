import { pool, toDateStr } from '../db.js';

const COLS = `id, home_id, tax_year, tax_month, period_start, period_end,
  total_paye, total_employee_ni, total_employer_ni,
  employment_allowance_offset, total_due, payment_due_date,
  status, paid_date, paid_reference,
  created_at, updated_at`;

function f(v) { return v != null ? parseFloat(v) : null; }

function shapeRow(row) {
  return {
    id: row.id,
    home_id: row.home_id,
    tax_year: row.tax_year,
    tax_month: row.tax_month,
    period_start: toDateStr(row.period_start),
    period_end: toDateStr(row.period_end),
    total_paye: f(row.total_paye),
    total_employee_ni: f(row.total_employee_ni),
    total_employer_ni: f(row.total_employer_ni),
    employment_allowance_offset: f(row.employment_allowance_offset),
    total_due: f(row.total_due),
    payment_due_date: toDateStr(row.payment_due_date),
    status: row.status,
    paid_date: toDateStr(row.paid_date),
    paid_reference: row.paid_reference || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Upsert an HMRC liability for a given home/tax_year/tax_month.
 * Called from approveRun — accumulates across multiple runs in the same tax month.
 */
export async function upsertLiability(homeId, taxYear, taxMonth, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hmrc_liabilities
       (home_id, tax_year, tax_month, period_start, period_end,
        total_paye, total_employee_ni, total_employer_ni,
        employment_allowance_offset, total_due, payment_due_date,
        status, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
     ON CONFLICT (home_id, tax_year, tax_month) DO UPDATE SET
       total_paye                  = hmrc_liabilities.total_paye         + EXCLUDED.total_paye,
       total_employee_ni           = hmrc_liabilities.total_employee_ni  + EXCLUDED.total_employee_ni,
       total_employer_ni           = hmrc_liabilities.total_employer_ni  + EXCLUDED.total_employer_ni,
       employment_allowance_offset = hmrc_liabilities.employment_allowance_offset + EXCLUDED.employment_allowance_offset,
       total_due                   = hmrc_liabilities.total_due          + EXCLUDED.total_due,
       period_start                = LEAST(hmrc_liabilities.period_start, EXCLUDED.period_start),
       period_end                  = GREATEST(hmrc_liabilities.period_end, EXCLUDED.period_end),
       updated_at                  = NOW()
     RETURNING ${COLS}`,
    [
      homeId, taxYear, taxMonth,
      data.period_start, data.period_end,
      data.total_paye, data.total_employee_ni, data.total_employer_ni,
      data.employment_allowance_offset ?? 0,
      data.total_due, data.payment_due_date,
      data.status ?? 'unpaid',
    ]
  );
  return shapeRow(rows[0]);
}

export async function markPaid(id, homeId, paidDate, paidReference, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE hmrc_liabilities
     SET status = 'paid', paid_date = $3, paid_reference = $4, updated_at = NOW()
     WHERE id = $1 AND home_id = $2
     RETURNING ${COLS}`,
    [id, homeId, paidDate, paidReference || null]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function listLiabilities(homeId, taxYear) {
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM hmrc_liabilities
     WHERE home_id = $1 AND tax_year = $2
     ORDER BY tax_month`,
    [homeId, taxYear]
  );
  return rows.map(shapeRow);
}

/**
 * Mark overdue liabilities (status = 'unpaid' AND payment_due_date < today).
 * Called by a daily job or on-demand before listing.
 */
export async function refreshOverdueStatus(homeId, client) {
  const conn = client || pool;
  await conn.query(
    `UPDATE hmrc_liabilities
     SET status = 'overdue', updated_at = NOW()
     WHERE home_id = $1 AND status = 'unpaid' AND payment_due_date < CURRENT_DATE`,
    [homeId]
  );
}
