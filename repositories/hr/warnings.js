import { pool, d } from './shared.js';

export async function getActiveWarnings(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT staff_id, outcome AS warning_level, warning_expiry_date, id AS case_id,
            'disciplinary' AS case_type, date_raised
     FROM hr_disciplinary_cases
     WHERE home_id = $1 AND deleted_at IS NULL
       AND outcome IN ('verbal_warning','first_written','final_written')
       AND warning_expiry_date > CURRENT_DATE
       AND status != 'withdrawn'
     UNION ALL
     SELECT staff_id, outcome AS warning_level, warning_expiry_date, id AS case_id,
            'performance' AS case_type, date_raised
     FROM hr_performance_cases
     WHERE home_id = $1 AND deleted_at IS NULL
       AND outcome IN ('first_written','final_written')
       AND warning_expiry_date > CURRENT_DATE
       AND status != 'closed'
     ORDER BY warning_expiry_date DESC`,
    [homeId]
  );
  return rows.map(r => ({
    staff_id: r.staff_id,
    warning_level: r.warning_level,
    warning_expiry_date: d(r.warning_expiry_date),
    case_id: r.case_id,
    case_type: r.case_type,
    date_raised: d(r.date_raised),
  }));
}
