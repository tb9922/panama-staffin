import { pool } from '../db.js';
import { toIsoOrNull } from '../lib/serverTimestamps.js';

const ts = toIsoOrNull;

const COLS = 'id, home_id, title, description, category, owner, likelihood, impact, inherent_risk, controls, residual_likelihood, residual_impact, residual_risk, actions, last_reviewed, next_review, status, updated_at, version';

function shapeRow(row) {
  return {
    id: row.id, version: row.version != null ? parseInt(row.version, 10) : undefined,
    title: row.title, description: row.description, category: row.category, owner: row.owner,
    likelihood: row.likelihood, impact: row.impact, inherent_risk: row.inherent_risk,
    controls: row.controls,
    residual_likelihood: row.residual_likelihood, residual_impact: row.residual_impact, residual_risk: row.residual_risk,
    actions: row.actions, last_reviewed: row.last_reviewed, next_review: row.next_review,
    status: row.status, updated_at: ts(row.updated_at),
  };
}

export async function findByHome(homeId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT ${COLS}, COUNT(*) OVER() AS _total FROM risk_register
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY residual_risk DESC NULLS LAST LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 500), Math.max(offset, 0)]
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shapeRow(rest); }), total };
}

export async function sync(homeId, arr, client) {
  const conn = client || pool;
  // An empty array often means the frontend has not loaded records yet.
  // Treating that as "delete everything" is too destructive.
  if (!arr || arr.length === 0) return;
  const incomingIds = arr.map(r => r.id);

  // Batch upsert — 16 per-row params (id + 14 fields + status; homeId=$1, updated_at=NOW())
  const COLS_PER_ROW = 16;
  const CHUNK = Math.floor(65000 / COLS_PER_ROW);
  for (let i = 0; i < arr.length; i += CHUNK) {
    const chunk = arr.slice(i, i + CHUNK);
    const placeholders = [];
    const values = [];
    chunk.forEach((r, j) => {
      const b = j * COLS_PER_ROW + 2; // $1 is homeId
      placeholders.push(
        `($${b},$1,$${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},` +
        `$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},` +
        `$${b+13},$${b+14},$${b+15},NOW())`
      );
      values.push(
        r.id, r.title || null, r.description || null, r.category || null,
        r.owner || null, r.likelihood ?? null, r.impact ?? null, r.inherent_risk ?? null,
        JSON.stringify(r.controls || []), r.residual_likelihood ?? null,
        r.residual_impact ?? null, r.residual_risk ?? null,
        JSON.stringify(r.actions || []), r.last_reviewed || null,
        r.next_review || null, r.status || null,
      );
    });
    await conn.query(
      `INSERT INTO risk_register (
         id, home_id, title, description, category, owner, likelihood, impact, inherent_risk,
         controls, residual_likelihood, residual_impact, residual_risk, actions,
         last_reviewed, next_review, status, updated_at
       ) VALUES ${placeholders.join(',')}
       ON CONFLICT (home_id, id) DO UPDATE SET
         title                = EXCLUDED.title,
         description          = EXCLUDED.description,
         category             = EXCLUDED.category,
         owner                = EXCLUDED.owner,
         likelihood           = EXCLUDED.likelihood,
         impact               = EXCLUDED.impact,
         inherent_risk        = EXCLUDED.inherent_risk,
         controls             = EXCLUDED.controls,
         residual_likelihood  = EXCLUDED.residual_likelihood,
         residual_impact      = EXCLUDED.residual_impact,
         residual_risk        = EXCLUDED.residual_risk,
         actions              = EXCLUDED.actions,
         last_reviewed        = EXCLUDED.last_reviewed,
         next_review          = EXCLUDED.next_review,
         status               = EXCLUDED.status,
         updated_at           = NOW(),
         deleted_at           = NULL`,
      [homeId, ...values]
    );
  }

  await conn.query(
    `UPDATE risk_register SET deleted_at = NOW() WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL`,
    [homeId, incomingIds]
  );
}

// ── Individual CRUD (Mode 2 endpoints) ────────────────────────────────────────

import { randomUUID } from 'crypto';

export async function findById(id, homeId) {
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM risk_register WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
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
     RETURNING ${COLS}`,
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
  sql += ` RETURNING ${COLS}`;
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
