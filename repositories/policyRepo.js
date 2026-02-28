import { pool } from '../db.js';

function shapeRow(row) {
  const shaped = { ...row };
  for (const col of ['last_reviewed', 'next_review_due']) {
    if (shaped[col] instanceof Date) shaped[col] = shaped[col].toISOString().slice(0, 10);
  }
  if (shaped.updated_at instanceof Date) shaped.updated_at = shaped.updated_at.toISOString();
  if (typeof shaped.changes === 'string') shaped.changes = JSON.parse(shaped.changes);
  if (shaped.version != null) shaped.version = parseInt(shaped.version, 10);
  delete shaped.home_id;
  delete shaped.created_at;
  delete shaped.deleted_at;
  return shaped;
}

export async function findByHome(homeId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT *, COUNT(*) OVER() AS _total FROM policy_reviews
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY next_review_due ASC NULLS LAST LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 500), Math.max(offset, 0)]
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shapeRow(rest); }), total };
}

export async function sync(homeId, arr, client) {
  const conn = client || pool;
  if (!arr) return;
  const incomingIds = arr.map(p => p.id);

  for (const p of arr) {
    await conn.query(
      `INSERT INTO policy_reviews (
         id, home_id, policy_name, policy_ref, category, version,
         last_reviewed, next_review_due, review_frequency_months,
         status, reviewed_by, approved_by, changes, notes, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (home_id, id) DO UPDATE SET
         policy_name=$3,policy_ref=$4,category=$5,version=$6,
         last_reviewed=$7,next_review_due=$8,review_frequency_months=$9,
         status=$10,reviewed_by=$11,approved_by=$12,changes=$13,notes=$14,
         updated_at=$15,deleted_at=NULL`,
      [
        p.id, homeId, p.policy_name || null, p.policy_ref || null,
        p.category || null, p.version || null,
        p.last_reviewed || null, p.next_review_due || null,
        p.review_frequency_months ?? null, p.status || null,
        p.reviewed_by || null, p.approved_by || null,
        JSON.stringify(p.changes || []), p.notes || null,
        p.updated_at || null,
      ]
    );
  }

  if (incomingIds.length > 0) {
    await conn.query(
      `UPDATE policy_reviews SET deleted_at = NOW() WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL`,
      [homeId, incomingIds]
    );
  } else {
    await conn.query(`UPDATE policy_reviews SET deleted_at = NOW() WHERE home_id = $1 AND deleted_at IS NULL`, [homeId]);
  }
}

// ── Individual CRUD (Mode 2 endpoints) ────────────────────────────────────────

import { randomUUID } from 'crypto';

export async function findById(id, homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM policy_reviews WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function upsert(homeId, data) {
  const id = data.id || `pol-${randomUUID()}`;
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO policy_reviews (
       id, home_id, policy_name, policy_ref, category, version,
       last_reviewed, next_review_due, review_frequency_months,
       status, reviewed_by, approved_by, changes, notes, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (home_id, id) DO UPDATE SET
       policy_name=$3,policy_ref=$4,category=$5,version=$6,
       last_reviewed=$7,next_review_due=$8,review_frequency_months=$9,
       status=$10,reviewed_by=$11,approved_by=$12,changes=$13,notes=$14,
       updated_at=$15,deleted_at=NULL
     RETURNING *`,
    [
      id, homeId, data.policy_name || null, data.policy_ref || null,
      data.category || null, data.version || null,
      data.last_reviewed || null, data.next_review_due || null,
      data.review_frequency_months ?? null, data.status || null,
      data.reviewed_by || null, data.approved_by || null,
      JSON.stringify(data.changes || []), data.notes || null,
      now,
    ]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function update(id, homeId, data, version) {
  const fields = Object.entries(data).filter(([_, v]) => v !== undefined);
  if (fields.length === 0) return findById(id, homeId);
  const mapped = fields.map(([k, v]) => [k, k === 'changes' ? JSON.stringify(v) : v]);
  const params = [id, homeId, ...mapped.map(([_, v]) => v)];
  const setClause = mapped.map(([k], i) => `"${k}" = $${i + 3}`).join(', ');
  let sql = `UPDATE policy_reviews SET ${setClause}, updated_at = NOW(), version = version + 1 WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ' RETURNING *';
  const { rows, rowCount } = await pool.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function softDelete(id, homeId) {
  const { rowCount } = await pool.query(
    'UPDATE policy_reviews SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rowCount > 0;
}
