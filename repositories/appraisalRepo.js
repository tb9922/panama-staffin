import { pool } from '../db.js';

function shapeRow(row) {
  return {
    id:               row.id,
    date:             row.date ? row.date.toISOString().slice(0, 10) : null,
    appraiser:        row.appraiser || undefined,
    objectives:       row.objectives || undefined,
    training_needs:   row.training_needs || undefined,
    development_plan: row.development_plan || undefined,
    next_due:         row.next_due ? row.next_due.toISOString().slice(0, 10) : undefined,
    notes:            row.notes || undefined,
  };
}

/**
 * Return all appraisal records for a home, shaped as:
 * { "staffId": [{ id, date, appraiser, objectives, training_needs, development_plan, next_due, notes }] }
 * @param {number} homeId
 */
export async function findByHome(homeId) {
  const { rows } = await pool.query(
    `SELECT id, staff_id, date, appraiser, objectives, training_needs, development_plan, next_due, notes
     FROM appraisals WHERE home_id = $1 AND deleted_at IS NULL ORDER BY staff_id, date`,
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
 * Sync appraisal records. Upserts incoming, hard-deletes removed appraisals.
 * @param {number} homeId
 * @param {object} appraisalsObj { "staffId": [{ id, date, ... }] }
 * @param {object} [client]
 */
export async function sync(homeId, appraisalsObj, client) {
  const conn = client || pool;
  if (!appraisalsObj) return;

  const incomingIds = [];
  for (const sessions of Object.values(appraisalsObj)) {
    for (const a of sessions) {
      incomingIds.push(a.id);
    }
  }

  for (const [staffId, sessions] of Object.entries(appraisalsObj)) {
    for (const a of sessions) {
      await conn.query(
        `INSERT INTO appraisals
           (id, home_id, staff_id, date, appraiser, objectives, training_needs, development_plan, next_due, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (home_id, id) DO UPDATE SET
           date             = EXCLUDED.date,
           appraiser        = EXCLUDED.appraiser,
           objectives       = EXCLUDED.objectives,
           training_needs   = EXCLUDED.training_needs,
           development_plan = EXCLUDED.development_plan,
           next_due         = EXCLUDED.next_due,
           notes            = EXCLUDED.notes`,
        [a.id, homeId, staffId, a.date, a.appraiser || null, a.objectives || null,
         a.training_needs || null, a.development_plan || null, a.next_due || null, a.notes || null]
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
  const { rows } = await pool.query(
    `INSERT INTO appraisals
       (id, home_id, staff_id, date, appraiser, objectives, training_needs, development_plan, next_due, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (home_id, id) DO UPDATE SET
       date=$4, appraiser=$5, objectives=$6, training_needs=$7,
       development_plan=$8, next_due=$9, notes=$10
     RETURNING id, staff_id, date, appraiser, objectives, training_needs, development_plan, next_due, notes`,
    [record.id, homeId, staffId, record.date, record.appraiser || null,
     record.objectives || null, record.training_needs || null,
     record.development_plan || null, record.next_due || null, record.notes || null]
  );
  return shapeRow(rows[0]);
}

export async function softDeleteAppraisal(homeId, id) {
  const { rowCount } = await pool.query(
    'UPDATE appraisals SET deleted_at=NOW() WHERE home_id=$1 AND id=$2 AND deleted_at IS NULL',
    [homeId, id]
  );
  return rowCount > 0;
}
