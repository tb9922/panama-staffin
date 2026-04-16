import { pool } from '../db.js';
import { toIsoOrNull } from '../lib/serverTimestamps.js';

const ts = toIsoOrNull;

const COLS = 'id, home_id, category, description, frequency, last_completed, next_due, completed_by, contractor, items_checked, items_passed, items_failed, certificate_ref, certificate_expiry, notes, updated_at, version';

function shapeRow(row) {
  return {
    id: row.id, version: row.version != null ? parseInt(row.version, 10) : undefined,
    category: row.category, description: row.description, frequency: row.frequency,
    last_completed: row.last_completed, next_due: row.next_due,
    completed_by: row.completed_by, contractor: row.contractor,
    items_checked: row.items_checked, items_passed: row.items_passed, items_failed: row.items_failed,
    certificate_ref: row.certificate_ref, certificate_expiry: row.certificate_expiry,
    notes: row.notes, updated_at: ts(row.updated_at),
  };
}

export async function findByHome(homeId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT ${COLS}, COUNT(*) OVER() AS _total FROM maintenance
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

  // Batch upsert — 14 per-row params (id + 12 fields + notes; homeId=$1, updated_at=NOW())
  const COLS_PER_ROW = 14;
  const CHUNK = Math.floor(65000 / COLS_PER_ROW);
  for (let i = 0; i < arr.length; i += CHUNK) {
    const chunk = arr.slice(i, i + CHUNK);
    const placeholders = [];
    const values = [];
    chunk.forEach((m, j) => {
      const b = j * COLS_PER_ROW + 2; // $1 is homeId
      placeholders.push(
        `($${b},$1,$${b+1},$${b+2},$${b+3},$${b+4},$${b+5},` +
        `$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},` +
        `$${b+11},$${b+12},$${b+13},NOW())`
      );
      values.push(
        m.id, m.category || null, m.description || null, m.frequency || null,
        m.last_completed || null, m.next_due || null, m.completed_by || null,
        m.contractor || null, m.items_checked ?? null, m.items_passed ?? null,
        m.items_failed ?? null, m.certificate_ref || null, m.certificate_expiry || null,
        m.notes || null,
      );
    });
    await conn.query(
      `INSERT INTO maintenance (
         id, home_id, category, description, frequency, last_completed, next_due,
         completed_by, contractor, items_checked, items_passed, items_failed,
         certificate_ref, certificate_expiry, notes, updated_at
       ) VALUES ${placeholders.join(',')}
       ON CONFLICT (home_id, id) DO UPDATE SET
         category           = EXCLUDED.category,
         description        = EXCLUDED.description,
         frequency          = EXCLUDED.frequency,
         last_completed     = EXCLUDED.last_completed,
         next_due           = EXCLUDED.next_due,
         completed_by       = EXCLUDED.completed_by,
         contractor         = EXCLUDED.contractor,
         items_checked      = EXCLUDED.items_checked,
         items_passed       = EXCLUDED.items_passed,
         items_failed       = EXCLUDED.items_failed,
         certificate_ref    = EXCLUDED.certificate_ref,
         certificate_expiry = EXCLUDED.certificate_expiry,
         notes              = EXCLUDED.notes,
         updated_at         = NOW(),
         deleted_at         = NULL`,
      [homeId, ...values]
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

export async function findById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM maintenance WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function upsert(homeId, data, client) {
  const conn = client || pool;
  const id = data.id || `mnt-${randomUUID()}`;
  const now = new Date().toISOString();
  const { rows } = await conn.query(
    `INSERT INTO maintenance (
       id, home_id, category, description, frequency, last_completed, next_due,
       completed_by, contractor, items_checked, items_passed, items_failed,
       certificate_ref, certificate_expiry, notes, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (home_id, id) DO UPDATE SET
       category=$3,description=$4,frequency=$5,last_completed=$6,next_due=$7,
       completed_by=$8,contractor=$9,items_checked=$10,items_passed=$11,items_failed=$12,
       certificate_ref=$13,certificate_expiry=$14,notes=$15,updated_at=$16,deleted_at=NULL
     RETURNING ${COLS}`,
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
  sql += ` RETURNING ${COLS}`;
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
