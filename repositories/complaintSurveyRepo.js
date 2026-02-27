import { pool } from '../db.js';

function shapeRow(row) {
  const shaped = { ...row };
  if (shaped.date instanceof Date) shaped.date = shaped.date.toISOString().slice(0, 10);
  if (shaped.reported_at instanceof Date) shaped.reported_at = shaped.reported_at.toISOString();
  if (shaped.overall_satisfaction != null) shaped.overall_satisfaction = parseFloat(shaped.overall_satisfaction);
  delete shaped.home_id;
  delete shaped.created_at;
  return shaped;
}

export async function findByHome(homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM complaint_surveys WHERE home_id = $1 AND deleted_at IS NULL ORDER BY date DESC NULLS LAST',
    [homeId]
  );
  return rows.map(shapeRow);
}

export async function sync(homeId, arr, client) {
  const conn = client || pool;
  if (!arr) return;
  const incomingIds = arr.map(s => s.id);

  for (const s of arr) {
    await conn.query(
      `INSERT INTO complaint_surveys (
         id, home_id, type, date, title, total_sent, responses,
         overall_satisfaction, area_scores, key_feedback, actions, conducted_by, reported_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (home_id, id) DO UPDATE SET
         type=$3,date=$4,title=$5,total_sent=$6,responses=$7,
         overall_satisfaction=$8,area_scores=$9,key_feedback=$10,
         actions=$11,conducted_by=$12,reported_at=$13`,
      [
        s.id, homeId, s.type || null, s.date || null, s.title || null,
        s.total_sent || null, s.responses || null, s.overall_satisfaction || null,
        JSON.stringify(s.area_scores || {}), s.key_feedback || null,
        s.actions || null, s.conducted_by || null, s.reported_at || null,
      ]
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
    'SELECT * FROM complaint_surveys WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
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
     RETURNING *`,
    [
      id, homeId, data.type || null, data.date || null, data.title || null,
      data.total_sent || null, data.responses || null, data.overall_satisfaction || null,
      JSON.stringify(data.area_scores || {}), data.key_feedback || null,
      data.actions || null, data.conducted_by || null, data.reported_at || now,
    ]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function softDelete(id, homeId) {
  const { rowCount } = await pool.query(
    'UPDATE complaint_surveys SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rowCount > 0;
}
