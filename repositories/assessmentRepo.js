import { pool } from '../db.js';

const COLS = `id, home_id, engine, engine_version, computed_at, window_from, window_to,
  overall_score, band, result, computed_by, input_hash,
  signed_off_by, signed_off_at, sign_off_notes`;

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    home_id: row.home_id,
    engine: row.engine,
    engine_version: row.engine_version,
    computed_at: row.computed_at,
    window_from: row.window_from,
    window_to: row.window_to,
    overall_score: row.overall_score,
    band: row.band,
    result: row.result,
    computed_by: row.computed_by,
    input_hash: row.input_hash,
    signed_off_by: row.signed_off_by,
    signed_off_at: row.signed_off_at,
    sign_off_notes: row.sign_off_notes,
  };
}

export async function create(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO assessment_snapshots
       (home_id, engine, engine_version, window_from, window_to,
        overall_score, band, result, computed_by, input_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${COLS}`,
    [
      homeId, data.engine, data.engine_version || 'v1',
      data.window_from || null, data.window_to || null,
      data.overall_score, data.band, JSON.stringify(data.result),
      data.computed_by || null, data.input_hash || null,
    ]
  );
  return shape(rows[0]);
}

export async function findByHome(homeId, engine, limit = 20, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM assessment_snapshots
     WHERE home_id = $1 AND engine = $2
     ORDER BY computed_at DESC LIMIT $3`,
    [homeId, engine, limit]
  );
  return rows.map(shape);
}

export async function findById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM assessment_snapshots WHERE id = $1 AND home_id = $2`,
    [id, homeId]
  );
  return shape(rows[0]);
}

export async function signOff(id, homeId, signedOffBy, notes, client) {
  const conn = client || pool;
  // Prevent self-sign-off: computed_by must differ (NULL computed_by is allowed to be signed off)
  const { rows } = await conn.query(
    `UPDATE assessment_snapshots
     SET signed_off_by = $3, signed_off_at = NOW(), sign_off_notes = $4
     WHERE id = $1 AND home_id = $2 AND signed_off_by IS NULL
       AND (computed_by IS NULL OR computed_by != $3)
     RETURNING ${COLS}`,
    [id, homeId, signedOffBy, notes || null]
  );
  return shape(rows[0]);
}
