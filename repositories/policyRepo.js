import { pool } from '../db.js';

const ts = v => v instanceof Date ? v.toISOString() : v;

function shapeRow(row) {
  return {
    id: row.id, version: row.version != null ? parseInt(row.version, 10) : undefined,
    policy_name: row.policy_name, policy_ref: row.policy_ref, category: row.category,
    doc_version: row.doc_version,
    last_reviewed: row.last_reviewed, next_review_due: row.next_review_due,
    review_frequency_months: row.review_frequency_months, status: row.status,
    reviewed_by: row.reviewed_by, approved_by: row.approved_by,
    changes: typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes,
    notes: row.notes, updated_at: ts(row.updated_at),
  };
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

  // Batch upsert — 13 per-row params (id + 11 fields + notes; homeId=$1, updated_at=NOW())
  const COLS_PER_ROW = 13;
  const CHUNK = Math.floor(65000 / COLS_PER_ROW);
  for (let i = 0; i < arr.length; i += CHUNK) {
    const chunk = arr.slice(i, i + CHUNK);
    const placeholders = [];
    const values = [];
    chunk.forEach((p, j) => {
      const b = j * COLS_PER_ROW + 2; // $1 is homeId
      placeholders.push(
        `($${b},$1,$${b+1},$${b+2},$${b+3},$${b+4},` +
        `$${b+5},$${b+6},$${b+7},` +
        `$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},NOW())`
      );
      values.push(
        p.id, p.policy_name || null, p.policy_ref || null,
        p.category || null, p.doc_version || p.version || null,
        p.last_reviewed || null, p.next_review_due || null,
        p.review_frequency_months ?? null, p.status || null,
        p.reviewed_by || null, p.approved_by || null,
        JSON.stringify(p.changes || []), p.notes || null,
      );
    });
    await conn.query(
      `INSERT INTO policy_reviews (
         id, home_id, policy_name, policy_ref, category, doc_version,
         last_reviewed, next_review_due, review_frequency_months,
         status, reviewed_by, approved_by, changes, notes, updated_at
       ) VALUES ${placeholders.join(',')}
       ON CONFLICT (home_id, id) DO UPDATE SET
         policy_name              = EXCLUDED.policy_name,
         policy_ref               = EXCLUDED.policy_ref,
         category                 = EXCLUDED.category,
         doc_version              = EXCLUDED.doc_version,
         last_reviewed            = EXCLUDED.last_reviewed,
         next_review_due          = EXCLUDED.next_review_due,
         review_frequency_months  = EXCLUDED.review_frequency_months,
         status                   = EXCLUDED.status,
         reviewed_by              = EXCLUDED.reviewed_by,
         approved_by              = EXCLUDED.approved_by,
         changes                  = EXCLUDED.changes,
         notes                    = EXCLUDED.notes,
         updated_at               = NOW(),
         deleted_at               = NULL`,
      [homeId, ...values]
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
       id, home_id, policy_name, policy_ref, category, doc_version,
       last_reviewed, next_review_due, review_frequency_months,
       status, reviewed_by, approved_by, changes, notes, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (home_id, id) DO UPDATE SET
       policy_name=$3,policy_ref=$4,category=$5,doc_version=$6,
       last_reviewed=$7,next_review_due=$8,review_frequency_months=$9,
       status=$10,reviewed_by=$11,approved_by=$12,changes=$13,notes=$14,
       updated_at=$15,deleted_at=NULL
     RETURNING *`,
    [
      id, homeId, data.policy_name || null, data.policy_ref || null,
      data.category || null, data.doc_version || null,
      data.last_reviewed || null, data.next_review_due || null,
      data.review_frequency_months ?? null, data.status || null,
      data.reviewed_by || null, data.approved_by || null,
      JSON.stringify(data.changes || []), data.notes || null,
      now,
    ]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

// Column name whitelist for dynamic SQL
const ALLOWED_COLUMNS = new Set([
  'policy_name', 'policy_ref', 'category', 'doc_version',
  'last_reviewed', 'next_review_due', 'review_frequency_months',
  'status', 'reviewed_by', 'approved_by', 'changes', 'notes',
]);

export async function update(id, homeId, data, version) {
  const fields = Object.entries(data).filter(([k, v]) => v !== undefined && ALLOWED_COLUMNS.has(k));
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
