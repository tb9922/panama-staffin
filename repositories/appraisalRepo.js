import { ConflictError } from '../errors.js';
import { pool, toDateStr } from '../db.js';

function shapeRow(row) {
  return {
    id:               row.id,
    date:             toDateStr(row.date),
    appraiser:        row.appraiser || undefined,
    objectives:       row.objectives || undefined,
    training_needs:   row.training_needs || undefined,
    development_plan: row.development_plan || undefined,
    next_due:         toDateStr(row.next_due) ?? undefined,
    notes:            row.notes || undefined,
    updated_at:       row.updated_at ? row.updated_at.toISOString() : undefined,
  };
}

/**
 * Return all appraisal records for a home, shaped as:
 * { "staffId": [{ id, date, appraiser, objectives, training_needs, development_plan, next_due, notes }] }
 * @param {number} homeId
 */
export async function findByHome(homeId, { limit = 500, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, staff_id, date, appraiser, objectives, training_needs, development_plan, next_due, notes, updated_at,
            COUNT(*) OVER() AS _total
     FROM appraisals WHERE home_id = $1 AND deleted_at IS NULL
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
 * Sync appraisal records. Upserts incoming, hard-deletes removed appraisals.
 * @param {number} homeId
 * @param {object} appraisalsObj { "staffId": [{ id, date, ... }] }
 * @param {object} [client]
 */
export async function sync(homeId, appraisalsObj, client) {
  const conn = client || pool;
  if (!appraisalsObj) return;

  const flat = [];
  for (const [staffId, sessions] of Object.entries(appraisalsObj)) {
    for (const a of sessions) {
      flat.push({ staffId, ...a });
    }
  }

  const incomingIds = flat.map(r => r.id);

  if (flat.length > 0) {
    const COLS_PER_ROW = 9;
    const CHUNK = Math.floor(65000 / COLS_PER_ROW);
    for (let i = 0; i < flat.length; i += CHUNK) {
      const chunk = flat.slice(i, i + CHUNK);
      const placeholders = [];
      const values = [];
      chunk.forEach((a, j) => {
        const b = j * COLS_PER_ROW + 2;
        placeholders.push(`($${b},$1,$${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},NOW())`);
        values.push(
          a.id, a.staffId, a.date,
          a.appraiser || null, a.objectives || null,
          a.training_needs || null, a.development_plan || null,
          a.next_due || null, a.notes || null
        );
      });
      await conn.query(
        `INSERT INTO appraisals
           (id, home_id, staff_id, date, appraiser, objectives, training_needs, development_plan, next_due, notes, updated_at)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (home_id, id) DO UPDATE SET
           date             = EXCLUDED.date,
           appraiser        = EXCLUDED.appraiser,
           objectives       = EXCLUDED.objectives,
           training_needs   = EXCLUDED.training_needs,
           development_plan = EXCLUDED.development_plan,
           next_due         = EXCLUDED.next_due,
           notes            = EXCLUDED.notes,
           updated_at       = NOW(),
           deleted_at       = NULL`,
        [homeId, ...values]
      );
    }
  }

  // Soft-delete appraisals removed from the frontend (CQC Reg 18 — must retain)
  if (incomingIds.length === 0) {
    // Empty payload guard: skip — never wipe all appraisals on empty incoming list
    return;
  }
  await conn.query(
    `UPDATE appraisals SET deleted_at = NOW()
     WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL`,
    [homeId, incomingIds]
  );
}

export async function upsertAppraisal(homeId, staffId, record) {
  if (record._clientUpdatedAt) {
    const { rows, rowCount } = await pool.query(
      `UPDATE appraisals
       SET staff_id = $3,
           date = $4,
           appraiser = $5,
           objectives = $6,
           training_needs = $7,
           development_plan = $8,
           next_due = $9,
           notes = $10,
           updated_at = NOW(),
           deleted_at = NULL
       WHERE home_id = $1
         AND id = $2
         AND deleted_at IS NULL
         AND date_trunc('milliseconds', updated_at) = $11::timestamptz
       RETURNING id, staff_id, date, appraiser, objectives, training_needs, development_plan, next_due, notes, updated_at`,
      [homeId, record.id, staffId, record.date, record.appraiser || null,
        record.objectives || null, record.training_needs || null,
        record.development_plan || null, record.next_due || null,
        record.notes || null, record._clientUpdatedAt]
    );
    if (rowCount === 0) {
      throw new ConflictError('Record was modified by another user. Please refresh and try again.');
    }
    return shapeRow(rows[0]);
  }

  const { rows } = await pool.query(
    `INSERT INTO appraisals
       (id, home_id, staff_id, date, appraiser, objectives, training_needs, development_plan, next_due, notes, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
      ON CONFLICT (home_id, id) DO NOTHING
      RETURNING id, staff_id, date, appraiser, objectives, training_needs, development_plan, next_due, notes, updated_at`,
    [record.id, homeId, staffId, record.date, record.appraiser || null,
     record.objectives || null, record.training_needs || null,
     record.development_plan || null, record.next_due || null, record.notes || null]
  );
  if (rows.length === 0) {
    throw new ConflictError('Record was modified by another user. Please refresh and try again.');
  }
  return shapeRow(rows[0]);
}

export async function softDeleteAppraisal(homeId, id) {
  const { rowCount } = await pool.query(
    'UPDATE appraisals SET deleted_at=NOW() WHERE home_id=$1 AND id=$2 AND deleted_at IS NULL',
    [homeId, id]
  );
  return rowCount > 0;
}
