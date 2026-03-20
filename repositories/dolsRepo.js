import { pool } from '../db.js';

const ts = v => v instanceof Date ? v.toISOString() : v;

/* Explicit column lists — no SELECT * — so future columns don't auto-leak to API consumers. */
const DOLS_COLS = `id, home_id, resident_name, resident_id, dob, room_number,
  application_type, application_date, authorised,
  authorisation_date, expiry_date, authorisation_number, authorising_authority,
  restrictions, reviewed_date, review_status, next_review_date,
  notes, version, updated_at, created_at, deleted_at`;

const MCA_COLS = `id, home_id, resident_name, resident_id, assessment_date, assessor,
  decision_area, lacks_capacity, best_interest_decision,
  next_review_date, notes, version, updated_at, created_at, deleted_at`;

// Auto-resolve resident_id from finance_residents by name+home.
// Called before insert to ensure FK is populated even when UI only sends resident_name.
async function resolveResidentId(homeId, residentName, conn) {
  if (!residentName) return null;
  const { rows } = await conn.query(
    `SELECT id FROM finance_residents WHERE home_id = $1 AND resident_name = $2 AND deleted_at IS NULL`,
    [homeId, residentName]
  );
  return rows.length === 1 ? rows[0].id : null;
}

function shapeDolsRow(row) {
  return {
    id: row.id, version: row.version != null ? parseInt(row.version, 10) : undefined,
    resident_name: row.resident_name, resident_id: row.resident_id || null, dob: row.dob, room_number: row.room_number,
    application_type: row.application_type, application_date: row.application_date,
    authorised: row.authorised, authorisation_date: row.authorisation_date, expiry_date: row.expiry_date,
    authorisation_number: row.authorisation_number, authorising_authority: row.authorising_authority,
    restrictions: typeof row.restrictions === 'string' ? JSON.parse(row.restrictions) : row.restrictions,
    reviewed_date: row.reviewed_date, review_status: row.review_status, next_review_date: row.next_review_date,
    notes: row.notes, updated_at: ts(row.updated_at),
  };
}

function shapeMcaRow(row) {
  return {
    id: row.id, version: row.version != null ? parseInt(row.version, 10) : undefined,
    resident_name: row.resident_name, resident_id: row.resident_id || null, assessment_date: row.assessment_date, assessor: row.assessor,
    decision_area: row.decision_area, lacks_capacity: row.lacks_capacity,
    best_interest_decision: row.best_interest_decision, next_review_date: row.next_review_date,
    notes: row.notes, updated_at: ts(row.updated_at),
  };
}

function paginate(rows, shapeFn) {
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shapeFn(rest); }), total };
}

export async function findByHome(homeId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT ${DOLS_COLS}, COUNT(*) OVER() AS _total FROM dols
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

  const COLS_PER_ROW = 17;
  const CHUNK = Math.floor(65000 / COLS_PER_ROW);
  for (let i = 0; i < arr.length; i += CHUNK) {
    const chunk = arr.slice(i, i + CHUNK);
    const placeholders = [];
    const values = [];
    chunk.forEach((d, j) => {
      const b = j * COLS_PER_ROW + 2;
      placeholders.push(
        `($${b},$1,$${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},` +
        `$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},` +
        `$${b+15},$${b+16})`
      );
      values.push(
        d.id, d.resident_name || null, d.dob || null, d.room_number || null,
        d.application_type || null, d.application_date || null,
        d.authorised ?? false,
        d.authorisation_date || null, d.expiry_date || null,
        d.authorisation_number || null, d.authorising_authority || null,
        JSON.stringify(d.restrictions || []),
        d.reviewed_date || null, d.review_status || null, d.next_review_date || null,
        d.notes || null, d.updated_at || null,
      );
    });
    await conn.query(
      `INSERT INTO dols (
         id, home_id, resident_name, dob, room_number,
         application_type, application_date, authorised,
         authorisation_date, expiry_date, authorisation_number, authorising_authority,
         restrictions, reviewed_date, review_status, next_review_date,
         notes, updated_at
       ) VALUES ${placeholders.join(',')}
       ON CONFLICT (home_id, id) DO UPDATE SET
         resident_name=EXCLUDED.resident_name,dob=EXCLUDED.dob,room_number=EXCLUDED.room_number,
         application_type=EXCLUDED.application_type,application_date=EXCLUDED.application_date,authorised=EXCLUDED.authorised,
         authorisation_date=EXCLUDED.authorisation_date,expiry_date=EXCLUDED.expiry_date,
         authorisation_number=EXCLUDED.authorisation_number,authorising_authority=EXCLUDED.authorising_authority,
         restrictions=EXCLUDED.restrictions,reviewed_date=EXCLUDED.reviewed_date,
         review_status=EXCLUDED.review_status,next_review_date=EXCLUDED.next_review_date,
         notes=EXCLUDED.notes,updated_at=EXCLUDED.updated_at,deleted_at=NULL`,
      [homeId, ...values]
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
    `SELECT ${DOLS_COLS} FROM dols WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rows[0] ? shapeDolsRow(rows[0]) : null;
}

export async function upsertDols(homeId, data) {
  const id = data.id || `dls-${randomUUID()}`;
  const now = new Date().toISOString();
  // Auto-resolve resident_id from finance_residents if not provided
  const residentId = data.resident_id || await resolveResidentId(homeId, data.resident_name, pool);
  const { rows } = await pool.query(
    `INSERT INTO dols (
       id, home_id, resident_name, resident_id, dob, room_number,
       application_type, application_date, authorised,
       authorisation_date, expiry_date, authorisation_number, authorising_authority,
       restrictions, reviewed_date, review_status, next_review_date,
       notes, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (home_id, id) DO UPDATE SET
       resident_name=$3,resident_id=$4,dob=$5,room_number=$6,
       application_type=$7,application_date=$8,authorised=$9,
       authorisation_date=$10,expiry_date=$11,authorisation_number=$12,
       authorising_authority=$13,restrictions=$14,reviewed_date=$15,
       review_status=$16,next_review_date=$17,notes=$18,updated_at=$19,deleted_at=NULL
     RETURNING ${DOLS_COLS}`,
    [
      id, homeId, data.resident_name || null, residentId,
      data.dob || null, data.room_number || null,
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
  'resident_name', 'resident_id', 'dob', 'room_number',
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
  sql += ` RETURNING ${DOLS_COLS}`;
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
    `SELECT ${MCA_COLS}, COUNT(*) OVER() AS _total FROM mca_assessments
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

  const COLS_PER_ROW = 10;
  const CHUNK = Math.floor(65000 / COLS_PER_ROW);
  for (let i = 0; i < arr.length; i += CHUNK) {
    const chunk = arr.slice(i, i + CHUNK);
    const placeholders = [];
    const values = [];
    chunk.forEach((m, j) => {
      const b = j * COLS_PER_ROW + 2;
      placeholders.push(
        `($${b},$1,$${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},` +
        `$${b+7},$${b+8},$${b+9})`
      );
      values.push(
        m.id, m.resident_name || null, m.assessment_date || null,
        m.assessor || null, m.decision_area || null,
        m.lacks_capacity ?? false, m.best_interest_decision || null,
        m.next_review_date || null, m.notes || null, m.updated_at || null,
      );
    });
    await conn.query(
      `INSERT INTO mca_assessments (
         id, home_id, resident_name, assessment_date, assessor,
         decision_area, lacks_capacity, best_interest_decision,
         next_review_date, notes, updated_at
       ) VALUES ${placeholders.join(',')}
       ON CONFLICT (home_id, id) DO UPDATE SET
         resident_name=EXCLUDED.resident_name,assessment_date=EXCLUDED.assessment_date,assessor=EXCLUDED.assessor,
         decision_area=EXCLUDED.decision_area,lacks_capacity=EXCLUDED.lacks_capacity,
         best_interest_decision=EXCLUDED.best_interest_decision,
         next_review_date=EXCLUDED.next_review_date,notes=EXCLUDED.notes,updated_at=EXCLUDED.updated_at,deleted_at=NULL`,
      [homeId, ...values]
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
    `SELECT ${MCA_COLS} FROM mca_assessments WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rows[0] ? shapeMcaRow(rows[0]) : null;
}

export async function upsertMca(homeId, data) {
  const id = data.id || `mca-${randomUUID()}`;
  const now = new Date().toISOString();
  const residentId = data.resident_id || await resolveResidentId(homeId, data.resident_name, pool);
  const { rows } = await pool.query(
    `INSERT INTO mca_assessments (
       id, home_id, resident_name, resident_id, assessment_date, assessor,
       decision_area, lacks_capacity, best_interest_decision,
       next_review_date, notes, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (home_id, id) DO UPDATE SET
       resident_name=$3,resident_id=$4,assessment_date=$5,assessor=$6,
       decision_area=$7,lacks_capacity=$8,best_interest_decision=$9,
       next_review_date=$10,notes=$11,updated_at=$12,deleted_at=NULL
     RETURNING ${MCA_COLS}`,
    [
      id, homeId, data.resident_name || null, residentId,
      data.assessment_date || null,
      data.assessor || null, data.decision_area || null,
      data.lacks_capacity ?? false, data.best_interest_decision || null,
      data.next_review_date || null, data.notes || null, now,
    ]
  );
  return rows[0] ? shapeMcaRow(rows[0]) : null;
}

// Column name whitelist for dynamic SQL — MCA
const ALLOWED_MCA_COLUMNS = new Set([
  'resident_name', 'resident_id', 'assessment_date', 'assessor',
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
  sql += ` RETURNING ${MCA_COLS}`;
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
