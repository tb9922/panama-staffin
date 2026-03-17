import { pool, toDateStr } from '../db.js';

/**
 * Return all day notes for a home, shaped as:
 * { "YYYY-MM-DD": "note text" }
 * @param {number} homeId
 */
export async function findByHome(homeId, fromDate, toDate) {
  let sql = 'SELECT date, note FROM day_notes WHERE home_id = $1';
  const params = [homeId];
  if (fromDate) { params.push(fromDate); sql += ` AND date >= $${params.length}`; }
  if (toDate) { params.push(toDate); sql += ` AND date <= $${params.length}`; }
  const { rows } = await pool.query(sql, params);
  const result = {};
  for (const row of rows) {
    const dateStr = toDateStr(row.date);
    result[dateStr] = row.note;
  }
  return result;
}

/**
 * Full replace: delete day notes within a date range then insert non-empty ones.
 * Date range MUST match the window used by assembleData to avoid destroying
 * notes outside the loaded window.
 * @param {number} homeId
 * @param {object} notesObj { "YYYY-MM-DD": "note text" }
 * @param {object} [client]
 * @param {string} [fromDate] "YYYY-MM-DD" inclusive lower bound for delete scope
 * @param {string} [toDate]   "YYYY-MM-DD" inclusive upper bound for delete scope
 */
export async function replace(homeId, notesObj, client, fromDate, toDate) {
  const conn = client || pool;
  if (fromDate && toDate) {
    await conn.query('DELETE FROM day_notes WHERE home_id = $1 AND date >= $2 AND date <= $3', [homeId, fromDate, toDate]);
  } else {
    await conn.query('DELETE FROM day_notes WHERE home_id = $1', [homeId]);
  }

  if (!notesObj) return;
  const entries = Object.entries(notesObj).filter(([, note]) => note && note.trim());
  if (entries.length === 0) return;

  for (const [date, note] of entries) {
    await conn.query(
      `INSERT INTO day_notes (home_id, date, note, updated_at) VALUES ($1,$2,$3,NOW())
       ON CONFLICT (home_id, date) DO UPDATE SET note = EXCLUDED.note, updated_at = NOW()`,
      [homeId, date, note]
    );
  }
}

/**
 * Upsert a single day note.
 * @param {number} homeId
 * @param {string} date  "YYYY-MM-DD"
 * @param {string} note
 */
export async function upsertOne(homeId, date, note) {
  await pool.query(
    `INSERT INTO day_notes (home_id, date, note, updated_at) VALUES ($1,$2,$3,NOW())
     ON CONFLICT (home_id, date) DO UPDATE SET note=EXCLUDED.note, updated_at=NOW()`,
    [homeId, date, note]
  );
}

/**
 * Delete a single day note.
 * @param {number} homeId
 * @param {string} date  "YYYY-MM-DD"
 */
export async function deleteOne(homeId, date) {
  await pool.query(`DELETE FROM day_notes WHERE home_id=$1 AND date=$2`, [homeId, date]);
}
