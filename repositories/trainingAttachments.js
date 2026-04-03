import { pool } from '../db.js';

const COLS = `
  id,
  home_id,
  staff_id,
  training_type,
  original_name,
  stored_name,
  mime_type,
  size_bytes,
  description,
  uploaded_by,
  created_at
`;

function shape(row) {
  return row ? {
    id: row.id,
    home_id: row.home_id,
    staff_id: row.staff_id,
    training_type: row.training_type,
    original_name: row.original_name,
    stored_name: row.stored_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    description: row.description,
    uploaded_by: row.uploaded_by,
    created_at: row.created_at,
  } : null;
}

export async function findAttachments(homeId, staffId, trainingType, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS}
       FROM training_file_attachments
      WHERE home_id = $1
        AND staff_id = $2
        AND training_type = $3
        AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [homeId, staffId, trainingType]
  );
  return rows.map(shape);
}

export async function findById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS}
       FROM training_file_attachments
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL`,
    [id, homeId]
  );
  return shape(rows[0]);
}

export async function create(homeId, staffId, trainingType, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO training_file_attachments
       (home_id, staff_id, training_type, original_name, stored_name, mime_type, size_bytes, description, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING ${COLS}`,
    [
      homeId,
      staffId,
      trainingType,
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
    `UPDATE training_file_attachments
        SET deleted_at = NOW()
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL
    RETURNING ${COLS}`,
    [id, homeId]
  );
  return shape(rows[0]);
}
