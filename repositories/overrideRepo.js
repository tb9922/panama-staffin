import { pool } from '../db.js';

/**
 * Return all overrides for a home, shaped as:
 * { "YYYY-MM-DD": { "staffId": { shift, reason, source } } }
 * @param {number} homeId
 */
export async function findByHome(homeId) {
  const { rows } = await pool.query(
    'SELECT date, staff_id, shift, reason, source FROM shift_overrides WHERE home_id = $1',
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
      rows.push([homeId, date, staffId, override.shift, override.reason || null, override.source || null]);
    }
  }

  if (rows.length === 0) return;

  // Batch insert in chunks of 500 to avoid max parameter limits
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = chunk.map((_, idx) => {
      const base = idx * 6;
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`;
    }).join(', ');
    const params = chunk.flat();
    await conn.query(
      `INSERT INTO shift_overrides (home_id, date, staff_id, shift, reason, source)
       VALUES ${values}`,
      params
    );
  }
}
