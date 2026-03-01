import { pool } from '../db.js';

function d(v) { return v instanceof Date ? v.toISOString().slice(0, 10) : v; }
function ts(v) { return v instanceof Date ? v.toISOString() : v; }
const f = v => v != null ? parseFloat(v) : null;

// ── Shape ───────────────────────────────────────────────────────────────────

function shapeTransition(row) {
  if (!row) return null;
  return {
    id: row.id,
    home_id: row.home_id,
    bed_id: row.bed_id,
    from_status: row.from_status,
    to_status: row.to_status,
    resident_id: row.resident_id,
    changed_by: row.changed_by,
    changed_at: ts(row.changed_at),
    reason: row.reason,
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function recordTransition(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `/* bedTransitionRepo – recordTransition */
     INSERT INTO bed_transitions
       (home_id, bed_id, from_status, to_status, resident_id, changed_by, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [homeId, data.bedId, data.fromStatus || null, data.toStatus,
     data.residentId || null, data.changedBy || null, data.reason || null]
  );
  return shapeTransition(rows[0]);
}

export async function getTransitionsByBed(bedId, homeId, { limit = 50 } = {}, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `/* bedTransitionRepo – getTransitionsByBed */
     SELECT * FROM bed_transitions
     WHERE bed_id = $1 AND home_id = $2
     ORDER BY changed_at DESC
     LIMIT $3`,
    [bedId, homeId, Math.min(limit, 500)]
  );
  return rows.map(shapeTransition);
}

export async function getLatestTransition(bedId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `/* bedTransitionRepo – getLatestTransition */
     SELECT * FROM bed_transitions
     WHERE bed_id = $1 AND home_id = $2
     ORDER BY changed_at DESC
     LIMIT 1`,
    [bedId, homeId]
  );
  return shapeTransition(rows[0]);
}

export async function getMonthlyOccupancy(homeId, months = 12, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `/* bedTransitionRepo – getMonthlyOccupancy */
     WITH month_series AS (
       SELECT TO_CHAR(d, 'YYYY-MM') AS month
       FROM generate_series(
         DATE_TRUNC('month', CURRENT_DATE - ($2 || ' months')::interval),
         DATE_TRUNC('month', CURRENT_DATE),
         '1 month'
       ) AS d
     ),
     bed_counts AS (
       SELECT
         COUNT(*)::int AS total,
         COALESCE(COUNT(*) FILTER (WHERE status = 'occupied'), 0)::int AS occupied,
         COALESCE(COUNT(*) FILTER (WHERE status = 'decommissioned'), 0)::int AS decommissioned
       FROM beds
       WHERE home_id = $1
     )
     SELECT
       ms.month,
       CASE WHEN (bc.total - bc.decommissioned) > 0
         THEN ROUND(bc.occupied::numeric / (bc.total - bc.decommissioned) * 100, 2)
         ELSE 100
       END AS occupancy_rate
     FROM month_series ms
     CROSS JOIN bed_counts bc
     ORDER BY ms.month`,
    [homeId, months]
  );
  return rows.map(r => ({ month: r.month, occupancyRate: f(r.occupancy_rate) }));
}

export async function getAverageVacancyDuration(homeId, months = 12, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `/* bedTransitionRepo – getAverageVacancyDuration */
     WITH vacancy_starts AS (
       SELECT bed_id, changed_at AS vacant_at,
              ROW_NUMBER() OVER (PARTITION BY bed_id ORDER BY changed_at) AS rn
       FROM bed_transitions
       WHERE home_id = $1
         AND to_status = 'available'
         AND changed_at >= (CURRENT_DATE - ($2 || ' months')::interval)
     ),
     next_occupied AS (
       SELECT vs.bed_id, vs.vacant_at,
              MIN(bt.changed_at) AS occupied_at
       FROM vacancy_starts vs
       INNER JOIN bed_transitions bt
         ON bt.bed_id = vs.bed_id
         AND bt.home_id = $1
         AND bt.to_status = 'occupied'
         AND bt.changed_at > vs.vacant_at
       GROUP BY vs.bed_id, vs.vacant_at
     )
     SELECT COALESCE(
       ROUND(AVG(EXTRACT(EPOCH FROM (occupied_at - vacant_at)) / 86400), 1),
       0
     ) AS avg_days
     FROM next_occupied`,
    [homeId, months]
  );
  return { avgDays: f(rows[0].avg_days) };
}

export async function getAverageTurnaroundTime(homeId, months = 12, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `/* bedTransitionRepo – getAverageTurnaroundTime */
     WITH vacating_events AS (
       SELECT bed_id, changed_at AS vacated_at
       FROM bed_transitions
       WHERE home_id = $1
         AND from_status = 'occupied'
         AND to_status != 'occupied'
         AND changed_at >= (CURRENT_DATE - ($2 || ' months')::interval)
     ),
     next_available AS (
       SELECT ve.bed_id, ve.vacated_at,
              MIN(bt.changed_at) AS available_at
       FROM vacating_events ve
       INNER JOIN bed_transitions bt
         ON bt.bed_id = ve.bed_id
         AND bt.home_id = $1
         AND bt.to_status = 'available'
         AND bt.changed_at > ve.vacated_at
       GROUP BY ve.bed_id, ve.vacated_at
     )
     SELECT COALESCE(
       ROUND(AVG(EXTRACT(EPOCH FROM (available_at - vacated_at)) / 86400), 1),
       0
     ) AS avg_days
     FROM next_available`,
    [homeId, months]
  );
  return { avgDays: f(rows[0].avg_days) };
}
