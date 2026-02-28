import { pool } from '../db.js';

function shapeRow(row) {
  const shaped = { ...row };
  for (const col of ['last_completed', 'next_due', 'certificate_expiry']) {
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
    `SELECT *, COUNT(*) OVER() AS _total FROM maintenance
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY category LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 500), Math.max(offset, 0)]
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shapeRow(rest); }), total };
}

export async function sync(homeId, arr, client) {
  const conn = client || pool;
  if (!arr) return;
  const incomingIds = arr.map(m => m.id);

  for (const m of arr) {
    await conn.query(
      `INSERT INTO maintenance (
         id, home_id, category, description, frequency, last_completed, next_due,
         completed_by, contractor, items_checked, items_passed, items_failed,
         certificate_ref, certificate_expiry, notes, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (home_id, id) DO UPDATE SET
         category=$3,description=$4,frequency=$5,last_completed=$6,next_due=$7,
         completed_by=$8,contractor=$9,items_checked=$10,items_passed=$11,items_failed=$12,
         certificate_ref=$13,certificate_expiry=$14,notes=$15,updated_at=$16,deleted_at=NULL`,
      [
        m.id, homeId, m.category || null, m.description || null, m.frequency || null,
        m.last_completed || null, m.next_due || null, m.completed_by || null,
        m.contractor || null, m.items_checked ?? null, m.items_passed ?? null,
        m.items_failed ?? null, m.certificate_ref || null, m.certificate_expiry || null,
        m.notes || null, m.updated_at || null,
      ]
    );
  }

  if (incomingIds.length > 0) {
    await conn.query(
      `UPDATE maintenance SET deleted_at = NOW() WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL`,
      [homeId, incomingIds]
    );
  } else {
    await conn.query(`UPDATE maintenance SET deleted_at = NOW() WHERE home_id = $1 AND deleted_at IS NULL`, [homeId]);
  }
}

// ── Individual CRUD (Mode 2 endpoints) ────────────────────────────────────────

import { randomUUID } from 'crypto';

export async function findById(id, homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM maintenance WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function upsert(homeId, data) {
  const id = data.id || `mnt-${randomUUID()}`;
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO maintenance (
       id, home_id, category, description, frequency, last_completed, next_due,
       completed_by, contractor, items_checked, items_passed, items_failed,
       certificate_ref, certificate_expiry, notes, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (home_id, id) DO UPDATE SET
       category=$3,description=$4,frequency=$5,last_completed=$6,next_due=$7,
       completed_by=$8,contractor=$9,items_checked=$10,items_passed=$11,items_failed=$12,
       certificate_ref=$13,certificate_expiry=$14,notes=$15,updated_at=$16,deleted_at=NULL
     RETURNING *`,
    [
      id, homeId, data.category || null, data.description || null, data.frequency || null,
      data.last_completed || null, data.next_due || null, data.completed_by || null,
      data.contractor || null, data.items_checked ?? null, data.items_passed ?? null,
      data.items_failed ?? null, data.certificate_ref || null, data.certificate_expiry || null,
      data.notes || null, now,
    ]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

// Column name whitelist for dynamic SQL
const ALLOWED_COLUMNS = new Set([
  'category', 'description', 'frequency', 'last_completed', 'next_due',
  'completed_by', 'contractor', 'items_checked', 'items_passed', 'items_failed',
  'certificate_ref', 'certificate_expiry', 'notes',
]);

export async function update(id, homeId, data, version) {
  const fields = Object.entries(data).filter(([k, v]) => v !== undefined && ALLOWED_COLUMNS.has(k));
  if (fields.length === 0) return findById(id, homeId);
  const params = [id, homeId, ...fields.map(([_, v]) => v)];
  const setClause = fields.map(([k], i) => `"${k}" = $${i + 3}`).join(', ');
  let sql = `UPDATE maintenance SET ${setClause}, updated_at = NOW(), version = version + 1 WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ' RETURNING *';
  const { rows, rowCount } = await pool.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function softDelete(id, homeId) {
  const { rowCount } = await pool.query(
    'UPDATE maintenance SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rowCount > 0;
}
