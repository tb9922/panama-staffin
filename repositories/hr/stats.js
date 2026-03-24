import { pool } from './shared.js';
import { getActiveWarnings } from './warnings.js';

export async function getHrStats(homeId) {
  const [disc, grv, perf, warnings, flex] = await Promise.all([
    pool.query(
      `SELECT status, COUNT(*) as c FROM hr_disciplinary_cases
       WHERE home_id = $1 AND deleted_at IS NULL AND status NOT IN ('closed','withdrawn')
       GROUP BY status`, [homeId]),
    pool.query(
      `SELECT status, COUNT(*) as c FROM hr_grievance_cases
       WHERE home_id = $1 AND deleted_at IS NULL AND status NOT IN ('closed','withdrawn')
       GROUP BY status`, [homeId]),
    pool.query(
      `SELECT status, COUNT(*) as c FROM hr_performance_cases
       WHERE home_id = $1 AND deleted_at IS NULL AND status NOT IN ('closed','withdrawn')
       GROUP BY status`, [homeId]),
    getActiveWarnings(homeId),
    pool.query(
      `SELECT COUNT(*) as c FROM hr_flexible_working
       WHERE home_id = $1 AND deleted_at IS NULL AND decision IS NULL
         AND decision_deadline <= CURRENT_DATE + INTERVAL '14 days'`, [homeId]),
  ]);
  return {
    disciplinary_open: disc.rows.reduce((s, r) => s + parseInt(r.c), 0),
    grievance_open: grv.rows.reduce((s, r) => s + parseInt(r.c), 0),
    performance_open: perf.rows.reduce((s, r) => s + parseInt(r.c), 0),
    active_warnings: warnings.length,
    flex_working_pending: parseInt(flex.rows[0]?.c || 0),
  };
}
