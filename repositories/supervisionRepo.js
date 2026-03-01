import { pool, toDateStr } from '../db.js';

function shapeRow(row) {
  return {
    id:         row.id,
    date:       toDateStr(row.date),
    supervisor: row.supervisor || undefined,
    topics:     row.topics || undefined,
    actions:    row.actions || undefined,
    next_due:   toDateStr(row.next_due) ?? undefined,
    notes:      row.notes || undefined,
    updated_at: row.updated_at ? row.updated_at.toISOString() : undefined,
  };
}

/**
 * Return all supervision records for a home, shaped as:
 * { "staffId": [{ id, date, supervisor, topics, actions, next_due, notes }] }
 * @param {number} homeId
 */
export async function findByHome(homeId, { limit = 500, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, staff_id, date, supervisor, topics, actions, next_due, notes, updated_at,
            COUNT(*) OVER() AS _total
     FROM supervisions WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY staff_id, date LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 2000), Math.max(offset, 0)]
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  const result = {};
  for (const row of rows) {
    const { _total, ...rest } = row;
    if (!result[rest.staff_id]) result[rest.staff_id] = [];
    result[rest.staff_id].push(shapeRow(rest));
  }
  return { rows: result, total };
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
        `INSERT INTO supervisions (id, home_id, staff_id, date, supervisor, topics, actions, next_due, notes, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT (home_id, id) DO UPDATE SET
           date       = EXCLUDED.date,
           supervisor = EXCLUDED.supervisor,
           topics     = EXCLUDED.topics,
           actions    = EXCLUDED.actions,
           next_due   = EXCLUDED.next_due,
           notes      = EXCLUDED.notes,
           updated_at = NOW(),
           deleted_at = NULL`,
        [s.id, homeId, staffId, s.date, s.supervisor || null, s.topics || null,
         s.actions || null, s.next_due || null, s.notes || null]
      );
    }
  }

  // Soft-delete sessions removed from the frontend (CQC Reg 18 evidence must be retained)
  if (incomingIds.length === 0) {
    // Empty payload guard: never wipe all records — this indicates a likely frontend/network error
    // A manager cannot have zero supervision sessions after any real usage
    return;
  }
  await conn.query(
    `UPDATE supervisions SET deleted_at = NOW()
     WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL`,
    [homeId, incomingIds]
  );
}

export async function upsertSession(homeId, staffId, record) {
  const { rows } = await pool.query(
    `INSERT INTO supervisions (id, home_id, staff_id, date, supervisor, topics, actions, next_due, notes, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (home_id, id) DO UPDATE SET
       date=EXCLUDED.date, supervisor=EXCLUDED.supervisor, topics=EXCLUDED.topics, actions=EXCLUDED.actions, next_due=EXCLUDED.next_due, notes=EXCLUDED.notes, updated_at=NOW(), deleted_at=NULL
     RETURNING id, staff_id, date, supervisor, topics, actions, next_due, notes, updated_at`,
    [record.id, homeId, staffId, record.date, record.supervisor || null,
     record.topics || null, record.actions || null, record.next_due || null, record.notes || null]
  );
  return shapeRow(rows[0]);
}

export async function softDeleteSession(homeId, id) {
  const { rowCount } = await pool.query(
    'UPDATE supervisions SET deleted_at=NOW() WHERE home_id=$1 AND id=$2 AND deleted_at IS NULL',
    [homeId, id]
  );
  return rowCount > 0;
}
