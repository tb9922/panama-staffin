import { pool } from '../db.js';

const COLS = 'id, home_id, evidence_id, original_name, stored_name, mime_type, size_bytes, description, uploaded_by, created_at';

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    home_id: row.home_id,
    evidence_id: row.evidence_id,
    original_name: row.original_name,
    stored_name: row.stored_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    description: row.description,
    uploaded_by: row.uploaded_by,
    created_at: row.created_at,
  };
}

export async function findByEvidence(homeId, evidenceId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT f.${COLS.split(', ').join(', f.')}
       FROM cqc_evidence_files f
       INNER JOIN cqc_evidence e
               ON e.home_id = f.home_id
              AND e.id = f.evidence_id
              AND e.deleted_at IS NULL
      WHERE f.home_id = $1
        AND f.evidence_id = $2
        AND f.deleted_at IS NULL
      ORDER BY f.created_at DESC`,
    [homeId, evidenceId]
  );
  return rows.map(shape);
}

export async function findByHome(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT f.${COLS.split(', ').join(', f.')}
       FROM cqc_evidence_files f
       INNER JOIN cqc_evidence e
               ON e.home_id = f.home_id
              AND e.id = f.evidence_id
              AND e.deleted_at IS NULL
      WHERE f.home_id = $1
        AND f.deleted_at IS NULL
      ORDER BY f.created_at DESC`,
    [homeId]
  );
  return rows.map(shape);
}

export async function findById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS}
       FROM cqc_evidence_files
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL`,
    [id, homeId]
  );
  return shape(rows[0]);
}

export async function create(homeId, evidenceId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO cqc_evidence_files
       (home_id, evidence_id, original_name, stored_name, mime_type, size_bytes, description, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING ${COLS}`,
    [
      homeId,
      evidenceId,
      data.original_name,
      data.stored_name,
      data.mime_type,
      data.size_bytes,
      data.description || null,
      data.uploaded_by,
    ]
  );
  return shape(rows[0]);
}

export async function softDelete(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE cqc_evidence_files
        SET deleted_at = NOW()
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL
    RETURNING ${COLS}`,
    [id, homeId]
  );
  return shape(rows[0]);
}
