import { pool } from '../db.js';

function shapeDolsRow(row) {
  const shaped = { ...row };
  for (const col of [
    'dob', 'application_date', 'authorisation_date', 'expiry_date',
    'reviewed_date', 'next_review_date',
  ]) {
    if (shaped[col] instanceof Date) shaped[col] = shaped[col].toISOString().slice(0, 10);
  }
  if (shaped.updated_at instanceof Date) shaped.updated_at = shaped.updated_at.toISOString();
  if (typeof shaped.restrictions === 'string') shaped.restrictions = JSON.parse(shaped.restrictions);
  delete shaped.home_id;
  delete shaped.created_at;
  delete shaped.deleted_at;
  return shaped;
}

function shapeMcaRow(row) {
  const shaped = { ...row };
  for (const col of ['assessment_date', 'next_review_date']) {
    if (shaped[col] instanceof Date) shaped[col] = shaped[col].toISOString().slice(0, 10);
  }
  if (shaped.updated_at instanceof Date) shaped.updated_at = shaped.updated_at.toISOString();
  delete shaped.home_id;
  delete shaped.created_at;
  delete shaped.deleted_at;
  return shaped;
}

function paginate(rows, shapeFn) {
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shapeFn(rest); }), total };
}

export async function findByHome(homeId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT *, COUNT(*) OVER() AS _total FROM dols
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY application_date DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 500), Math.max(offset, 0)]
  );
  return paginate(rows, shapeDolsRow);
}

export async function syncDols(homeId, arr, client) {
  const conn = client || pool;
  if (!arr) return;
  const incomingIds = arr.map(d => d.id);

  for (const d of arr) {
    await conn.query(
      `INSERT INTO dols (
         id, home_id, resident_name, dob, room_number,
         application_type, application_date, authorised,
         authorisation_date, expiry_date, authorisation_number, authorising_authority,
         restrictions, reviewed_date, review_status, next_review_date,
         notes, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (home_id, id) DO UPDATE SET
         resident_name=$3,dob=$4,room_number=$5,
         application_type=$6,application_date=$7,authorised=$8,
         authorisation_date=$9,expiry_date=$10,authorisation_number=$11,
         authorising_authority=$12,restrictions=$13,reviewed_date=$14,
         review_status=$15,next_review_date=$16,notes=$17,updated_at=$18,deleted_at=NULL`,
      [
        d.id, homeId, d.resident_name || null, d.dob || null, d.room_number || null,
        d.application_type || null, d.application_date || null,
        d.authorised ?? false,
        d.authorisation_date || null, d.expiry_date || null,
        d.authorisation_number || null, d.authorising_authority || null,
        JSON.stringify(d.restrictions || []),
        d.reviewed_date || null, d.review_status || null, d.next_review_date || null,
        d.notes || null, d.updated_at || null,
      ]
    );
  }

  if (incomingIds.length > 0) {
    await conn.query(
      `UPDATE dols SET deleted_at = NOW() WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL`,
      [homeId, incomingIds]
    );
  } else {
    await conn.query(`UPDATE dols SET deleted_at = NOW() WHERE home_id = $1 AND deleted_at IS NULL`, [homeId]);
  }
}

// ── Individual CRUD for DoLS (Mode 2 endpoints) ───────────────────────────────

import { randomUUID } from 'crypto';

export async function findDolsById(id, homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM dols WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rows[0] ? shapeDolsRow(rows[0]) : null;
}

export async function upsertDols(homeId, data) {
  const id = data.id || `dls-${randomUUID()}`;
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO dols (
       id, home_id, resident_name, dob, room_number,
       application_type, application_date, authorised,
       authorisation_date, expiry_date, authorisation_number, authorising_authority,
       restrictions, reviewed_date, review_status, next_review_date,
       notes, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (home_id, id) DO UPDATE SET
       resident_name=$3,dob=$4,room_number=$5,
       application_type=$6,application_date=$7,authorised=$8,
       authorisation_date=$9,expiry_date=$10,authorisation_number=$11,
       authorising_authority=$12,restrictions=$13,reviewed_date=$14,
       review_status=$15,next_review_date=$16,notes=$17,updated_at=$18,deleted_at=NULL
     RETURNING *`,
    [
      id, homeId, data.resident_name || null, data.dob || null, data.room_number || null,
      data.application_type || null, data.application_date || null,
      data.authorised ?? false,
      data.authorisation_date || null, data.expiry_date || null,
      data.authorisation_number || null, data.authorising_authority || null,
      JSON.stringify(data.restrictions || []),
      data.reviewed_date || null, data.review_status || null, data.next_review_date || null,
      data.notes || null, now,
    ]
  );
  return rows[0] ? shapeDolsRow(rows[0]) : null;
}

// Column name whitelist for dynamic SQL — DoLS
const ALLOWED_DOLS_COLUMNS = new Set([
  'resident_name', 'dob', 'room_number',
  'application_type', 'application_date', 'authorised',
  'authorisation_date', 'expiry_date', 'authorisation_number', 'authorising_authority',
  'restrictions', 'reviewed_date', 'review_status', 'next_review_date',
  'notes',
]);

export async function updateDols(id, homeId, data, version) {
  const fields = Object.entries(data).filter(([k, v]) => v !== undefined && ALLOWED_DOLS_COLUMNS.has(k));
  if (fields.length === 0) return findDolsById(id, homeId);
  const mapped = fields.map(([k, v]) => [k, k === 'restrictions' ? JSON.stringify(v) : v]);
  const setClause = mapped.map(([k], i) => `"${k}" = $${i + 3}`).join(', ');
  const values = mapped.map(([_, v]) => v);
  const params = [id, homeId, ...values];
  let sql = `UPDATE dols SET ${setClause}, version = version + 1, updated_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ' RETURNING *';
  const { rows, rowCount } = await pool.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeDolsRow(rows[0]) : null;
}

export async function softDeleteDols(id, homeId) {
  const { rowCount } = await pool.query(
    'UPDATE dols SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rowCount > 0;
}

export async function findMcaByHome(homeId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT *, COUNT(*) OVER() AS _total FROM mca_assessments
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY assessment_date DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 500), Math.max(offset, 0)]
  );
  return paginate(rows, shapeMcaRow);
}

export async function syncMca(homeId, arr, client) {
  const conn = client || pool;
  if (!arr) return;
  const incomingIds = arr.map(m => m.id);

  for (const m of arr) {
    await conn.query(
      `INSERT INTO mca_assessments (
         id, home_id, resident_name, assessment_date, assessor,
         decision_area, lacks_capacity, best_interest_decision,
         next_review_date, notes, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (home_id, id) DO UPDATE SET
         resident_name=$3,assessment_date=$4,assessor=$5,
         decision_area=$6,lacks_capacity=$7,best_interest_decision=$8,
         next_review_date=$9,notes=$10,updated_at=$11,deleted_at=NULL`,
      [
        m.id, homeId, m.resident_name || null, m.assessment_date || null,
        m.assessor || null, m.decision_area || null,
        m.lacks_capacity ?? false, m.best_interest_decision || null,
        m.next_review_date || null, m.notes || null, m.updated_at || null,
      ]
    );
  }

  if (incomingIds.length > 0) {
    await conn.query(
      `UPDATE mca_assessments SET deleted_at = NOW() WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL`,
      [homeId, incomingIds]
    );
  } else {
    await conn.query(`UPDATE mca_assessments SET deleted_at = NOW() WHERE home_id = $1 AND deleted_at IS NULL`, [homeId]);
  }
}

// ── Individual CRUD for MCA (Mode 2 endpoints) ────────────────────────────────

export async function findMcaById(id, homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM mca_assessments WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rows[0] ? shapeMcaRow(rows[0]) : null;
}

export async function upsertMca(homeId, data) {
  const id = data.id || `mca-${randomUUID()}`;
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO mca_assessments (
       id, home_id, resident_name, assessment_date, assessor,
       decision_area, lacks_capacity, best_interest_decision,
       next_review_date, notes, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (home_id, id) DO UPDATE SET
       resident_name=$3,assessment_date=$4,assessor=$5,
       decision_area=$6,lacks_capacity=$7,best_interest_decision=$8,
       next_review_date=$9,notes=$10,updated_at=$11,deleted_at=NULL
     RETURNING *`,
    [
      id, homeId, data.resident_name || null, data.assessment_date || null,
      data.assessor || null, data.decision_area || null,
      data.lacks_capacity ?? false, data.best_interest_decision || null,
      data.next_review_date || null, data.notes || null, now,
    ]
  );
  return rows[0] ? shapeMcaRow(rows[0]) : null;
}

// Column name whitelist for dynamic SQL — MCA
const ALLOWED_MCA_COLUMNS = new Set([
  'resident_name', 'assessment_date', 'assessor',
  'decision_area', 'lacks_capacity', 'best_interest_decision',
  'next_review_date', 'notes',
]);

export async function updateMca(id, homeId, data, version) {
  const fields = Object.entries(data).filter(([k, v]) => v !== undefined && ALLOWED_MCA_COLUMNS.has(k));
  if (fields.length === 0) return findMcaById(id, homeId);
  const setClause = fields.map(([k], i) => `"${k}" = $${i + 3}`).join(', ');
  const values = fields.map(([_, v]) => v);
  const params = [id, homeId, ...values];
  let sql = `UPDATE mca_assessments SET ${setClause}, version = version + 1, updated_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ' RETURNING *';
  const { rows, rowCount } = await pool.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeMcaRow(rows[0]) : null;
}

export async function softDeleteMca(id, homeId) {
  const { rowCount } = await pool.query(
    'UPDATE mca_assessments SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rowCount > 0;
}
