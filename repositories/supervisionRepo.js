import { ConflictError } from '../errors.js';
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

  const flat = [];
  for (const [staffId, sessions] of Object.entries(supervisionsObj)) {
    for (const s of sessions) {
      flat.push({ staffId, ...s });
    }
  }

  const incomingIds = flat.map(r => r.id);

  if (flat.length > 0) {
    const COLS_PER_ROW = 8;
    const CHUNK = Math.floor(65000 / COLS_PER_ROW);
    for (let i = 0; i < flat.length; i += CHUNK) {
      const chunk = flat.slice(i, i + CHUNK);
      const placeholders = [];
      const values = [];
      chunk.forEach((s, j) => {
        const b = j * COLS_PER_ROW + 2;
        placeholders.push(`($${b},$1,$${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},NOW())`);
        values.push(
          s.id, s.staffId, s.date,
          s.supervisor || null, s.topics || null,
          s.actions || null, s.next_due || null, s.notes || null
        );
      });
      await conn.query(
        `INSERT INTO supervisions (id, home_id, staff_id, date, supervisor, topics, actions, next_due, notes, updated_at)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (home_id, id) DO UPDATE SET
           date       = EXCLUDED.date,
           supervisor = EXCLUDED.supervisor,
           topics     = EXCLUDED.topics,
           actions    = EXCLUDED.actions,
           next_due   = EXCLUDED.next_due,
           notes      = EXCLUDED.notes,
           updated_at = NOW(),
           deleted_at = NULL`,
        [homeId, ...values]
      );
    }
  }

  // Soft-delete sessions removed from the frontend (CQC Reg 18 evidence must be retained).
  // Only touch records belonging to staff IDs present in the incoming payload — this makes
  // the delete safe against partial payloads where the frontend sends one staff member's
  // sessions rather than the complete home dataset.
  const incomingStaffIds = [...new Set(flat.map(r => r.staffId))];
  if (incomingIds.length === 0 || incomingStaffIds.length === 0) {
    // Empty payload guard: never wipe all records — this indicates a likely frontend/network error
    return;
  }
  await conn.query(
    `UPDATE supervisions SET deleted_at = NOW()
     WHERE home_id = $1 AND id != ALL($2::text[]) AND staff_id = ANY($3::text[]) AND deleted_at IS NULL`,
    [homeId, incomingIds, incomingStaffIds]
  );
}

export async function upsertSession(homeId, staffId, record) {
  if (record._clientUpdatedAt) {
    const { rows, rowCount } = await pool.query(
      `UPDATE supervisions
       SET staff_id = $3,
           date = $4,
           supervisor = $5,
           topics = $6,
           actions = $7,
           next_due = $8,
           notes = $9,
           updated_at = GREATEST(clock_timestamp(), date_trunc('milliseconds', updated_at) + interval '1 millisecond'),
           deleted_at = NULL
       WHERE home_id = $1
         AND id = $2
         AND deleted_at IS NULL
         AND date_trunc('milliseconds', updated_at) = $10::timestamptz
       RETURNING id, staff_id, date, supervisor, topics, actions, next_due, notes, updated_at`,
      [homeId, record.id, staffId, record.date, record.supervisor || null,
        record.topics || null, record.actions || null, record.next_due || null,
        record.notes || null, record._clientUpdatedAt]
    );
    if (rowCount === 0) {
      throw new ConflictError('Record was modified by another user. Please refresh and try again.');
    }
    return shapeRow(rows[0]);
  }

  const { rows } = await pool.query(
    `INSERT INTO supervisions (id, home_id, staff_id, date, supervisor, topics, actions, next_due, notes, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp())
      ON CONFLICT (home_id, id) DO NOTHING
      RETURNING id, staff_id, date, supervisor, topics, actions, next_due, notes, updated_at`,
    [record.id, homeId, staffId, record.date, record.supervisor || null,
     record.topics || null, record.actions || null, record.next_due || null, record.notes || null]
  );
  if (rows.length === 0) {
    throw new ConflictError('Record was modified by another user. Please refresh and try again.');
  }
  return shapeRow(rows[0]);
}

export async function softDeleteSession(homeId, id) {
  const { rowCount } = await pool.query(
    'UPDATE supervisions SET deleted_at=NOW() WHERE home_id=$1 AND id=$2 AND deleted_at IS NULL',
    [homeId, id]
  );
  return rowCount > 0;
}
