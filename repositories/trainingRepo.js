import { pool } from '../db.js';

/**
 * Return all training records for a home, shaped as:
 * { "staffId": { "typeId": { completed, expiry, trainer, method, certificate_ref, level, notes } } }
 * @param {number} homeId
 */
export async function findByHome(homeId) {
  const { rows } = await pool.query(
    `SELECT staff_id, training_type_id, completed, expiry, trainer, method,
            certificate_ref, level, notes, updated_at
     FROM training_records
     WHERE home_id = $1 AND deleted_at IS NULL`,
    [homeId]
  );
  const result = {};
  for (const row of rows) {
    if (!result[row.staff_id]) result[row.staff_id] = {};
    result[row.staff_id][row.training_type_id] = {
      completed: row.completed ? row.completed.toISOString().slice(0, 10) : null,
      expiry:    row.expiry    ? row.expiry.toISOString().slice(0, 10)    : null,
      trainer:   row.trainer   ?? undefined,
      method:    row.method    ?? undefined,
      certificate_ref: row.certificate_ref ?? undefined,
      level:     row.level     ?? undefined,
      notes:     row.notes     ?? undefined,
      updated_at: row.updated_at ? row.updated_at.toISOString() : undefined,
    };
  }
  return result;
}

/**
 * Sync training records. Upserts all incoming records by (home_id, staff_id, training_type_id).
 * Training records are not deleted — they accumulate over time.
 * @param {number} homeId
 * @param {object} trainingObj { "staffId": { "typeId": { completed, expiry, ... } } }
 * @param {object} [client]
 */
export async function sync(homeId, trainingObj, client) {
  const conn = client || pool;
  if (!trainingObj) return;

  for (const [staffId, staffRecords] of Object.entries(trainingObj)) {
    for (const [typeId, rec] of Object.entries(staffRecords)) {
      await conn.query(
        `INSERT INTO training_records
           (home_id, staff_id, training_type_id, completed, expiry, trainer, method,
            certificate_ref, level, notes, updated_at, deleted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NULL)
         ON CONFLICT (home_id, staff_id, training_type_id) DO UPDATE SET
           completed       = EXCLUDED.completed,
           expiry          = EXCLUDED.expiry,
           trainer         = EXCLUDED.trainer,
           method          = EXCLUDED.method,
           certificate_ref = EXCLUDED.certificate_ref,
           level           = EXCLUDED.level,
           notes           = EXCLUDED.notes,
           updated_at      = NOW(),
           deleted_at      = NULL`,
        [
          homeId, staffId, typeId,
          rec.completed ?? null, rec.expiry ?? null,
          rec.trainer ?? null, rec.method ?? null,
          rec.certificate_ref ?? null, rec.level ?? null,
          rec.notes ?? null,
        ]
      );
    }
  }
}

export async function upsertRecord(homeId, staffId, typeId, record) {
  const { rows } = await pool.query(
    `INSERT INTO training_records
       (home_id, staff_id, training_type_id, completed, expiry, trainer, method,
        certificate_ref, level, notes, updated_at, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NULL)
     ON CONFLICT (home_id, staff_id, training_type_id) DO UPDATE SET
       completed = EXCLUDED.completed, expiry = EXCLUDED.expiry,
       trainer = EXCLUDED.trainer, method = EXCLUDED.method,
       certificate_ref = EXCLUDED.certificate_ref, level = EXCLUDED.level,
       notes = EXCLUDED.notes, updated_at = NOW(), deleted_at = NULL
     RETURNING staff_id, training_type_id, completed, expiry, trainer, method, certificate_ref, level, notes, updated_at`,
    [homeId, staffId, typeId,
     record.completed ?? null, record.expiry ?? null,
     record.trainer ?? null, record.method ?? null,
     record.certificate_ref ?? null, record.level ?? null,
     record.notes ?? null]
  );
  const r = rows[0];
  return {
    completed: r.completed ? r.completed.toISOString().slice(0, 10) : null,
    expiry:    r.expiry    ? r.expiry.toISOString().slice(0, 10)    : null,
    trainer:   r.trainer   ?? undefined,
    method:    r.method    ?? undefined,
    certificate_ref: r.certificate_ref ?? undefined,
    level:     r.level     ?? undefined,
    notes:     r.notes     ?? undefined,
    updated_at: r.updated_at ? r.updated_at.toISOString() : undefined,
  };
}

export async function removeRecord(homeId, staffId, typeId) {
  await pool.query(
    'UPDATE training_records SET deleted_at=NOW() WHERE home_id=$1 AND staff_id=$2 AND training_type_id=$3 AND deleted_at IS NULL',
    [homeId, staffId, typeId]
  );
}
