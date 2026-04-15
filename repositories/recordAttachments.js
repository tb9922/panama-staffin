import { pool } from '../db.js';

const COLS = `
  id,
  home_id,
  module,
  record_id,
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
    module: row.module,
    record_id: row.record_id,
    original_name: row.original_name,
    stored_name: row.stored_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    description: row.description,
    uploaded_by: row.uploaded_by,
    created_at: row.created_at,
  } : null;
}

export async function findAttachments(homeId, moduleId, recordId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS}
       FROM record_file_attachments
      WHERE home_id = $1
        AND module = $2
        AND record_id = $3
        AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [homeId, moduleId, recordId]
  );
  return rows.map(shape);
}

export async function findByHome(homeId, { moduleId, moduleIds, limit = 5000 } = {}, client) {
  const conn = client || pool;
  const params = [homeId];
  let sql = `
    SELECT ${COLS}
      FROM record_file_attachments
     WHERE home_id = $1
       AND deleted_at IS NULL
  `;
  if (moduleId) {
    params.push(moduleId);
    sql += ` AND module = $${params.length}`;
  } else if (moduleIds?.length) {
    params.push(moduleIds);
    sql += ` AND module = ANY($${params.length}::text[])`;
  }
  sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
  params.push(Math.min(limit, 10000));
  const { rows } = await conn.query(sql, params);
  return rows.map(shape);
}

export async function findById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS}
       FROM record_file_attachments
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL`,
    [id, homeId]
  );
  return shape(rows[0]);
}

export async function create(homeId, moduleId, recordId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO record_file_attachments
       (home_id, module, record_id, original_name, stored_name, mime_type, size_bytes, description, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING ${COLS}`,
    [
      homeId,
      moduleId,
      recordId,
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
    `UPDATE record_file_attachments
        SET deleted_at = NOW()
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL
    RETURNING ${COLS}`,
    [id, homeId]
  );
  return shape(rows[0]);
}
