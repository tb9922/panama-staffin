import { pool } from '../db.js';
import { paginateResult } from '../lib/pagination.js';
import { toIsoOrNull } from '../lib/serverTimestamps.js';

const SURVEY_COLS = 'id, home_id, version, type, date, title, total_sent, responses, overall_satisfaction, area_scores, key_feedback, actions, conducted_by, reported_at, created_at, deleted_at';

const pf = v => v != null ? parseFloat(v) : v;

function shapeRow(row) {
  return {
    id: row.id, version: row.version != null ? parseInt(row.version, 10) : undefined,
    type: row.type, date: row.date, title: row.title,
    total_sent: row.total_sent, responses: row.responses,
    overall_satisfaction: pf(row.overall_satisfaction), area_scores: row.area_scores,
    key_feedback: row.key_feedback, actions: row.actions,
    conducted_by: row.conducted_by, reported_at: toIsoOrNull(row.reported_at),
  };
}

export async function findByHome(homeId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT ${SURVEY_COLS}, COUNT(*) OVER() AS _total FROM complaint_surveys
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY date DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 500), Math.max(offset, 0)]
  );
  return paginateResult(rows, shapeRow);
}

export async function sync(homeId, arr, client) {
  const conn = client || pool;
  if (!arr) return;
  const incomingIds = arr.map(s => s.id);

  // Batch upsert — 12 per-row params, homeId shared as $1
  const COLS_PER_ROW = 12;
  const CHUNK = Math.floor(65000 / COLS_PER_ROW);
  for (let i = 0; i < arr.length; i += CHUNK) {
    const chunk = arr.slice(i, i + CHUNK);
    const placeholders = [];
    const values = [];
    chunk.forEach((s, j) => {
      const b = j * COLS_PER_ROW + 2; // $1 is homeId
      placeholders.push(
        `($${b},$1,$${b+1},$${b+2},$${b+3},$${b+4},$${b+5},` +
        `$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11})`
      );
      values.push(
        s.id, s.type || null, s.date || null, s.title || null,
        s.total_sent ?? null, s.responses ?? null, s.overall_satisfaction ?? null,
        JSON.stringify(s.area_scores || {}), s.key_feedback || null,
        s.actions || null, s.conducted_by || null, s.reported_at || null,
      );
    });
    await conn.query(
      `INSERT INTO complaint_surveys (
         id, home_id, type, date, title, total_sent, responses,
         overall_satisfaction, area_scores, key_feedback, actions, conducted_by, reported_at
       ) VALUES ${placeholders.join(',')}
       ON CONFLICT (home_id, id) DO UPDATE SET
         type                 = EXCLUDED.type,
         date                 = EXCLUDED.date,
         title                = EXCLUDED.title,
         total_sent           = EXCLUDED.total_sent,
         responses            = EXCLUDED.responses,
         overall_satisfaction = EXCLUDED.overall_satisfaction,
         area_scores          = EXCLUDED.area_scores,
         key_feedback         = EXCLUDED.key_feedback,
         actions              = EXCLUDED.actions,
         conducted_by         = EXCLUDED.conducted_by,
         reported_at          = EXCLUDED.reported_at`,
      [homeId, ...values]
    );
  }

  // Soft-delete surveys removed from the frontend (CQC Reg 16 evidence — must retain)
  if (incomingIds.length === 0) {
    // Empty payload guard: skip — never wipe all surveys on empty incoming list
    return;
  }
  await conn.query(
    `UPDATE complaint_surveys SET deleted_at = NOW()
     WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL`,
    [homeId, incomingIds]
  );
}

// ── Individual CRUD (Mode 2 endpoints) ────────────────────────────────────────

import { randomUUID } from 'crypto';

export async function findById(id, homeId) {
  const { rows } = await pool.query(
    `SELECT ${SURVEY_COLS} FROM complaint_surveys WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function upsert(homeId, data) {
  const id = data.id || `srv-${randomUUID()}`;
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO complaint_surveys (
       id, home_id, type, date, title, total_sent, responses,
       overall_satisfaction, area_scores, key_feedback, actions, conducted_by, reported_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (home_id, id) DO UPDATE SET
       type=$3,date=$4,title=$5,total_sent=$6,responses=$7,
       overall_satisfaction=$8,area_scores=$9,key_feedback=$10,
       actions=$11,conducted_by=$12,reported_at=$13
     RETURNING ${SURVEY_COLS}`,
    [
      id, homeId, data.type || null, data.date || null, data.title || null,
      data.total_sent ?? null, data.responses ?? null, data.overall_satisfaction ?? null,
      JSON.stringify(data.area_scores || {}), data.key_feedback || null,
      data.actions || null, data.conducted_by || null, data.reported_at || now,
    ]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

// Column name whitelist for dynamic SQL
const ALLOWED_COLUMNS = new Set([
  'type', 'date', 'title', 'total_sent', 'responses',
  'overall_satisfaction', 'area_scores', 'key_feedback', 'actions', 'conducted_by',
]);

export async function update(id, homeId, data, version) {
  const fields = Object.entries(data).filter(
    ([k, v]) => v !== undefined && ALLOWED_COLUMNS.has(k)
  );
  if (fields.length === 0) return null;

  // JSON-encode area_scores if present
  const values = fields.map(([k, v]) =>
    k === 'area_scores' ? JSON.stringify(v ?? {}) : v
  );

  const setClause = fields.map(([k], i) => `"${k}" = $${i + 3}`).join(', ');
  const params = [id, homeId, ...values];
  let sql = `UPDATE complaint_surveys SET ${setClause}, version = version + 1, updated_at = NOW()
     WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ` RETURNING ${SURVEY_COLS}`;
  const { rows, rowCount } = await pool.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function softDelete(id, homeId) {
  const { rowCount } = await pool.query(
    'UPDATE complaint_surveys SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rowCount > 0;
}
