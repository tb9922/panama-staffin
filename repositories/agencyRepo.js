import { pool } from '../db.js';

// ── agency_providers ──────────────────────────────────────────────────────────

function shapeProvider(row) {
  return {
    id: row.id,
    home_id: row.home_id,
    name: row.name,
    contact: row.contact,
    rate_day: row.rate_day != null ? parseFloat(row.rate_day) : null,
    rate_night: row.rate_night != null ? parseFloat(row.rate_night) : null,
    active: row.active,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

export async function findProvidersByHome(homeId) {
  const { rows } = await pool.query(
    `SELECT * FROM agency_providers WHERE home_id = $1 ORDER BY name`,
    [homeId],
  );
  return rows.map(shapeProvider);
}

export async function findProviderById(id, homeId) {
  const { rows } = await pool.query(
    `SELECT * FROM agency_providers WHERE id = $1 AND home_id = $2`,
    [id, homeId],
  );
  return rows.length > 0 ? shapeProvider(rows[0]) : null;
}

export async function createProvider(homeId, provider, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO agency_providers (home_id, name, contact, rate_day, rate_night)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [homeId, provider.name, provider.contact || null, provider.rate_day ?? null, provider.rate_night ?? null],
  );
  return shapeProvider(rows[0]);
}

export async function updateProvider(id, homeId, updates, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE agency_providers
     SET name = $1, contact = $2, rate_day = $3, rate_night = $4, active = $5
     WHERE id = $6 AND home_id = $7
     RETURNING *`,
    [updates.name, updates.contact || null, updates.rate_day ?? null, updates.rate_night ?? null,
     updates.active ?? true, id, homeId],
  );
  return rows.length > 0 ? shapeProvider(rows[0]) : null;
}

// ── agency_shifts ─────────────────────────────────────────────────────────────

function shapeShift(row) {
  const toDate = (v) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  return {
    id: row.id,
    home_id: row.home_id,
    agency_id: row.agency_id,
    agency_name: row.agency_name, // joined from providers
    date: toDate(row.date),
    shift_code: row.shift_code,
    hours: parseFloat(row.hours),
    hourly_rate: parseFloat(row.hourly_rate),
    total_cost: parseFloat(row.total_cost),
    worker_name: row.worker_name,
    invoice_ref: row.invoice_ref,
    reconciled: row.reconciled,
    role_covered: row.role_covered,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

export async function findShiftsByHomePeriod(homeId, start, end) {
  const { rows } = await pool.query(
    `SELECT s.*, p.name AS agency_name
     FROM agency_shifts s
     JOIN agency_providers p ON p.id = s.agency_id AND p.home_id = s.home_id
     WHERE s.home_id = $1 AND s.date >= $2 AND s.date <= $3
     ORDER BY s.date DESC`,
    [homeId, start, end],
  );
  return rows.map(shapeShift);
}

export async function createShift(homeId, shift, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO agency_shifts
       (home_id, agency_id, date, shift_code, hours, hourly_rate, total_cost,
        worker_name, invoice_ref, reconciled, role_covered)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      homeId, shift.agency_id, shift.date, shift.shift_code,
      shift.hours, shift.hourly_rate, shift.total_cost,
      shift.worker_name || null, shift.invoice_ref || null,
      shift.reconciled ?? false, shift.role_covered || null,
    ],
  );
  // Fetch with agency name joined
  return findShiftById(rows[0].id, homeId, conn);
}

export async function findShiftById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT s.*, p.name AS agency_name
     FROM agency_shifts s
     JOIN agency_providers p ON p.id = s.agency_id AND p.home_id = s.home_id
     WHERE s.id = $1 AND s.home_id = $2`,
    [id, homeId],
  );
  return rows.length > 0 ? shapeShift(rows[0]) : null;
}

export async function updateShift(id, homeId, updates, client) {
  const conn = client || pool;
  await conn.query(
    `UPDATE agency_shifts
     SET agency_id = $1, date = $2, shift_code = $3, hours = $4, hourly_rate = $5,
         total_cost = $6, worker_name = $7, invoice_ref = $8, reconciled = $9, role_covered = $10
     WHERE id = $11 AND home_id = $12`,
    [
      updates.agency_id, updates.date, updates.shift_code, updates.hours,
      updates.hourly_rate, updates.total_cost, updates.worker_name || null,
      updates.invoice_ref || null, updates.reconciled ?? false, updates.role_covered || null,
      id, homeId,
    ],
  );
  return findShiftById(id, homeId);
}

/**
 * Metrics for the agency dashboard.
 * Returns weekly spend for the last N weeks plus totals.
 */
export async function getMetrics(homeId, weeksBack) {
  const { rows } = await pool.query(
    `SELECT
       DATE_TRUNC('week', date) AS week_start,
       SUM(total_cost) AS week_cost,
       SUM(hours) AS week_hours,
       COUNT(*) AS shift_count
     FROM agency_shifts
     WHERE home_id = $1 AND date >= NOW() - ($2 * INTERVAL '1 week')
     GROUP BY week_start
     ORDER BY week_start DESC`,
    [homeId, weeksBack],
  );

  const { rows: totals } = await pool.query(
    `SELECT
       COALESCE(SUM(total_cost) FILTER (WHERE date >= date_trunc('week', NOW())), 0) AS this_week,
       COALESCE(SUM(total_cost) FILTER (WHERE date >= date_trunc('month', NOW())), 0) AS this_month,
       COALESCE(SUM(hours) FILTER (WHERE date >= date_trunc('month', NOW())), 0) AS hours_this_month,
       COALESCE(AVG(hourly_rate), 0) AS avg_rate,
       MAX(date) AS last_agency_date
     FROM agency_shifts WHERE home_id = $1`,
    [homeId],
  );

  return {
    weeklyTrend: rows.map(r => ({
      week_start: r.week_start instanceof Date ? r.week_start.toISOString().slice(0, 10) : String(r.week_start).slice(0, 10),
      cost: parseFloat(r.week_cost),
      hours: parseFloat(r.week_hours),
      shifts: parseInt(r.shift_count, 10),
    })),
    thisWeek: parseFloat(totals[0].this_week),
    thisMonth: parseFloat(totals[0].this_month),
    hoursThisMonth: parseFloat(totals[0].hours_this_month),
    avgRate: parseFloat(totals[0].avg_rate),
    lastAgencyDate: totals[0].last_agency_date
      ? (totals[0].last_agency_date instanceof Date
          ? totals[0].last_agency_date.toISOString().slice(0, 10)
          : String(totals[0].last_agency_date).slice(0, 10))
      : null,
  };
}
