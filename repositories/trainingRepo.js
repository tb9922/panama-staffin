import { ConflictError } from '../errors.js';
import { pool, toDateStr } from '../db.js';

/**
 * Return all training records for a home, shaped as:
 * { "staffId": { "typeId": { completed, expiry, trainer, method, certificate_ref, evidence_ref, level, notes } } }
 * @param {number} homeId
 */
export async function findByHome(homeId, { limit = 5000, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, home_id, staff_id, training_type_id, completed, expiry,
            trainer, method, certificate_ref, evidence_ref, level, notes, updated_at,
            COUNT(*) OVER() AS _total
     FROM training_records
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY staff_id, training_type_id
     LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 10000), Math.max(offset, 0)]
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
        evidence_ref: row.evidence_ref ?? undefined,
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

  // Batch upsert — 10 per-row params, homeId shared as $1
  const COLS_PER_ROW = 10;
  const CHUNK = Math.floor(65000 / COLS_PER_ROW); // stay within PG 65535 param limit
  for (let i = 0; i < flat.length; i += CHUNK) {
    const chunk = flat.slice(i, i + CHUNK);
    const placeholders = [];
    const values = [];
    chunk.forEach((r, j) => {
      const b = j * COLS_PER_ROW + 2; // $1 is homeId
      placeholders.push(
        `($1,$${b},$${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},NOW(),NULL)`
      );
      values.push(
        r.staffId, r.typeId,
        r.completed ?? null, r.expiry ?? null,
        r.trainer ?? null, r.method ?? null,
        r.certificate_ref ?? null, r.evidence_ref ?? null, r.level ?? null,
        r.notes ?? null,
      );
    });
    await conn.query(
      `INSERT INTO training_records
         (home_id, staff_id, training_type_id, completed, expiry, trainer, method,
           certificate_ref, evidence_ref, level, notes, updated_at, deleted_at)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (home_id, staff_id, training_type_id) DO UPDATE SET
         completed       = EXCLUDED.completed,
         expiry          = EXCLUDED.expiry,
         trainer         = EXCLUDED.trainer,
         method          = EXCLUDED.method,
          certificate_ref = EXCLUDED.certificate_ref,
          evidence_ref    = EXCLUDED.evidence_ref,
          level           = EXCLUDED.level,
         notes           = EXCLUDED.notes,
         updated_at      = NOW(),
         deleted_at      = NULL`,
      [homeId, ...values]
    );
  }
}

export async function upsertRecord(homeId, staffId, typeId, record, client) {
  const conn = client || pool;
  const clientUpdatedAt = record._clientUpdatedAt || null;

  if (clientUpdatedAt) {
    const { rows, rowCount } = await conn.query(
      `UPDATE training_records
        SET completed = $4,
            expiry = $5,
            trainer = $6,
            method = $7,
            certificate_ref = $8,
            evidence_ref = $9,
            level = $10,
            notes = $11,
            updated_at = NOW(),
            deleted_at = NULL
       WHERE home_id = $1
         AND staff_id = $2
         AND training_type_id = $3
         AND deleted_at IS NULL
          AND date_trunc('milliseconds', updated_at) = $12::timestamptz
       RETURNING staff_id, training_type_id, completed, expiry, trainer, method, certificate_ref, evidence_ref, level, notes, updated_at`,
      [homeId, staffId, typeId,
        record.completed ?? null, record.expiry ?? null,
        record.trainer ?? null, record.method ?? null,
        record.certificate_ref ?? null, record.evidence_ref ?? null, record.level ?? null,
        record.notes ?? null, clientUpdatedAt]
    );
    if (rowCount === 0) {
      throw new ConflictError('Record was modified by another user. Please refresh and try again.');
    }
    const r = rows[0];
    return {
      completed: toDateStr(r.completed),
      expiry:    toDateStr(r.expiry),
      trainer:   r.trainer   ?? undefined,
      method:    r.method    ?? undefined,
      certificate_ref: r.certificate_ref ?? undefined,
      evidence_ref: r.evidence_ref ?? undefined,
      level:     r.level     ?? undefined,
      notes:     r.notes     ?? undefined,
      updated_at: r.updated_at ? r.updated_at.toISOString() : undefined,
    };
  }

  const { rows } = await conn.query(
    `INSERT INTO training_records
       (home_id, staff_id, training_type_id, completed, expiry, trainer, method,
         certificate_ref, evidence_ref, level, notes, updated_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NULL)
       ON CONFLICT (home_id, staff_id, training_type_id) DO NOTHING
       RETURNING staff_id, training_type_id, completed, expiry, trainer, method, certificate_ref, evidence_ref, level, notes, updated_at`,
    [homeId, staffId, typeId,
      record.completed ?? null, record.expiry ?? null,
      record.trainer ?? null, record.method ?? null,
      record.certificate_ref ?? null, record.evidence_ref ?? null, record.level ?? null,
      record.notes ?? null]
  );
  if (rows.length === 0) {
    throw new ConflictError('Record was modified by another user. Please refresh and try again.');
  }
  const r = rows[0];
  return {
    completed: toDateStr(r.completed),
    expiry:    toDateStr(r.expiry),
    trainer:   r.trainer   ?? undefined,
    method:    r.method    ?? undefined,
    certificate_ref: r.certificate_ref ?? undefined,
    evidence_ref: r.evidence_ref ?? undefined,
    level:     r.level     ?? undefined,
    notes:     r.notes     ?? undefined,
    updated_at: r.updated_at ? r.updated_at.toISOString() : undefined,
  };
}

export async function removeRecord(homeId, staffId, typeId, client) {
  const conn = client || pool;
  await conn.query(
    'UPDATE training_records SET deleted_at=NOW() WHERE home_id=$1 AND staff_id=$2 AND training_type_id=$3 AND deleted_at IS NULL',
    [homeId, staffId, typeId]
  );
}
