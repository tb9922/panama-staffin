import { pool } from '../db.js';

const COLS = `
  id,
  home_id,
  status,
  source_file_sha256,
  stored_name,
  original_name,
  mime_type,
  size_bytes,
  ocr_engine,
  classification_target,
  classification_confidence,
  ocr_extraction_encrypted,
  ocr_extraction_iv,
  ocr_extraction_tag,
  summary_fields,
  error_message,
  reviewed_by,
  reviewed_at,
  routed_module,
  routed_record_id,
  routed_attachment_id,
  created_by,
  created_at,
  updated_at,
  deleted_at
`;

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    home_id: row.home_id,
    status: row.status,
    source_file_sha256: row.source_file_sha256,
    stored_name: row.stored_name,
    original_name: row.original_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    ocr_engine: row.ocr_engine,
    classification_target: row.classification_target,
    classification_confidence: row.classification_confidence != null ? Number(row.classification_confidence) : null,
    ocr_extraction_encrypted: row.ocr_extraction_encrypted || null,
    ocr_extraction_iv: row.ocr_extraction_iv || null,
    ocr_extraction_tag: row.ocr_extraction_tag || null,
    summary_fields: row.summary_fields || {},
    error_message: row.error_message || null,
    reviewed_by: row.reviewed_by || null,
    reviewed_at: row.reviewed_at || null,
    routed_module: row.routed_module || null,
    routed_record_id: row.routed_record_id || null,
    routed_attachment_id: row.routed_attachment_id || null,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at || null,
  };
}

export async function findById(id, homeId, client, { forUpdate = false } = {}) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS}
       FROM document_intake_items
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL${forUpdate ? ' FOR UPDATE' : ''}`,
    [id, homeId]
  );
  return shape(rows[0]);
}

export async function findBySha(homeId, sha256, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS}
       FROM document_intake_items
      WHERE home_id = $1
        AND source_file_sha256 = $2
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [homeId, sha256]
  );
  return shape(rows[0]);
}

export async function listByHome(homeId, { statuses, target, limit = 100, offset = 0 } = {}, client) {
  const conn = client || pool;
  const params = [homeId];
  let sql = `
    SELECT ${COLS}, COUNT(*) OVER() AS _total
      FROM document_intake_items
     WHERE home_id = $1
       AND deleted_at IS NULL
  `;
  if (statuses?.length) {
    params.push(statuses);
    sql += ` AND status = ANY($${params.length}::text[])`;
  }
  if (target) {
    params.push(target);
    sql += ` AND classification_target = $${params.length}`;
  }
  sql += ' ORDER BY created_at DESC, id DESC';
  params.push(Math.min(limit, 500));
  sql += ` LIMIT $${params.length}`;
  params.push(Math.max(offset, 0));
  sql += ` OFFSET $${params.length}`;
  const { rows } = await conn.query(sql, params);
  return {
    rows: rows.map(shape),
    total: rows.length > 0 ? parseInt(rows[0]._total, 10) : 0,
  };
}

export async function create(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO document_intake_items (
       home_id,
       status,
       source_file_sha256,
       stored_name,
       original_name,
       mime_type,
       size_bytes,
       ocr_engine,
       classification_target,
       classification_confidence,
       ocr_extraction_encrypted,
       ocr_extraction_iv,
       ocr_extraction_tag,
       summary_fields,
       error_message,
       reviewed_by,
       reviewed_at,
       routed_module,
       routed_record_id,
       routed_attachment_id,
       created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
     )
     RETURNING ${COLS}`,
    [
      homeId,
      data.status,
      data.source_file_sha256,
      data.stored_name,
      data.original_name,
      data.mime_type,
      data.size_bytes,
      data.ocr_engine || 'paddleocr',
      data.classification_target || null,
      data.classification_confidence ?? null,
      data.ocr_extraction_encrypted || null,
      data.ocr_extraction_iv || null,
      data.ocr_extraction_tag || null,
      JSON.stringify(data.summary_fields || {}),
      data.error_message || null,
      data.reviewed_by || null,
      data.reviewed_at || null,
      data.routed_module || null,
      data.routed_record_id || null,
      data.routed_attachment_id || null,
      data.created_by,
    ]
  );
  return shape(rows[0]);
}

export async function update(id, homeId, data, client) {
  const conn = client || pool;
  const fields = [];
  const params = [id, homeId];
  const settable = [
    'status',
    'classification_target',
    'classification_confidence',
    'ocr_extraction_encrypted',
    'ocr_extraction_iv',
    'ocr_extraction_tag',
    'summary_fields',
    'error_message',
    'reviewed_by',
    'reviewed_at',
    'routed_module',
    'routed_record_id',
    'routed_attachment_id',
  ];
  for (const key of settable) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    params.push(key === 'summary_fields' ? JSON.stringify(data[key] || {}) : (data[key] ?? null));
    fields.push(`${key} = $${params.length}`);
  }
  if (fields.length === 0) return findById(id, homeId, client);
  fields.push('updated_at = NOW()');
  const { rows } = await conn.query(
    `UPDATE document_intake_items
        SET ${fields.join(', ')}
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL
    RETURNING ${COLS}`,
    params
  );
  return shape(rows[0]);
}
