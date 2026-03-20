import { pool } from '../db.js';

const COMPLAINT_COLS = 'id, home_id, version, date, raised_by, raised_by_name, category, title, description, acknowledged_date, response_deadline, status, investigator, investigation_notes, resolution, resolution_date, outcome_shared, root_cause, improvements, lessons_learned, reported_by, reported_at, updated_at, created_at, deleted_at';

const ts = v => v instanceof Date ? v.toISOString() : v;

function shapeRow(row) {
  return {
    id: row.id, version: row.version != null ? parseInt(row.version, 10) : undefined,
    date: row.date, raised_by: row.raised_by, raised_by_name: row.raised_by_name,
    category: row.category, title: row.title, description: row.description,
    acknowledged_date: row.acknowledged_date, response_deadline: row.response_deadline, status: row.status,
    investigator: row.investigator, investigation_notes: row.investigation_notes,
    resolution: row.resolution, resolution_date: row.resolution_date, outcome_shared: row.outcome_shared,
    root_cause: row.root_cause, improvements: row.improvements, lessons_learned: row.lessons_learned,
    reported_by: row.reported_by, reported_at: ts(row.reported_at), updated_at: ts(row.updated_at),
  };
}

function paginate(rows, shapeFn) {
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shapeFn(rest); }), total };
}

export async function findByHome(homeId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT ${COMPLAINT_COLS}, COUNT(*) OVER() AS _total FROM complaints
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY date DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 500), Math.max(offset, 0)]
  );
  return paginate(rows, shapeRow);
}

export async function sync(homeId, arr, client) {
  const conn = client || pool;
  if (!arr) return;
  const incomingIds = arr.map(c => c.id);

  // Batch upsert — 20 per-row params (id + 18 fields + reported_at; homeId=$1, updated_at=NOW())
  const COLS_PER_ROW = 20;
  const CHUNK = Math.floor(65000 / COLS_PER_ROW);
  for (let i = 0; i < arr.length; i += CHUNK) {
    const chunk = arr.slice(i, i + CHUNK);
    const placeholders = [];
    const values = [];
    chunk.forEach((c, j) => {
      const b = j * COLS_PER_ROW + 2; // $1 is homeId
      placeholders.push(
        `($${b},$1,$${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},` +
        `$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},` +
        `$${b+12},$${b+13},$${b+14},$${b+15},$${b+16},` +
        `$${b+17},$${b+18},$${b+19},NOW())`
      );
      values.push(
        c.id, c.date || null, c.raised_by || null, c.raised_by_name || null,
        c.category || null, c.title || null, c.description || null,
        c.acknowledged_date || null, c.response_deadline || null, c.status || null,
        c.investigator || null, c.investigation_notes || null, c.resolution || null,
        c.resolution_date || null, c.outcome_shared ?? null, c.root_cause || null,
        c.improvements || null, c.lessons_learned || null,
        c.reported_by || null, c.reported_at || null,
      );
    });
    await conn.query(
      `INSERT INTO complaints (
         id, home_id, date, raised_by, raised_by_name, category, title, description,
         acknowledged_date, response_deadline, status, investigator, investigation_notes,
         resolution, resolution_date, outcome_shared, root_cause, improvements,
         lessons_learned, reported_by, reported_at, updated_at
       ) VALUES ${placeholders.join(',')}
       ON CONFLICT (home_id, id) DO UPDATE SET
         date                = EXCLUDED.date,
         raised_by           = EXCLUDED.raised_by,
         raised_by_name      = EXCLUDED.raised_by_name,
         category            = EXCLUDED.category,
         title               = EXCLUDED.title,
         description         = EXCLUDED.description,
         acknowledged_date   = EXCLUDED.acknowledged_date,
         response_deadline   = EXCLUDED.response_deadline,
         status              = EXCLUDED.status,
         investigator        = EXCLUDED.investigator,
         investigation_notes = EXCLUDED.investigation_notes,
         resolution          = EXCLUDED.resolution,
         resolution_date     = EXCLUDED.resolution_date,
         outcome_shared      = EXCLUDED.outcome_shared,
         root_cause          = EXCLUDED.root_cause,
         improvements        = EXCLUDED.improvements,
         lessons_learned     = EXCLUDED.lessons_learned,
         reported_by         = EXCLUDED.reported_by,
         reported_at         = EXCLUDED.reported_at,
         updated_at          = NOW(),
         deleted_at          = NULL`,
      [homeId, ...values]
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
    `SELECT ${COMPLAINT_COLS} FROM complaints WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
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
     RETURNING ${COMPLAINT_COLS}`,
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
  // Auto-resolve resident_id for resident-related complaints
  if (rows[0] && data.raised_by_name && !data.resident_id) {
    const { rows: fr } = await pool.query(
      `SELECT id FROM finance_residents WHERE home_id = $1 AND resident_name = $2 AND deleted_at IS NULL`,
      [homeId, data.raised_by_name]
    );
    if (fr.length === 1) {
      await pool.query(`UPDATE complaints SET resident_id = $1 WHERE home_id = $2 AND id = $3`, [fr[0].id, homeId, id]);
    }
  }
  return rows[0] ? shapeRow(rows[0]) : null;
}

// Column name whitelist for dynamic SQL
const ALLOWED_COLUMNS = new Set([
  'date', 'raised_by', 'raised_by_name', 'resident_id', 'category', 'title', 'description',
  'acknowledged_date', 'response_deadline', 'status', 'investigator',
  'investigation_notes', 'resolution', 'resolution_date', 'outcome_shared',
  'root_cause', 'improvements', 'lessons_learned',
]);

export async function update(id, homeId, data, version) {
  const fields = Object.entries(data).filter(
    ([k, v]) => v !== undefined && ALLOWED_COLUMNS.has(k)
  );
  if (fields.length === 0) return null;

  const setClause = fields.map(([k], i) => `"${k}" = $${i + 3}`).join(', ');
  const values = fields.map(([_, v]) => v);
  const params = [id, homeId, ...values];
  let sql = `UPDATE complaints SET ${setClause}, version = version + 1, updated_at = NOW()
     WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ` RETURNING ${COMPLAINT_COLS}`;
  const { rows, rowCount } = await pool.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function softDelete(id, homeId) {
  const { rowCount } = await pool.query(
    'UPDATE complaints SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rowCount > 0;
}
