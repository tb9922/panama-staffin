import { pool } from '../db.js';

function shapeRow(row) {
  const shaped = { ...row };
  for (const col of ['last_reviewed', 'next_review']) {
    if (shaped[col] instanceof Date) shaped[col] = shaped[col].toISOString().slice(0, 10);
  }
  if (shaped.updated_at instanceof Date) shaped.updated_at = shaped.updated_at.toISOString();
  if (shaped.version != null) shaped.version = parseInt(shaped.version, 10);
  delete shaped.home_id;
  delete shaped.created_at;
  delete shaped.deleted_at;
  return shaped;
}

export async function findByHome(homeId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT *, COUNT(*) OVER() AS _total FROM risk_register
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY residual_risk DESC NULLS LAST LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 500), Math.max(offset, 0)]
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shapeRow(rest); }), total };
}

export async function sync(homeId, arr, client) {
  const conn = client || pool;
  if (!arr) return;
  const incomingIds = arr.map(r => r.id);

  for (const r of arr) {
    await conn.query(
      `INSERT INTO risk_register (
         id, home_id, title, description, category, owner, likelihood, impact, inherent_risk,
         controls, residual_likelihood, residual_impact, residual_risk, actions,
         last_reviewed, next_review, status, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (home_id, id) DO UPDATE SET
         title=$3,description=$4,category=$5,owner=$6,likelihood=$7,impact=$8,inherent_risk=$9,
         controls=$10,residual_likelihood=$11,residual_impact=$12,residual_risk=$13,actions=$14,
         last_reviewed=$15,next_review=$16,status=$17,updated_at=$18,deleted_at=NULL`,
      [
        r.id, homeId, r.title || null, r.description || null, r.category || null,
        r.owner || null, r.likelihood ?? null, r.impact ?? null, r.inherent_risk ?? null,
        JSON.stringify(r.controls || []), r.residual_likelihood ?? null,
        r.residual_impact ?? null, r.residual_risk ?? null,
        JSON.stringify(r.actions || []), r.last_reviewed || null,
        r.next_review || null, r.status || null, r.updated_at || null,
      ]
    );
  }

  if (incomingIds.length > 0) {
    await conn.query(
      `UPDATE risk_register SET deleted_at = NOW() WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL`,
      [homeId, incomingIds]
    );
  } else {
    await conn.query(`UPDATE risk_register SET deleted_at = NOW() WHERE home_id = $1 AND deleted_at IS NULL`, [homeId]);
  }
}

// ── Individual CRUD (Mode 2 endpoints) ────────────────────────────────────────

import { randomUUID } from 'crypto';

export async function findById(id, homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM risk_register WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function upsert(homeId, data) {
  const id = data.id || `rsk-${randomUUID()}`;
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO risk_register (
       id, home_id, title, description, category, owner, likelihood, impact, inherent_risk,
       controls, residual_likelihood, residual_impact, residual_risk, actions,
       last_reviewed, next_review, status, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (home_id, id) DO UPDATE SET
       title=$3,description=$4,category=$5,owner=$6,likelihood=$7,impact=$8,inherent_risk=$9,
       controls=$10,residual_likelihood=$11,residual_impact=$12,residual_risk=$13,actions=$14,
       last_reviewed=$15,next_review=$16,status=$17,updated_at=$18,deleted_at=NULL
     RETURNING *`,
    [
      id, homeId, data.title || null, data.description || null, data.category || null,
      data.owner || null, data.likelihood ?? null, data.impact ?? null, data.inherent_risk ?? null,
      JSON.stringify(data.controls || []), data.residual_likelihood ?? null,
      data.residual_impact ?? null, data.residual_risk ?? null,
      JSON.stringify(data.actions || []), data.last_reviewed || null,
      data.next_review || null, data.status || null, now,
    ]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

// Column name whitelist for dynamic SQL
const ALLOWED_COLUMNS = new Set([
  'title', 'description', 'category', 'owner', 'likelihood', 'impact', 'inherent_risk',
  'controls', 'residual_likelihood', 'residual_impact', 'residual_risk', 'actions',
  'last_reviewed', 'next_review', 'status',
]);

export async function update(id, homeId, data, version) {
  const fields = Object.entries(data).filter(([k, v]) => v !== undefined && ALLOWED_COLUMNS.has(k));
  if (fields.length === 0) return findById(id, homeId);
  const mapped = fields.map(([k, v]) => [k, ['controls', 'actions'].includes(k) ? JSON.stringify(v) : v]);
  const params = [id, homeId, ...mapped.map(([_, v]) => v)];
  const setClause = mapped.map(([k], i) => `"${k}" = $${i + 3}`).join(', ');
  let sql = `UPDATE risk_register SET ${setClause}, updated_at = NOW(), version = version + 1 WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ' RETURNING *';
  const { rows, rowCount } = await pool.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function softDelete(id, homeId) {
  const { rowCount } = await pool.query(
    'UPDATE risk_register SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rowCount > 0;
}
