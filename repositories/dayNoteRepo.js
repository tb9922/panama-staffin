import { pool } from '../db.js';

/**
 * Return all day notes for a home, shaped as:
 * { "YYYY-MM-DD": "note text" }
 * @param {number} homeId
 */
export async function findByHome(homeId) {
  const { rows } = await pool.query(
    'SELECT date, note FROM day_notes WHERE home_id = $1',
    [homeId]
  );
  const result = {};
  for (const row of rows) {
    const dateStr = row.date instanceof Date
      ? row.date.toISOString().slice(0, 10)
      : String(row.date).slice(0, 10);
    result[dateStr] = row.note;
  }
  return result;
}

/**
 * Full replace: delete all day notes then insert non-empty ones.
 * Simple text data — not regulated, safe to hard-delete within transaction.
 * @param {number} homeId
 * @param {object} notesObj { "YYYY-MM-DD": "note text" }
 * @param {object} [client]
 */
export async function replace(homeId, notesObj, client) {
  const conn = client || pool;
  await conn.query('DELETE FROM day_notes WHERE home_id = $1', [homeId]);

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
