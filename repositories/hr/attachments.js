import { pool, createShaper } from './shared.js';

const COLS = 'id, home_id, case_type, case_id, original_name, stored_name, mime_type, size_bytes, description, uploaded_by, created_at';

const shapeAttachment = createShaper({
  fields: [
    'id', 'home_id', 'case_type', 'case_id', 'original_name', 'stored_name',
    'mime_type', 'size_bytes', 'description', 'uploaded_by', 'created_at',
  ],
  timestamps: ['created_at'],
});

export async function findAttachments(caseType, caseId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM hr_file_attachments WHERE case_type = $1 AND case_id = $2 AND home_id = $3 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [caseType, caseId, homeId]
  );
  return rows.map(shapeAttachment);
}

export async function findAttachmentById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM hr_file_attachments WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return shapeAttachment(rows[0]);
}

export async function createAttachment(homeId, caseType, caseId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_file_attachments (home_id, case_type, case_id, original_name, stored_name, mime_type, size_bytes, description, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLS}`,
    [homeId, caseType, caseId, data.original_name, data.stored_name, data.mime_type, data.size_bytes, data.description || null, data.uploaded_by]
  );
  return shapeAttachment(rows[0]);
}

export async function deleteAttachment(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE hr_file_attachments SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING ${COLS}`,
    [id, homeId]
  );
  return shapeAttachment(rows[0]);
}
