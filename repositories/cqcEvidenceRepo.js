import { pool } from '../db.js';

function shapeRow(row) {
  const shaped = { ...row };
  for (const col of ['date_from', 'date_to', 'added_at']) {
    if (shaped[col] instanceof Date) shaped[col] = shaped[col].toISOString().slice(0, 10);
  }
  delete shaped.home_id;
  delete shaped.created_at;
  delete shaped.deleted_at;
  return shaped;
}

export async function findByHome(homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM cqc_evidence WHERE home_id = $1 AND deleted_at IS NULL ORDER BY added_at DESC NULLS LAST',
    [homeId]
  );
  return rows.map(shapeRow);
}

export async function sync(homeId, arr, client) {
  const conn = client || pool;
  if (!arr) return;
  const incomingIds = arr.map(e => e.id);

  for (const e of arr) {
    await conn.query(
      `INSERT INTO cqc_evidence (
         id, home_id, quality_statement, type, title, description,
         date_from, date_to, added_by, added_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (home_id, id) DO UPDATE SET
         quality_statement=$3,type=$4,title=$5,description=$6,
         date_from=$7,date_to=$8,added_by=$9,added_at=$10,deleted_at=NULL`,
      [
        e.id, homeId, e.quality_statement || null, e.type || null,
        e.title || null, e.description || null,
        e.date_from || null, e.date_to || null,
        e.added_by || null, e.added_at || null,
      ]
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
    'SELECT * FROM cqc_evidence WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
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

export async function update(id, homeId, data) {
  const fields = Object.entries(data).filter(([_, v]) => v !== undefined);
  if (fields.length === 0) return findById(id, homeId);
  const setClause = fields.map(([k], i) => `"${k}" = $${i + 3}`).join(', ');
  const values = fields.map(([_, v]) => v);
  const { rows } = await pool.query(
    `UPDATE cqc_evidence SET ${setClause} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING *`,
    [id, homeId, ...values]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function softDelete(id, homeId) {
  const { rowCount } = await pool.query(
    'UPDATE cqc_evidence SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rowCount > 0;
}
