import { pool } from '../db.js';

const TRANSITION_COLS = 'id, home_id, bed_id, from_status, to_status, resident_id, changed_by, changed_at, reason';

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
     RETURNING ${TRANSITION_COLS}`,
    [homeId, data.bedId, data.fromStatus || null, data.toStatus,
     data.residentId || null, data.changedBy || null, data.reason || null]
  );
  return shapeTransition(rows[0]);
}

export async function getTransitionsByBed(bedId, homeId, { limit = 50 } = {}, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `/* bedTransitionRepo – getTransitionsByBed */
     SELECT ${TRANSITION_COLS} FROM bed_transitions
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
     SELECT ${TRANSITION_COLS} FROM bed_transitions
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
     WITH months AS (
       SELECT generate_series(
         date_trunc('month', NOW()) - INTERVAL '${months - 1} months',
         date_trunc('month', NOW()),
         INTERVAL '1 month'
       ) AS month_start
     ),
     bed_list AS (
       SELECT id FROM beds WHERE home_id = $1 AND deleted_at IS NULL
     ),
     bed_month_status AS (
       SELECT
         bl.id AS bed_id,
         m.month_start,
         (
           SELECT bt2.to_status
           FROM bed_transitions bt2
           WHERE bt2.bed_id = bl.id
             AND bt2.changed_at <= (m.month_start + INTERVAL '1 month' - INTERVAL '1 second')
           ORDER BY bt2.changed_at DESC
           LIMIT 1
         ) AS status_at_month_end
       FROM bed_list bl
       CROSS JOIN months m
     )
     SELECT
       TO_CHAR(month_start, 'Mon YYYY') AS month,
       COUNT(*) FILTER (WHERE status_at_month_end = 'occupied')::int AS occupied,
       COUNT(*) FILTER (WHERE status_at_month_end = 'available')::int AS available,
       COUNT(*) FILTER (WHERE status_at_month_end = 'reserved')::int AS reserved,
       COUNT(*)::int AS total,
       ROUND(
         COUNT(*) FILTER (WHERE status_at_month_end = 'occupied')::numeric /
         NULLIF(COUNT(*), 0) * 100,
         1
       ) AS occupancy_rate
     FROM bed_month_status
     GROUP BY month_start
     ORDER BY month_start`,
    [homeId]
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
         AND changed_at >= (CURRENT_DATE - make_interval(months => $2))
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
         AND changed_at >= (CURRENT_DATE - make_interval(months => $2))
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
