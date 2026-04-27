import { pool } from '../db.js';
import { toIsoOrNull } from '../lib/serverTimestamps.js';

const COLS = `
  id, home_id, metric_key, period_start, period_end, numerator, denominator,
  notes, recorded_by, recorded_at, version, updated_at, deleted_at
`;

function dateOnly(value) {
  if (!value) return null;
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function shapeRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: parseInt(row.id, 10),
    home_id: parseInt(row.home_id, 10),
    numerator: row.numerator == null ? null : Number(row.numerator),
    denominator: row.denominator == null ? null : Number(row.denominator),
    recorded_by: row.recorded_by == null ? null : parseInt(row.recorded_by, 10),
    version: row.version == null ? 1 : parseInt(row.version, 10),
    period_start: dateOnly(row.period_start),
    period_end: dateOnly(row.period_end),
    recorded_at: toIsoOrNull(row.recorded_at),
    updated_at: toIsoOrNull(row.updated_at),
    deleted_at: toIsoOrNull(row.deleted_at),
  };
}

export async function findManualMetrics(homeId, filters = {}, client = pool) {
  const params = [homeId];
  const clauses = ['home_id = $1', 'deleted_at IS NULL'];
  if (filters.metric_key) {
    params.push(filters.metric_key);
    clauses.push(`metric_key = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    clauses.push(`period_end >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`period_start <= $${params.length}`);
  }
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM outcome_metrics
      WHERE ${clauses.join(' AND ')}
      ORDER BY period_start DESC, metric_key`,
    params,
  );
  return rows.map(shapeRow);
}

export async function findById(id, homeId, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM outcome_metrics WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId],
  );
  return shapeRow(rows[0]);
}

export async function upsert(homeId, data, actorId = null, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO outcome_metrics (
       home_id, metric_key, period_start, period_end, numerator, denominator,
       notes, recorded_by, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,NOW()
     )
     ON CONFLICT (home_id, metric_key, period_start)
     DO UPDATE SET
       period_end = EXCLUDED.period_end,
       numerator = EXCLUDED.numerator,
       denominator = EXCLUDED.denominator,
       notes = EXCLUDED.notes,
       recorded_by = EXCLUDED.recorded_by,
       recorded_at = NOW(),
       updated_at = NOW(),
       version = outcome_metrics.version + 1,
       deleted_at = NULL
     RETURNING ${COLS}`,
    [
      homeId,
      data.metric_key,
      data.period_start,
      data.period_end,
      data.numerator ?? null,
      data.denominator ?? null,
      data.notes || null,
      actorId,
    ],
  );
  return shapeRow(rows[0]);
}

export async function update(id, homeId, data, version = null, actorId = null, client = pool) {
  const allowed = new Set(['metric_key', 'period_start', 'period_end', 'numerator', 'denominator', 'notes']);
  const fields = Object.entries(data).filter(([key, value]) => allowed.has(key) && value !== undefined);
  if (fields.length === 0) return findById(id, homeId, client);

  const params = [id, homeId, ...fields.map(([, value]) => value ?? null), actorId];
  const actorParam = params.length;
  const setClause = fields.map(([key], index) => `${key} = $${index + 3}`).join(', ');
  let sql = `
    UPDATE outcome_metrics
       SET ${setClause},
           recorded_by = COALESCE($${actorParam}, recorded_by),
           recorded_at = NOW(),
           updated_at = NOW(),
           version = version + 1
     WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL
  `;
  if (version != null) {
    params.push(version);
    sql += ` AND version = $${params.length}`;
  }
  sql += ` RETURNING ${COLS}`;
  const { rows, rowCount } = await client.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return shapeRow(rows[0]);
}

export async function softDelete(id, homeId, client = pool) {
  const { rowCount } = await client.query(
    `UPDATE outcome_metrics SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId],
  );
  return rowCount > 0;
}

export async function getDerivedMetrics(homeId, { from, to } = {}, client = pool) {
  const start = from || new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
  const end = to || new Date().toISOString().slice(0, 10);
  const incidents = await client.query(
    `SELECT
         COUNT(*)::int AS incidents_total,
         COUNT(*) FILTER (WHERE LOWER(COALESCE(type, '')) LIKE '%fall%')::int AS falls,
         COUNT(*) FILTER (
           WHERE LOWER(COALESCE(type, '')) LIKE '%uti%'
              OR LOWER(COALESCE(type, '')) LIKE '%infection%'
         )::int AS infections,
         COUNT(*) FILTER (
           WHERE LOWER(COALESCE(type, '')) LIKE '%pressure%'
              OR LOWER(COALESCE(type, '')) LIKE '%skin%'
         )::int AS pressure_sores
       FROM incidents
      WHERE home_id = $1 AND deleted_at IS NULL AND date >= $2 AND date <= $3`,
    [homeId, start, end],
  );
  const complaints = await client.query(
    `SELECT COUNT(*)::int AS complaints_total
       FROM complaints
      WHERE home_id = $1 AND deleted_at IS NULL AND date >= $2 AND date <= $3`,
    [homeId, start, end],
  );
  const incidentByCategory = await client.query(
    `SELECT COALESCE(NULLIF(TRIM(type), ''), 'Unknown') AS label, COUNT(*)::int AS count
       FROM incidents
      WHERE home_id = $1 AND deleted_at IS NULL AND date >= $2 AND date <= $3
      GROUP BY label
      ORDER BY count DESC, label
      LIMIT 12`,
    [homeId, start, end],
  );
  const incidentByLocation = await client.query(
    `SELECT COALESCE(NULLIF(TRIM(location), ''), 'Unknown') AS label, COUNT(*)::int AS count
       FROM incidents
      WHERE home_id = $1 AND deleted_at IS NULL AND date >= $2 AND date <= $3
      GROUP BY label
      ORDER BY count DESC, label
      LIMIT 12`,
    [homeId, start, end],
  );
  const incidentByRootCause = await client.query(
    `SELECT COALESCE(NULLIF(TRIM(root_cause), ''), 'Unknown') AS label, COUNT(*)::int AS count
       FROM incidents
      WHERE home_id = $1 AND deleted_at IS NULL AND date >= $2 AND date <= $3
      GROUP BY label
      ORDER BY count DESC, label
      LIMIT 12`,
    [homeId, start, end],
  );
  const incidentByMonth = await client.query(
    `SELECT date_trunc('month', date)::date AS period, COUNT(*)::int AS count
       FROM incidents
      WHERE home_id = $1 AND deleted_at IS NULL AND date >= $2 AND date <= $3
      GROUP BY period
      ORDER BY period`,
    [homeId, start, end],
  );
  const incidentByTime = await client.query(
    `SELECT CASE
              WHEN time IS NULL THEN 'Unknown'
              WHEN EXTRACT(HOUR FROM time) BETWEEN 6 AND 13 THEN 'Morning'
              WHEN EXTRACT(HOUR FROM time) BETWEEN 14 AND 21 THEN 'Afternoon/evening'
              ELSE 'Night'
            END AS label,
            COUNT(*)::int AS count
       FROM incidents
      WHERE home_id = $1 AND deleted_at IS NULL AND date >= $2 AND date <= $3
      GROUP BY label
      ORDER BY count DESC, label`,
    [homeId, start, end],
  );
  const incidentOverdue = await client.query(
    `SELECT
         COUNT(*) FILTER (
           WHERE COALESCE(investigation_status, 'open') NOT IN ('closed', 'completed', 'resolved')
             AND COALESCE(investigation_review_date, date) < CURRENT_DATE
         )::int AS investigation_overdue,
         COUNT(*) FILTER (WHERE cqc_notifiable = true AND cqc_notified = false)::int AS cqc_notifiable_pending,
         COUNT(*) FILTER (WHERE riddor_reportable = true AND riddor_reported = false)::int AS riddor_pending
       FROM incidents
      WHERE home_id = $1 AND deleted_at IS NULL AND date >= $2 AND date <= $3`,
    [homeId, start, end],
  );
  const incidentRecurrence = await client.query(
    `SELECT COALESCE(NULLIF(TRIM(person_affected_name), ''), 'Unknown') AS subject,
            COALESCE(NULLIF(TRIM(type), ''), 'Unknown') AS category,
            COUNT(*)::int AS count
       FROM incidents
      WHERE home_id = $1 AND deleted_at IS NULL AND date >= $2 AND date <= $3
      GROUP BY subject, category
     HAVING COUNT(*) > 1
      ORDER BY count DESC, subject, category
      LIMIT 12`,
    [homeId, start, end],
  );
  const complaintByCategory = await client.query(
    `SELECT COALESCE(NULLIF(TRIM(category), ''), 'Unknown') AS label, COUNT(*)::int AS count
       FROM complaints
      WHERE home_id = $1 AND deleted_at IS NULL AND date >= $2 AND date <= $3
      GROUP BY label
      ORDER BY count DESC, label
      LIMIT 12`,
    [homeId, start, end],
  );
  const complaintByRootCause = await client.query(
    `SELECT COALESCE(NULLIF(TRIM(root_cause), ''), 'Unknown') AS label, COUNT(*)::int AS count
       FROM complaints
      WHERE home_id = $1 AND deleted_at IS NULL AND date >= $2 AND date <= $3
      GROUP BY label
      ORDER BY count DESC, label
      LIMIT 12`,
    [homeId, start, end],
  );
  const complaintByMonth = await client.query(
    `SELECT date_trunc('month', date)::date AS period, COUNT(*)::int AS count
       FROM complaints
      WHERE home_id = $1 AND deleted_at IS NULL AND date >= $2 AND date <= $3
      GROUP BY period
      ORDER BY period`,
    [homeId, start, end],
  );
  const complaintOverdue = await client.query(
    `SELECT
         COUNT(*) FILTER (
           WHERE acknowledged_date IS NULL
             AND date <= CURRENT_DATE - INTERVAL '3 days'
         )::int AS acknowledgement_overdue,
         COUNT(*) FILTER (
           WHERE response_deadline < CURRENT_DATE
             AND COALESCE(status, 'open') NOT IN ('closed', 'completed', 'resolved')
         )::int AS response_overdue
       FROM complaints
      WHERE home_id = $1 AND deleted_at IS NULL AND date >= $2 AND date <= $3`,
    [homeId, start, end],
  );
  const complaintRecurrence = await client.query(
    `SELECT COALESCE(NULLIF(TRIM(raised_by_name), ''), 'Unknown') AS subject,
            COALESCE(NULLIF(TRIM(category), ''), 'Unknown') AS category,
            COUNT(*)::int AS count
       FROM complaints
      WHERE home_id = $1 AND deleted_at IS NULL AND date >= $2 AND date <= $3
      GROUP BY subject, category
     HAVING COUNT(*) > 1
      ORDER BY count DESC, subject, category
      LIMIT 12`,
    [homeId, start, end],
  );
  return {
    period_start: start,
    period_end: end,
    incidents: incidents.rows[0] || {},
    complaints: complaints.rows[0] || {},
    trends: {
      incidents: {
        by_category: incidentByCategory.rows,
        by_location: incidentByLocation.rows,
        by_root_cause: incidentByRootCause.rows,
        by_month: incidentByMonth.rows.map(row => ({ ...row, period: dateOnly(row.period) })),
        by_time_of_day: incidentByTime.rows,
        overdue: incidentOverdue.rows[0] || {},
        recurrence: incidentRecurrence.rows,
      },
      complaints: {
        by_category: complaintByCategory.rows,
        by_root_cause: complaintByRootCause.rows,
        by_month: complaintByMonth.rows.map(row => ({ ...row, period: dateOnly(row.period) })),
        overdue: complaintOverdue.rows[0] || {},
        recurrence: complaintRecurrence.rows,
      },
    },
  };
}
