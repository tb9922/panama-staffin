import { pool, withTransaction } from '../db.js';

/**
 * Return all onboarding records for a home, shaped as:
 * { "staffId": { dbs_check: {...}, right_to_work: {...}, ... } }
 * @param {number} homeId
 */
export async function findByHome(homeId) {
  const { rows } = await pool.query(
    'SELECT staff_id, data FROM onboarding WHERE home_id = $1 AND deleted_at IS NULL',
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

  const rows = Object.entries(onboardingObj).map(([staffId, data]) => ({
    staffId,
    data: JSON.stringify(data ?? {}),
  }));
  if (rows.length === 0) return;

  const COLS_PER_ROW = 2;
  const CHUNK = Math.floor(65000 / COLS_PER_ROW);
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const placeholders = [];
    const values = [];
    chunk.forEach((item, j) => {
      const b = j * COLS_PER_ROW + 2;
      placeholders.push(`($1,$${b},$${b + 1},NOW())`);
      values.push(item.staffId, item.data);
    });
    await conn.query(
      `INSERT INTO onboarding (home_id, staff_id, data, updated_at)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (home_id, staff_id) DO UPDATE SET
         data       = EXCLUDED.data,
         updated_at = NOW()`,
      [homeId, ...values]
    );
  }
}

export async function upsertSection(homeId, staffId, section, sectionData) {
  return withTransaction(async (client) => {
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
    return merged;
  });
}

export async function clearSection(homeId, staffId, section) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT data FROM onboarding WHERE home_id=$1 AND staff_id=$2 FOR UPDATE',
      [homeId, staffId]
    );
    if (!rows[0]) return null;
    const existing = rows[0].data ?? {};
    delete existing[section];
    await client.query(
      'UPDATE onboarding SET data=$3, updated_at=NOW() WHERE home_id=$1 AND staff_id=$2',
      [homeId, staffId, JSON.stringify(existing)]
    );
    return existing;
  });
}
