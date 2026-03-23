import { pool, toDateStr } from '../db.js';

function f(v) { return v != null ? parseFloat(v) : null; }

const SSP_CONFIG_COLS = 'id, effective_from, weekly_rate, waiting_days, lel_weekly, max_weeks';

const SICK_PERIOD_COLS = `id, home_id, staff_id, start_date, end_date,
  qualifying_days_per_week, waiting_days_served, ssp_weeks_paid,
  fit_note_received, fit_note_date, linked_to_period_id, notes,
  created_at, updated_at`;

const ENHANCED_SICK_COLS = 'id, home_id, full_pay_weeks, half_pay_weeks, notes, updated_at';

// ─── SSP Config ───────────────────────────────────────────────────────────────

/**
 * Get all SSP config rows from DB (passed to pure calculateSSP functions).
 * Caller picks the right row using getSSPConfig(payDate, configs) from payrollTax.js.
 */
export async function getAllSSPConfigs(client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${SSP_CONFIG_COLS} FROM ssp_config ORDER BY effective_from`
  );
  return rows.map(r => ({
    effective_from: toDateStr(r.effective_from),
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
 * Pass forUpdate: true (and a transaction client) to lock the row — required when
 * reading ssp_weeks_paid before updating it (prevents lost-update race on approve/void).
 */
export async function getActiveSickPeriod(homeId, staffId, fromDate, toDate, client, { forUpdate = false } = {}) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${SICK_PERIOD_COLS} FROM sick_periods
     WHERE home_id = $1 AND staff_id = $2
       AND start_date <= $3
       AND (end_date IS NULL OR end_date >= $4)
     ORDER BY start_date DESC
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [homeId, staffId, toDate, fromDate]
  );
  return rows[0] ? shapePeriod(rows[0]) : null;
}

/**
 * Batch-load active sick periods for multiple staff overlapping a date range.
 * Returns Map<staffId, sickPeriod[]>.
 */
export async function getActiveSickPeriodsBatch(homeId, staffIds, fromDate, toDate, client) {
  if (!staffIds.length) return new Map();
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${SICK_PERIOD_COLS} FROM sick_periods
     WHERE home_id = $1 AND staff_id = ANY($2)
       AND start_date <= $3
       AND (end_date IS NULL OR end_date >= $4)
     ORDER BY staff_id, start_date DESC`,
    [homeId, staffIds, toDate, fromDate]
  );
  const map = new Map();
  for (const r of rows) {
    const shaped = shapePeriod(r);
    if (!map.has(r.staff_id)) map.set(r.staff_id, []);
    map.get(r.staff_id).push(shaped);
  }
  return map;
}

export async function listSickPeriods(homeId, staffId, client) {
  const conn = client || pool;
  const params = staffId ? [homeId, staffId] : [homeId];
  const filter = staffId ? 'AND staff_id = $2' : '';
  const { rows } = await conn.query(
    `SELECT ${SICK_PERIOD_COLS} FROM sick_periods
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
     RETURNING ${SICK_PERIOD_COLS}`,
    [
      homeId, data.staff_id, data.start_date, data.end_date || null,
      data.qualifying_days_per_week || 5,
      data.waiting_days_served ?? 0, data.ssp_weeks_paid ?? 0,
      data.fit_note_received ?? false, data.fit_note_date || null,
      data.linked_to_period_id || null, data.notes || null,
    ]
  );
  return shapePeriod(rows[0]);
}

export async function updateSickPeriod(id, homeId, data, client) {
  const conn = client || pool;
  const ALLOWED = ['end_date', 'waiting_days_served', 'ssp_weeks_paid', 'fit_note_received', 'fit_note_date', 'notes'];
  const fields = [];
  const values = [id, homeId];
  let idx = 3;
  for (const col of ALLOWED) {
    if (col in data) {
      fields.push(`${col} = $${idx++}`);
      values.push(data[col] ?? null);
    }
  }
  if (fields.length === 0) return null;
  fields.push('updated_at = NOW()');
  const { rows } = await conn.query(
    `UPDATE sick_periods SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 RETURNING ${SICK_PERIOD_COLS}`,
    values
  );
  return rows[0] ? shapePeriod(rows[0]) : null;
}

/**
 * Find the most recent closed sick period that ended within `daysGap` days
 * before `startDate`. Used for SSP linking — if a previous period ended within
 * 56 days (8 weeks), waiting days don't restart (SSP Regs 1982, Reg 2).
 */
export async function findRecentClosedPeriod(homeId, staffId, startDate, daysGap, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${SICK_PERIOD_COLS} FROM sick_periods
     WHERE home_id = $1 AND staff_id = $2
       AND end_date IS NOT NULL
       AND end_date >= $3::date - INTERVAL '1 day' * $4
       AND end_date < $3::date
     ORDER BY end_date DESC LIMIT 1`,
    [homeId, staffId, startDate, daysGap],
  );
  return rows[0] ? shapePeriod(rows[0]) : null;
}

// ─── Enhanced Sick Config ─────────────────────────────────────────────────────

export async function getEnhancedSickConfig(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${ENHANCED_SICK_COLS} FROM enhanced_sick_config WHERE home_id = $1`,
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
    start_date: toDateStr(row.start_date),
    end_date: toDateStr(row.end_date),
    qualifying_days_per_week: row.qualifying_days_per_week,
    waiting_days_served: row.waiting_days_served,
    ssp_weeks_paid: f(row.ssp_weeks_paid),
    fit_note_received: row.fit_note_received,
    fit_note_date: toDateStr(row.fit_note_date),
    linked_to_period_id: row.linked_to_period_id || null,
    notes: row.notes || null,
  };
}
