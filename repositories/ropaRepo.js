import { pool } from '../db.js';

const d = v => v instanceof Date ? v.toISOString().slice(0, 10) : v;
const ts = v => v instanceof Date ? v.toISOString() : v;

const COLS = 'id, home_id, purpose, legal_basis, categories_of_individuals, categories_of_data, categories_of_recipients, international_transfers, transfer_safeguards, retention_period, security_measures, data_source, system_or_asset, special_category, dpia_required, status, last_reviewed, next_review_due, notes, version, created_by, created_at, updated_at';

function shape(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id,
    purpose: row.purpose, legal_basis: row.legal_basis,
    categories_of_individuals: row.categories_of_individuals,
    categories_of_data: row.categories_of_data,
    categories_of_recipients: row.categories_of_recipients,
    international_transfers: row.international_transfers,
    transfer_safeguards: row.transfer_safeguards,
    retention_period: row.retention_period,
    security_measures: row.security_measures,
    data_source: row.data_source, system_or_asset: row.system_or_asset,
    special_category: row.special_category, dpia_required: row.dpia_required,
    status: row.status,
    last_reviewed: d(row.last_reviewed), next_review_due: d(row.next_review_due),
    notes: row.notes,
    version: row.version, created_by: row.created_by,
    created_at: ts(row.created_at), updated_at: ts(row.updated_at),
  };
}

export async function findAll(homeId, { status, limit = 100, offset = 0 } = {}, client) {
  const conn = client || pool;
  let sql = `SELECT ${COLS}, COUNT(*) OVER() AS _total FROM ropa_activities WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  sql += ' ORDER BY purpose ASC';
  params.push(Math.min(limit, 500)); sql += ` LIMIT $${params.length}`;
  params.push(offset); sql += ` OFFSET $${params.length}`;
  const { rows } = await conn.query(sql, params);
  const total = rows.length > 0 ? parseInt(rows[0]._total) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shape(rest); }), total };
}

export async function findById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM ropa_activities WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`, [id, homeId]
  );
  return rows[0] ? shape(rows[0]) : null;
}

export async function create(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO ropa_activities (home_id, purpose, legal_basis, categories_of_individuals, categories_of_data,
       categories_of_recipients, international_transfers, transfer_safeguards, retention_period, security_measures,
       data_source, system_or_asset, special_category, dpia_required, status, last_reviewed, next_review_due, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING ${COLS}`,
    [homeId, data.purpose, data.legal_basis, data.categories_of_individuals, data.categories_of_data,
     data.categories_of_recipients || null, data.international_transfers ?? false,
     data.transfer_safeguards || null, data.retention_period || null, data.security_measures || null,
     data.data_source || null, data.system_or_asset || null, data.special_category ?? false,
     data.dpia_required ?? false, data.status || 'active',
     data.last_reviewed || null, data.next_review_due || null, data.notes || null, data.created_by]
  );
  return shape(rows[0]);
}

export async function update(id, homeId, data, client, version) {
  const conn = client || pool;
  const settable = [
    'purpose', 'legal_basis', 'categories_of_individuals', 'categories_of_data',
    'categories_of_recipients', 'international_transfers', 'transfer_safeguards',
    'retention_period', 'security_measures', 'data_source', 'system_or_asset',
    'special_category', 'dpia_required', 'status', 'last_reviewed', 'next_review_due', 'notes',
  ];
  const fields = [];
  const params = [id, homeId];
  for (const key of settable) {
    if (key in data) { params.push(data[key] ?? null); fields.push(`${key} = $${params.length}`); }
  }
  if (fields.length === 0) return findById(id, homeId, client);
  fields.push('version = version + 1', 'updated_at = NOW()');
  let sql = `UPDATE ropa_activities SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ` RETURNING ${COLS}`;
  const { rows, rowCount } = await conn.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shape(rows[0]) : null;
}

export async function softDelete(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE ropa_activities SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING id`,
    [id, homeId]
  );
  return rows[0] || null;
}

export async function countActive(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    "SELECT COUNT(*)::int AS count FROM ropa_activities WHERE home_id = $1 AND status = 'active' AND deleted_at IS NULL",
    [homeId]
  );
  return rows[0].count;
}
