import { pool } from '../db.js';

function shapeRow(row) {
  return {
    id:         row.id,
    date:       row.date ? row.date.toISOString().slice(0, 10) : null,
    supervisor: row.supervisor || undefined,
    topics:     row.topics || undefined,
    actions:    row.actions || undefined,
    next_due:   row.next_due ? row.next_due.toISOString().slice(0, 10) : undefined,
    notes:      row.notes || undefined,
  };
}

/**
 * Return all supervision records for a home, shaped as:
 * { "staffId": [{ id, date, supervisor, topics, actions, next_due, notes }] }
 * @param {number} homeId
 */
export async function findByHome(homeId) {
  const { rows } = await pool.query(
    `SELECT id, staff_id, date, supervisor, topics, actions, next_due, notes
     FROM supervisions WHERE home_id = $1 ORDER BY staff_id, date`,
    [homeId]
  );
  const result = {};
  for (const row of rows) {
    if (!result[row.staff_id]) result[row.staff_id] = [];
    result[row.staff_id].push(shapeRow(row));
  }
  return result;
}

/**
 * Sync supervision records. Upserts incoming, hard-deletes removed sessions.
 * @param {number} homeId
 * @param {object} supervisionsObj { "staffId": [{ id, date, ... }] }
 * @param {object} [client]
 */
export async function sync(homeId, supervisionsObj, client) {
  const conn = client || pool;
  if (!supervisionsObj) return;

  const incomingIds = [];
  for (const sessions of Object.values(supervisionsObj)) {
    for (const s of sessions) {
      incomingIds.push(s.id);
    }
  }

  for (const [staffId, sessions] of Object.entries(supervisionsObj)) {
    for (const s of sessions) {
      await conn.query(
        `INSERT INTO supervisions (id, home_id, staff_id, date, supervisor, topics, actions, next_due, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (home_id, id) DO UPDATE SET
           date       = EXCLUDED.date,
           supervisor = EXCLUDED.supervisor,
           topics     = EXCLUDED.topics,
           actions    = EXCLUDED.actions,
           next_due   = EXCLUDED.next_due,
           notes      = EXCLUDED.notes`,
        [s.id, homeId, staffId, s.date, s.supervisor || null, s.topics || null,
         s.actions || null, s.next_due || null, s.notes || null]
      );
    }
  }

  // Hard-delete sessions removed from the frontend
  if (incomingIds.length > 0) {
    await conn.query(
      `DELETE FROM supervisions WHERE home_id = $1 AND id != ALL($2::text[])`,
      [homeId, incomingIds]
    );
  } else {
    await conn.query('DELETE FROM supervisions WHERE home_id = $1', [homeId]);
  }
}
