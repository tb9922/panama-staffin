import { pool } from '../db.js';

/**
 * Return all overrides for a home, shaped as:
 * { "YYYY-MM-DD": { "staffId": { shift, reason, source } } }
 * @param {number} homeId
 */
export async function findByHome(homeId) {
  const { rows } = await pool.query(
    'SELECT date, staff_id, shift, reason, source, sleep_in FROM shift_overrides WHERE home_id = $1',
    [homeId]
  );
  const result = {};
  for (const row of rows) {
    const dateStr = row.date instanceof Date
      ? row.date.toISOString().slice(0, 10)
      : String(row.date).slice(0, 10);
    if (!result[dateStr]) result[dateStr] = {};
    const entry = { shift: row.shift };
    if (row.reason) entry.reason = row.reason;
    if (row.source) entry.source = row.source;
    if (row.sleep_in) entry.sleep_in = row.sleep_in;
    result[dateStr][row.staff_id] = entry;
  }
  return result;
}

/**
 * Full replace: delete all overrides for a home then insert the incoming set.
 * Schedule data — not regulated, safe to hard-delete within transaction.
 * @param {number} homeId
 * @param {object} overridesObj { "YYYY-MM-DD": { "staffId": { shift, reason, source } } }
 * @param {object} [client]
 */
export async function replace(homeId, overridesObj, client) {
  const conn = client || pool;
  await conn.query('DELETE FROM shift_overrides WHERE home_id = $1', [homeId]);

  if (!overridesObj || Object.keys(overridesObj).length === 0) return;

  // Flatten to rows
  const rows = [];
  for (const [date, dayOverrides] of Object.entries(overridesObj)) {
    for (const [staffId, override] of Object.entries(dayOverrides)) {
      rows.push([homeId, date, staffId, override.shift, override.reason || null, override.source || null, override.sleep_in ?? false]);
    }
  }

  if (rows.length === 0) return;

  // Batch insert in chunks of 500 to avoid max parameter limits
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = chunk.map((_, idx) => {
      const base = idx * 7;
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`;
    }).join(', ');
    const params = chunk.flat();
    await conn.query(
      `INSERT INTO shift_overrides (home_id, date, staff_id, shift, reason, source, sleep_in)
       VALUES ${values}`,
      params
    );
  }
}

/**
 * Delete all overrides for a specific staff member.
 * Called when a staff member is removed from the register.
 * @param {number} homeId
 * @param {string} staffId
 * @param {object} [client]
 */
export async function deleteForStaff(homeId, staffId, client) {
  const conn = client || pool;
  await conn.query(
    'DELETE FROM shift_overrides WHERE home_id = $1 AND staff_id = $2',
    [homeId, staffId]
  );
}

/**
 * Upsert a single override row.
 * @param {number} homeId
 * @param {string} date  "YYYY-MM-DD"
 * @param {string} staffId
 * @param {{ shift, reason, source, sleep_in }} override
 */
export async function upsertOne(homeId, date, staffId, { shift, reason, source, sleep_in }) {
  const { rows } = await pool.query(
    `INSERT INTO shift_overrides (home_id, date, staff_id, shift, reason, source, sleep_in, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (home_id, date, staff_id)
     DO UPDATE SET shift=EXCLUDED.shift, reason=EXCLUDED.reason,
                   source=EXCLUDED.source, sleep_in=EXCLUDED.sleep_in, updated_at=NOW()
     RETURNING home_id`,
    [homeId, date, staffId, shift, reason ?? null, source ?? 'manual', sleep_in ?? false]
  );
  return rows[0];
}

/**
 * Delete a single override row.
 * @param {number} homeId
 * @param {string} date  "YYYY-MM-DD"
 * @param {string} staffId
 * @returns {boolean} true if a row was deleted
 */
export async function deleteOne(homeId, date, staffId) {
  const { rowCount } = await pool.query(
    `DELETE FROM shift_overrides WHERE home_id=$1 AND date=$2 AND staff_id=$3`,
    [homeId, date, staffId]
  );
  return rowCount > 0;
}

/**
 * Upsert multiple override rows in chunks of 100.
 * homeId is always $1; per-row params are date, staffId, shift, reason, source, sleep_in ($2..$7 for chunk row 0).
 * @param {number} homeId
 * @param {Array<{ date, staffId, shift, reason, source, sleep_in }>} rows
 * @param {object} [client]
 */
export async function upsertBulk(homeId, rows, client) {
  if (!rows || rows.length === 0) return;
  const db = client || pool;
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    chunk.forEach(({ date, staffId, shift, reason, source, sleep_in }, j) => {
      const base = j * 6;
      params.push(
        `($1,$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},NOW())`
      );
      values.push(date, staffId, shift, reason ?? null, source ?? 'manual', sleep_in ?? false);
    });
    await db.query(
      `INSERT INTO shift_overrides (home_id, date, staff_id, shift, reason, source, sleep_in, updated_at)
       VALUES ${params.join(',')}
       ON CONFLICT (home_id, date, staff_id)
       DO UPDATE SET shift=EXCLUDED.shift, reason=EXCLUDED.reason,
                     source=EXCLUDED.source, sleep_in=EXCLUDED.sleep_in, updated_at=NOW()`,
      [homeId, ...values]
    );
  }
}

/**
 * Delete all overrides within a date range (inclusive).
 * Used for month-revert operations.
 * @param {number} homeId
 * @param {string} fromDate  "YYYY-MM-DD"
 * @param {string} toDate    "YYYY-MM-DD"
 * @returns {number} rows deleted
 */
export async function deleteForDateRange(homeId, fromDate, toDate) {
  const { rowCount } = await pool.query(
    `DELETE FROM shift_overrides WHERE home_id=$1 AND date >= $2 AND date <= $3`,
    [homeId, fromDate, toDate]
  );
  return rowCount;
}
