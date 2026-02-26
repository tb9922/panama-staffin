import { pool } from '../db.js';

function f(v) { return v != null ? parseFloat(v) : null; }

// ─── SSP Config ───────────────────────────────────────────────────────────────

/**
 * Get all SSP config rows from DB (passed to pure calculateSSP functions).
 * Caller picks the right row using getSSPConfig(payDate, configs) from payrollTax.js.
 */
export async function getAllSSPConfigs(client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM ssp_config ORDER BY effective_from'
  );
  return rows.map(r => ({
    effective_from: r.effective_from ? r.effective_from.toISOString().slice(0, 10) : null,
    weekly_rate: f(r.weekly_rate),
    waiting_days: r.waiting_days,
    lel_weekly: r.lel_weekly != null ? f(r.lel_weekly) : null,
    max_weeks: r.max_weeks,
  }));
}

// ─── Sick Periods ─────────────────────────────────────────────────────────────

/**
 * Get the active sick period overlapping a date range for a staff member.
 * Returns the most recently opened period where start_date <= toDate AND (end_date IS NULL OR end_date >= fromDate).
 */
export async function getActiveSickPeriod(homeId, staffId, fromDate, toDate, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT * FROM sick_periods
     WHERE home_id = $1 AND staff_id = $2
       AND start_date <= $3
       AND (end_date IS NULL OR end_date >= $4)
     ORDER BY start_date DESC
     LIMIT 1`,
    [homeId, staffId, toDate, fromDate]
  );
  return rows[0] ? shapePeriod(rows[0]) : null;
}

export async function listSickPeriods(homeId, staffId, client) {
  const conn = client || pool;
  const params = staffId ? [homeId, staffId] : [homeId];
  const filter = staffId ? 'AND staff_id = $2' : '';
  const { rows } = await conn.query(
    `SELECT * FROM sick_periods
     WHERE home_id = $1 ${filter}
     ORDER BY start_date DESC`,
    params
  );
  return rows.map(shapePeriod);
}

export async function createSickPeriod(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO sick_periods
       (home_id, staff_id, start_date, end_date, qualifying_days_per_week,
        waiting_days_served, ssp_weeks_paid, fit_note_received, fit_note_date,
        linked_to_period_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      homeId, data.staff_id, data.start_date, data.end_date || null,
      data.qualifying_days_per_week || 5,
      data.waiting_days_served || 0, data.ssp_weeks_paid || 0,
      data.fit_note_received || false, data.fit_note_date || null,
      data.linked_to_period_id || null, data.notes || null,
    ]
  );
  return shapePeriod(rows[0]);
}

export async function updateSickPeriod(id, homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE sick_periods SET
       end_date              = COALESCE($3, end_date),
       waiting_days_served   = COALESCE($4, waiting_days_served),
       ssp_weeks_paid        = COALESCE($5, ssp_weeks_paid),
       fit_note_received     = COALESCE($6, fit_note_received),
       fit_note_date         = COALESCE($7, fit_note_date),
       notes                 = COALESCE($8, notes),
       updated_at            = NOW()
     WHERE id = $1 AND home_id = $2
     RETURNING *`,
    [
      id, homeId,
      data.end_date !== undefined ? data.end_date : null,
      data.waiting_days_served !== undefined ? data.waiting_days_served : null,
      data.ssp_weeks_paid !== undefined ? data.ssp_weeks_paid : null,
      data.fit_note_received !== undefined ? data.fit_note_received : null,
      data.fit_note_date !== undefined ? data.fit_note_date : null,
      data.notes !== undefined ? data.notes : null,
    ]
  );
  return rows[0] ? shapePeriod(rows[0]) : null;
}

// ─── Enhanced Sick Config ─────────────────────────────────────────────────────

export async function getEnhancedSickConfig(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT * FROM enhanced_sick_config WHERE home_id = $1',
    [homeId]
  );
  return rows[0]
    ? { full_pay_weeks: rows[0].full_pay_weeks, half_pay_weeks: rows[0].half_pay_weeks }
    : { full_pay_weeks: 0, half_pay_weeks: 0 };
}

function shapePeriod(row) {
  return {
    id: row.id,
    home_id: row.home_id,
    staff_id: row.staff_id,
    start_date: row.start_date ? row.start_date.toISOString().slice(0, 10) : null,
    end_date: row.end_date ? row.end_date.toISOString().slice(0, 10) : null,
    qualifying_days_per_week: row.qualifying_days_per_week,
    waiting_days_served: row.waiting_days_served,
    ssp_weeks_paid: f(row.ssp_weeks_paid),
    fit_note_received: row.fit_note_received,
    fit_note_date: row.fit_note_date ? row.fit_note_date.toISOString().slice(0, 10) : null,
    linked_to_period_id: row.linked_to_period_id || null,
    notes: row.notes || null,
  };
}
