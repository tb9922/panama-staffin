import { pool } from './shared.js';

/**
 * All SICK shift_overrides for a home since cutoff, ordered for Bradford Factor grouping.
 */
export async function findSickOverrides(homeId, cutoff, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT date, staff_id FROM shift_overrides
     WHERE home_id = $1 AND shift = 'SICK' AND date >= $2
     ORDER BY staff_id, date`,
    [homeId, cutoff]
  );
  return rows;
}

/**
 * SICK shift_overrides for a single staff member since cutoff.
 */
export async function findStaffSickOverrides(homeId, staffId, cutoff, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT date FROM shift_overrides
     WHERE home_id = $1 AND staff_id = $2 AND shift = 'SICK' AND date >= $3
     ORDER BY date`,
    [homeId, staffId, cutoff]
  );
  return rows;
}

/**
 * Home config (for absence_triggers lookup).
 */
export async function findHomeConfig(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT config FROM homes WHERE id = $1 AND deleted_at IS NULL', [homeId]
  );
  return rows[0]?.config || {};
}
