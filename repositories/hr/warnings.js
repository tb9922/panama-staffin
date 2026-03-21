import { pool, d } from './shared.js';

export async function getActiveWarnings(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT dc.staff_id, s.name AS staff_name, dc.outcome, dc.warning_expiry_date,
            dc.id AS case_id, 'disciplinary' AS case_type, dc.date_raised
     FROM hr_disciplinary_cases dc
     LEFT JOIN staff s ON s.id = dc.staff_id AND s.home_id = dc.home_id
     WHERE dc.home_id = $1 AND dc.deleted_at IS NULL
       AND dc.outcome IN ('verbal_warning','first_written','final_written')
       AND dc.warning_expiry_date > CURRENT_DATE
       AND dc.status != 'withdrawn'
     UNION ALL
     SELECT pc.staff_id, s.name AS staff_name, pc.outcome, pc.warning_expiry_date,
            pc.id AS case_id, 'performance' AS case_type, pc.date_raised
     FROM hr_performance_cases pc
     LEFT JOIN staff s ON s.id = pc.staff_id AND s.home_id = pc.home_id
     WHERE pc.home_id = $1 AND pc.deleted_at IS NULL
       AND pc.outcome IN ('first_written','final_written')
       AND pc.warning_expiry_date > CURRENT_DATE
       AND pc.status NOT IN ('closed', 'withdrawn')
     ORDER BY warning_expiry_date DESC`,
    [homeId]
  );
  return rows.map(r => ({
    staff_id: r.staff_id,
    staff_name: r.staff_name || null,
    outcome: r.outcome,
    warning_expiry_date: d(r.warning_expiry_date),
    case_id: r.case_id,
    case_type: r.case_type,
    date_raised: d(r.date_raised),
  }));
}
