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

const QUALIFIED_COLS = COLS
  .split(',')
  .map(col => col.trim())
  .filter(Boolean)
  .map(col => `f.${col}`)
  .join(', ');

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
    `SELECT ${QUALIFIED_COLS}
       FROM training_file_attachments f
       INNER JOIN staff s
               ON s.home_id = f.home_id
              AND s.id = f.staff_id
              AND s.deleted_at IS NULL
      WHERE f.home_id = $1
        AND f.staff_id = $2
        AND f.training_type = $3
        AND f.deleted_at IS NULL
      ORDER BY f.created_at DESC`,
    [homeId, staffId, trainingType]
  );
  return rows.map(shape);
}

export async function findById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT
       f.id,
       f.home_id,
       f.staff_id,
       f.training_type,
       f.original_name,
       f.stored_name,
       f.mime_type,
       f.size_bytes,
       f.description,
       f.uploaded_by,
       f.created_at
       FROM training_file_attachments f
       INNER JOIN staff s
               ON s.home_id = f.home_id
              AND s.id = f.staff_id
              AND s.deleted_at IS NULL
      WHERE f.id = $1
        AND f.home_id = $2
        AND f.deleted_at IS NULL`,
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
    `UPDATE training_file_attachments f
        SET deleted_at = NOW()
      WHERE f.id = $1
        AND f.home_id = $2
        AND f.deleted_at IS NULL
        AND EXISTS (
          SELECT 1
            FROM staff s
           WHERE s.home_id = f.home_id
             AND s.id = f.staff_id
             AND s.deleted_at IS NULL
        )
    RETURNING ${QUALIFIED_COLS}`,
    [id, homeId]
  );
  return shape(rows[0]);
}
