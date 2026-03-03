import { pool, toDateStr } from '../db.js';

/**
 * Return all training records for a home, shaped as:
 * { "staffId": { "typeId": { completed, expiry, trainer, method, certificate_ref, level, notes } } }
 * @param {number} homeId
 */
export async function findByHome(homeId, { limit = 500, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT *, COUNT(*) OVER() AS _total
     FROM training_records
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY staff_id, training_type_id
     LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 2000), Math.max(offset, 0)]
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  const result = {};
  for (const row of rows) {
    if (!result[row.staff_id]) result[row.staff_id] = {};
    result[row.staff_id][row.training_type_id] = {
      completed: toDateStr(row.completed),
      expiry:    toDateStr(row.expiry),
      trainer:   row.trainer   ?? undefined,
      method:    row.method    ?? undefined,
      certificate_ref: row.certificate_ref ?? undefined,
      level:     row.level     ?? undefined,
      notes:     row.notes     ?? undefined,
      updated_at: row.updated_at ? row.updated_at.toISOString() : undefined,
    };
  }
  return { rows: result, total };
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

  // Flatten nested { staffId: { typeId: record } } to flat array
  const flat = [];
  for (const [staffId, staffRecords] of Object.entries(trainingObj)) {
    for (const [typeId, rec] of Object.entries(staffRecords)) {
      flat.push({ staffId, typeId, ...rec });
    }
  }
  if (flat.length === 0) return;

  // Batch upsert — 9 per-row params, homeId shared as $1
  const COLS_PER_ROW = 9;
  const CHUNK = Math.floor(65000 / COLS_PER_ROW); // stay within PG 65535 param limit
  for (let i = 0; i < flat.length; i += CHUNK) {
    const chunk = flat.slice(i, i + CHUNK);
    const placeholders = [];
    const values = [];
    chunk.forEach((r, j) => {
      const b = j * COLS_PER_ROW + 2; // $1 is homeId
      placeholders.push(
        `($1,$${b},$${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},NOW(),NULL)`
      );
      values.push(
        r.staffId, r.typeId,
        r.completed ?? null, r.expiry ?? null,
        r.trainer ?? null, r.method ?? null,
        r.certificate_ref ?? null, r.level ?? null,
        r.notes ?? null,
      );
    });
    await conn.query(
      `INSERT INTO training_records
         (home_id, staff_id, training_type_id, completed, expiry, trainer, method,
          certificate_ref, level, notes, updated_at, deleted_at)
       VALUES ${placeholders.join(',')}
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
      [homeId, ...values]
    );
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
    completed: toDateStr(r.completed),
    expiry:    toDateStr(r.expiry),
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
