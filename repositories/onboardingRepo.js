import { pool } from '../db.js';

/**
 * Return all onboarding records for a home, shaped as:
 * { "staffId": { dbs_check: {...}, right_to_work: {...}, ... } }
 * @param {number} homeId
 */
export async function findByHome(homeId) {
  const { rows } = await pool.query(
    'SELECT staff_id, data FROM onboarding WHERE home_id = $1',
    [homeId]
  );
  const result = {};
  for (const row of rows) {
    result[row.staff_id] = row.data ?? {};
  }
  return result;
}

/**
 * Sync onboarding records. Upserts by (home_id, staff_id).
 * @param {number} homeId
 * @param {object} onboardingObj { "staffId": { ... } }
 * @param {object} [client]
 */
export async function sync(homeId, onboardingObj, client) {
  const conn = client || pool;
  if (!onboardingObj) return;

  for (const [staffId, data] of Object.entries(onboardingObj)) {
    await conn.query(
      `INSERT INTO onboarding (home_id, staff_id, data, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (home_id, staff_id) DO UPDATE SET
         data       = EXCLUDED.data,
         updated_at = NOW()`,
      [homeId, staffId, JSON.stringify(data ?? {})]
    );
  }
}

export async function upsertSection(homeId, staffId, section, sectionData) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT data FROM onboarding WHERE home_id=$1 AND staff_id=$2 FOR UPDATE',
      [homeId, staffId]
    );
    const existing = rows[0]?.data ?? {};
    const merged = { ...existing, [section]: sectionData };
    await client.query(
      `INSERT INTO onboarding (home_id, staff_id, data, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (home_id, staff_id) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()`,
      [homeId, staffId, JSON.stringify(merged)]
    );
    await client.query('COMMIT');
    return merged;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function clearSection(homeId, staffId, section) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT data FROM onboarding WHERE home_id=$1 AND staff_id=$2 FOR UPDATE',
      [homeId, staffId]
    );
    if (!rows[0]) {
      await client.query('COMMIT');
      return null;
    }
    const existing = rows[0].data ?? {};
    delete existing[section];
    await client.query(
      'UPDATE onboarding SET data=$3, updated_at=NOW() WHERE home_id=$1 AND staff_id=$2',
      [homeId, staffId, JSON.stringify(existing)]
    );
    await client.query('COMMIT');
    return existing;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
