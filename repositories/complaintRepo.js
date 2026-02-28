import { pool } from '../db.js';

function shapeRow(row) {
  const shaped = { ...row };
  for (const col of ['date', 'acknowledged_date', 'response_deadline', 'resolution_date']) {
    if (shaped[col] instanceof Date) shaped[col] = shaped[col].toISOString().slice(0, 10);
  }
  for (const col of ['reported_at', 'updated_at']) {
    if (shaped[col] instanceof Date) shaped[col] = shaped[col].toISOString();
  }
  delete shaped.home_id;
  delete shaped.created_at;
  delete shaped.deleted_at;
  return shaped;
}

export async function findByHome(homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM complaints WHERE home_id = $1 AND deleted_at IS NULL ORDER BY date DESC NULLS LAST',
    [homeId]
  );
  return rows.map(shapeRow);
}

export async function sync(homeId, arr, client) {
  const conn = client || pool;
  if (!arr) return;
  const incomingIds = arr.map(c => c.id);

  for (const c of arr) {
    await conn.query(
      `INSERT INTO complaints (
         id, home_id, date, raised_by, raised_by_name, category, title, description,
         acknowledged_date, response_deadline, status, investigator, investigation_notes,
         resolution, resolution_date, outcome_shared, root_cause, improvements,
         lessons_learned, reported_by, reported_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (home_id, id) DO UPDATE SET
         date=$3,raised_by=$4,raised_by_name=$5,category=$6,title=$7,description=$8,
         acknowledged_date=$9,response_deadline=$10,status=$11,investigator=$12,
         investigation_notes=$13,resolution=$14,resolution_date=$15,outcome_shared=$16,
         root_cause=$17,improvements=$18,lessons_learned=$19,reported_by=$20,
         reported_at=$21,updated_at=$22,deleted_at=NULL`,
      [
        c.id, homeId, c.date || null, c.raised_by || null, c.raised_by_name || null,
        c.category || null, c.title || null, c.description || null,
        c.acknowledged_date || null, c.response_deadline || null, c.status || null,
        c.investigator || null, c.investigation_notes || null, c.resolution || null,
        c.resolution_date || null, c.outcome_shared ?? null, c.root_cause || null,
        c.improvements || null, c.lessons_learned || null,
        c.reported_by || null, c.reported_at || null, c.updated_at || null,
      ]
    );
  }

  if (incomingIds.length > 0) {
    await conn.query(
      `UPDATE complaints SET deleted_at = NOW() WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL`,
      [homeId, incomingIds]
    );
  } else {
    await conn.query(`UPDATE complaints SET deleted_at = NOW() WHERE home_id = $1 AND deleted_at IS NULL`, [homeId]);
  }
}

// ── Individual CRUD (Mode 2 endpoints) ────────────────────────────────────────

import { randomUUID } from 'crypto';

export async function findById(id, homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM complaints WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function upsert(homeId, data) {
  const id = data.id || `cmp-${randomUUID()}`;
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO complaints (
       id, home_id, date, raised_by, raised_by_name, category, title, description,
       acknowledged_date, response_deadline, status, investigator, investigation_notes,
       resolution, resolution_date, outcome_shared, root_cause, improvements,
       lessons_learned, reported_by, reported_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     ON CONFLICT (home_id, id) DO UPDATE SET
       date=$3,raised_by=$4,raised_by_name=$5,category=$6,title=$7,description=$8,
       acknowledged_date=$9,response_deadline=$10,status=$11,investigator=$12,
       investigation_notes=$13,resolution=$14,resolution_date=$15,outcome_shared=$16,
       root_cause=$17,improvements=$18,lessons_learned=$19,reported_by=$20,
       reported_at=$21,updated_at=$22,deleted_at=NULL
     RETURNING *`,
    [
      id, homeId, data.date || null, data.raised_by || null, data.raised_by_name || null,
      data.category || null, data.title || null, data.description || null,
      data.acknowledged_date || null, data.response_deadline || null, data.status || null,
      data.investigator || null, data.investigation_notes || null, data.resolution || null,
      data.resolution_date || null, data.outcome_shared ?? null, data.root_cause || null,
      data.improvements || null, data.lessons_learned || null,
      data.reported_by || null, data.reported_at || now, now,
    ]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

// Column name whitelist for dynamic SQL
const ALLOWED_COLUMNS = new Set([
  'date', 'raised_by', 'raised_by_name', 'category', 'title', 'description',
  'acknowledged_date', 'response_deadline', 'status', 'investigator',
  'investigation_notes', 'resolution', 'resolution_date', 'outcome_shared',
  'root_cause', 'improvements', 'lessons_learned',
]);

export async function update(id, homeId, data) {
  const fields = Object.entries(data).filter(
    ([k, v]) => v !== undefined && ALLOWED_COLUMNS.has(k)
  );
  if (fields.length === 0) return null;

  const setClause = fields.map(([k], i) => `${k} = $${i + 3}`).join(', ');
  const values = fields.map(([_, v]) => v);
  const { rows } = await pool.query(
    `UPDATE complaints SET ${setClause}, updated_at = NOW()
     WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [id, homeId, ...values]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function softDelete(id, homeId) {
  const { rowCount } = await pool.query(
    'UPDATE complaints SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rowCount > 0;
}
