import { randomUUID } from 'crypto';
import { pool } from '../db.js';

const COLS = `
  id, home_id, version, quality_statement, feedback_date, title,
  partner_name, partner_role, relationship, summary, response_action,
  evidence_owner, review_due, added_by, added_at, created_at, updated_at, deleted_at
`;

function shapeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    home_id: row.home_id,
    version: row.version != null ? parseInt(row.version, 10) : 1,
    quality_statement: row.quality_statement,
    feedback_date: row.feedback_date,
    title: row.title,
    partner_name: row.partner_name || null,
    partner_role: row.partner_role || null,
    relationship: row.relationship || null,
    summary: row.summary || null,
    response_action: row.response_action || null,
    evidence_owner: row.evidence_owner || null,
    review_due: row.review_due || null,
    added_by: row.added_by || null,
    added_at: row.added_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function findByHome(homeId, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM cqc_partner_feedback
      WHERE home_id = $1
        AND deleted_at IS NULL
      ORDER BY feedback_date DESC, created_at DESC`,
    [homeId]
  );
  return rows.map(shapeRow);
}

export async function findById(id, homeId, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM cqc_partner_feedback
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL`,
    [id, homeId]
  );
  return shapeRow(rows[0]);
}

export async function create(homeId, data, client = pool) {
  const id = data.id || `cpf-${randomUUID()}`;
  const now = new Date().toISOString();
  const { rows } = await client.query(
    `INSERT INTO cqc_partner_feedback (
       id, home_id, quality_statement, feedback_date, title,
       partner_name, partner_role, relationship, summary, response_action,
       evidence_owner, review_due, added_by, added_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING ${COLS}`,
    [
      id,
      homeId,
      data.quality_statement,
      data.feedback_date,
      data.title,
      data.partner_name || null,
      data.partner_role || null,
      data.relationship || null,
      data.summary || null,
      data.response_action || null,
      data.evidence_owner || null,
      data.review_due || null,
      data.added_by || null,
      data.added_at || now,
    ]
  );
  return shapeRow(rows[0]);
}

const ALLOWED_COLUMNS = new Set([
  'quality_statement',
  'feedback_date',
  'title',
  'partner_name',
  'partner_role',
  'relationship',
  'summary',
  'response_action',
  'evidence_owner',
  'review_due',
]);

export async function update(id, homeId, data, version = null, client = pool) {
  const fields = Object.entries(data).filter(([key, value]) => value !== undefined && ALLOWED_COLUMNS.has(key));
  if (fields.length === 0) return findById(id, homeId, client);

  const setClause = fields.map(([key], index) => `"${key}" = $${index + 3}`).join(', ');
  const params = [id, homeId, ...fields.map(([, value]) => value)];
  let sql = `
    UPDATE cqc_partner_feedback
       SET ${setClause},
           version = version + 1,
           updated_at = NOW()
     WHERE id = $1
       AND home_id = $2
       AND deleted_at IS NULL
  `;
  if (version != null) {
    params.push(version);
    sql += ` AND version = $${params.length}`;
  }
  sql += ` RETURNING ${COLS}`;

  const { rows, rowCount } = await client.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return shapeRow(rows[0]);
}

export async function softDelete(id, homeId, client = pool) {
  const { rowCount } = await client.query(
    `UPDATE cqc_partner_feedback
        SET deleted_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
        AND home_id = $2
        AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rowCount > 0;
}
