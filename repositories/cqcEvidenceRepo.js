import { pool } from '../db.js';

const EVIDENCE_COLS = 'id, home_id, version, quality_statement, type, title, description, date_from, date_to, added_by, added_at, created_at, deleted_at';

function shapeRow(row) {
  return {
    id: row.id, version: row.version != null ? parseInt(row.version, 10) : undefined,
    quality_statement: row.quality_statement, type: row.type, title: row.title,
    description: row.description, date_from: row.date_from, date_to: row.date_to,
    added_by: row.added_by, added_at: row.added_at,
  };
}

function paginate(rows, shapeFn) {
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shapeFn(rest); }), total };
}

export async function findByHome(homeId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT ${EVIDENCE_COLS}, COUNT(*) OVER() AS _total FROM cqc_evidence
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY added_at DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 500), Math.max(offset, 0)]
  );
  return paginate(rows, shapeRow);
}

export async function sync(homeId, arr, client) {
  const conn = client || pool;
  if (!arr) return;
  const incomingIds = arr.map(e => e.id);

  const COLS_PER_ROW = 9;
  const CHUNK = Math.floor(65000 / COLS_PER_ROW);
  for (let i = 0; i < arr.length; i += CHUNK) {
    const chunk = arr.slice(i, i + CHUNK);
    const placeholders = [];
    const values = [];
    chunk.forEach((e, j) => {
      const b = j * COLS_PER_ROW + 2;
      placeholders.push(
        `($${b},$1,$${b+1},$${b+2},$${b+3},$${b+4},` +
        `$${b+5},$${b+6},$${b+7},$${b+8})`
      );
      values.push(
        e.id, e.quality_statement || null, e.type || null,
        e.title || null, e.description || null,
        e.date_from || null, e.date_to || null,
        e.added_by || null, e.added_at || null,
      );
    });
    await conn.query(
      `INSERT INTO cqc_evidence (
         id, home_id, quality_statement, type, title, description,
         date_from, date_to, added_by, added_at
       ) VALUES ${placeholders.join(',')}
       ON CONFLICT (home_id, id) DO UPDATE SET
         quality_statement=EXCLUDED.quality_statement,type=EXCLUDED.type,title=EXCLUDED.title,
         description=EXCLUDED.description,date_from=EXCLUDED.date_from,date_to=EXCLUDED.date_to,
         added_by=EXCLUDED.added_by,added_at=EXCLUDED.added_at,deleted_at=NULL`,
      [homeId, ...values]
    );
  }

  if (incomingIds.length > 0) {
    await conn.query(
      `UPDATE cqc_evidence SET deleted_at = NOW() WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL`,
      [homeId, incomingIds]
    );
  } else {
    await conn.query(`UPDATE cqc_evidence SET deleted_at = NOW() WHERE home_id = $1 AND deleted_at IS NULL`, [homeId]);
  }
}

// ── Individual CRUD (Mode 2 endpoints) ────────────────────────────────────────

import { randomUUID } from 'crypto';

export async function findById(id, homeId) {
  const { rows } = await pool.query(
    `SELECT ${EVIDENCE_COLS} FROM cqc_evidence WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function upsert(homeId, data) {
  const id = data.id || `cqc-${randomUUID()}`;
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO cqc_evidence (
       id, home_id, quality_statement, type, title, description,
       date_from, date_to, added_by, added_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (home_id, id) DO UPDATE SET
       quality_statement=$3,type=$4,title=$5,description=$6,
       date_from=$7,date_to=$8,added_by=$9,added_at=$10,deleted_at=NULL
     RETURNING *`,
    [
      id, homeId, data.quality_statement || null, data.type || null,
      data.title || null, data.description || null,
      data.date_from || null, data.date_to || null,
      data.added_by || null, data.added_at || now,
    ]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

// Column name whitelist for dynamic SQL
const ALLOWED_COLUMNS = new Set([
  'quality_statement', 'type', 'title', 'description',
  'date_from', 'date_to', 'added_by',
]);

export async function update(id, homeId, data, version) {
  const fields = Object.entries(data).filter(([k, v]) => v !== undefined && ALLOWED_COLUMNS.has(k));
  if (fields.length === 0) return findById(id, homeId);
  const setClause = fields.map(([k], i) => `"${k}" = $${i + 3}`).join(', ');
  const values = fields.map(([_, v]) => v);
  const params = [id, homeId, ...values];
  let sql = `UPDATE cqc_evidence SET ${setClause}, version = version + 1 WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ' RETURNING *';
  const { rows, rowCount } = await pool.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function softDelete(id, homeId) {
  const { rowCount } = await pool.query(
    'UPDATE cqc_evidence SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rowCount > 0;
}
