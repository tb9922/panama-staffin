import { pool } from '../db.js';

const ts = v => v instanceof Date ? v.toISOString() : v;

function shapeRow(row) {
  return {
    id: row.id, version: row.version != null ? parseInt(row.version, 10) : undefined,
    date_raised: row.date_raised, raised_by_role: row.raised_by_role, anonymous: row.anonymous,
    category: row.category, description: row.description, severity: row.severity,
    status: row.status, acknowledgement_date: row.acknowledgement_date,
    investigator: row.investigator, investigation_start_date: row.investigation_start_date, findings: row.findings,
    outcome: row.outcome, outcome_details: row.outcome_details,
    reporter_protected: row.reporter_protected, protection_details: row.protection_details,
    follow_up_date: row.follow_up_date, follow_up_completed: row.follow_up_completed,
    resolution_date: row.resolution_date, lessons_learned: row.lessons_learned,
    reported_at: ts(row.reported_at), updated_at: ts(row.updated_at),
  };
}

export async function findByHome(homeId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT *, COUNT(*) OVER() AS _total FROM whistleblowing_concerns
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY date_raised DESC NULLS LAST LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 500), Math.max(offset, 0)]
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shapeRow(rest); }), total };
}

export async function sync(homeId, arr, client) {
  const conn = client || pool;
  if (!arr) return;
  const incomingIds = arr.map(c => c.id);

  const COLS_PER_ROW = 22;
  const CHUNK = Math.floor(65000 / COLS_PER_ROW);
  for (let i = 0; i < arr.length; i += CHUNK) {
    const chunk = arr.slice(i, i + CHUNK);
    const placeholders = [];
    const values = [];
    chunk.forEach((c, j) => {
      const b = j * COLS_PER_ROW + 2;
      placeholders.push(
        `($${b},$1,$${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},` +
        `$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},` +
        `$${b+16},$${b+17},$${b+18},$${b+19},$${b+20},$${b+21})`
      );
      values.push(
        c.id, c.date_raised || null, c.raised_by_role || null,
        c.anonymous ?? false,
        c.category || null, c.description || null, c.severity || null,
        c.status || null,
        c.acknowledgement_date || null, c.investigator || null,
        c.investigation_start_date || null,
        c.findings || null, c.outcome || null, c.outcome_details || null,
        c.reporter_protected ?? false, c.protection_details || null,
        c.follow_up_date || null, c.follow_up_completed ?? false,
        c.resolution_date || null,
        c.lessons_learned || null, c.reported_at || null, c.updated_at || null,
      );
    });
    await conn.query(
      `INSERT INTO whistleblowing_concerns (
         id, home_id, date_raised, raised_by_role, anonymous,
         category, description, severity, status,
         acknowledgement_date, investigator, investigation_start_date,
         findings, outcome, outcome_details,
         reporter_protected, protection_details,
         follow_up_date, follow_up_completed, resolution_date,
         lessons_learned, reported_at, updated_at
       ) VALUES ${placeholders.join(',')}
       ON CONFLICT (home_id, id) DO UPDATE SET
         date_raised=EXCLUDED.date_raised,raised_by_role=EXCLUDED.raised_by_role,anonymous=EXCLUDED.anonymous,
         category=EXCLUDED.category,description=EXCLUDED.description,severity=EXCLUDED.severity,status=EXCLUDED.status,
         acknowledgement_date=EXCLUDED.acknowledgement_date,investigator=EXCLUDED.investigator,investigation_start_date=EXCLUDED.investigation_start_date,
         findings=EXCLUDED.findings,outcome=EXCLUDED.outcome,outcome_details=EXCLUDED.outcome_details,
         reporter_protected=EXCLUDED.reporter_protected,protection_details=EXCLUDED.protection_details,
         follow_up_date=EXCLUDED.follow_up_date,follow_up_completed=EXCLUDED.follow_up_completed,resolution_date=EXCLUDED.resolution_date,
         lessons_learned=EXCLUDED.lessons_learned,reported_at=EXCLUDED.reported_at,updated_at=EXCLUDED.updated_at,deleted_at=NULL`,
      [homeId, ...values]
    );
  }

  if (incomingIds.length > 0) {
    await conn.query(
      `UPDATE whistleblowing_concerns SET deleted_at = NOW() WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL`,
      [homeId, incomingIds]
    );
  } else {
    await conn.query(`UPDATE whistleblowing_concerns SET deleted_at = NOW() WHERE home_id = $1 AND deleted_at IS NULL`, [homeId]);
  }
}

// ── Individual CRUD (Mode 2 endpoints) ────────────────────────────────────────

import { randomUUID } from 'crypto';

export async function findById(id, homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM whistleblowing_concerns WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function upsert(homeId, data) {
  const id = data.id || `wbl-${randomUUID()}`;
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO whistleblowing_concerns (
       id, home_id, date_raised, raised_by_role, anonymous,
       category, description, severity, status,
       acknowledgement_date, investigator, investigation_start_date,
       findings, outcome, outcome_details,
       reporter_protected, protection_details,
       follow_up_date, follow_up_completed, resolution_date,
       lessons_learned, reported_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     ON CONFLICT (home_id, id) DO UPDATE SET
       date_raised=$3,raised_by_role=$4,anonymous=$5,
       category=$6,description=$7,severity=$8,status=$9,
       acknowledgement_date=$10,investigator=$11,investigation_start_date=$12,
       findings=$13,outcome=$14,outcome_details=$15,
       reporter_protected=$16,protection_details=$17,
       follow_up_date=$18,follow_up_completed=$19,resolution_date=$20,
       lessons_learned=$21,reported_at=$22,updated_at=$23,deleted_at=NULL
     RETURNING *`,
    [
      id, homeId, data.date_raised || null, data.raised_by_role || null,
      data.anonymous ?? false,
      data.category || null, data.description || null, data.severity || null,
      data.status || null,
      data.acknowledgement_date || null, data.investigator || null,
      data.investigation_start_date || null,
      data.findings || null, data.outcome || null, data.outcome_details || null,
      data.reporter_protected ?? false, data.protection_details || null,
      data.follow_up_date || null, data.follow_up_completed ?? false,
      data.resolution_date || null,
      data.lessons_learned || null, data.reported_at || now, now,
    ]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

// Column name whitelist for dynamic SQL
const ALLOWED_COLUMNS = new Set([
  'date_raised', 'raised_by_role', 'anonymous',
  'category', 'description', 'severity', 'status',
  'acknowledgement_date', 'investigator', 'investigation_start_date',
  'findings', 'outcome', 'outcome_details',
  'reporter_protected', 'protection_details',
  'follow_up_date', 'follow_up_completed', 'resolution_date',
  'lessons_learned',
]);

export async function update(id, homeId, data, version) {
  const fields = Object.entries(data).filter(([k, v]) => v !== undefined && ALLOWED_COLUMNS.has(k));
  if (fields.length === 0) return findById(id, homeId);
  const params = [id, homeId, ...fields.map(([_, v]) => v)];
  const setClause = fields.map(([k], i) => `"${k}" = $${i + 3}`).join(', ');
  let sql = `UPDATE whistleblowing_concerns SET ${setClause}, updated_at = NOW(), version = version + 1 WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ' RETURNING *';
  const { rows, rowCount } = await pool.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function softDelete(id, homeId) {
  const { rowCount } = await pool.query(
    'UPDATE whistleblowing_concerns SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rowCount > 0;
}
