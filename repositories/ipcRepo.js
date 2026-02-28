import { pool } from '../db.js';

function shapeRow(row) {
  const shaped = { ...row };
  if (shaped.audit_date instanceof Date) shaped.audit_date = shaped.audit_date.toISOString().slice(0, 10);
  if (shaped.reported_at instanceof Date) shaped.reported_at = shaped.reported_at.toISOString();
  if (shaped.updated_at instanceof Date) shaped.updated_at = shaped.updated_at.toISOString();
  if (shaped.overall_score != null) shaped.overall_score = parseFloat(shaped.overall_score);
  if (shaped.compliance_pct != null) shaped.compliance_pct = parseFloat(shaped.compliance_pct);
  if (shaped.version != null) shaped.version = parseInt(shaped.version, 10);
  delete shaped.home_id;
  delete shaped.created_at;
  delete shaped.deleted_at;
  return shaped;
}

export async function findByHome(homeId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT *, COUNT(*) OVER() AS _total FROM ipc_audits
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY audit_date DESC NULLS LAST LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 500), Math.max(offset, 0)]
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shapeRow(rest); }), total };
}

export async function sync(homeId, arr, client) {
  const conn = client || pool;
  if (!arr) return;
  const incomingIds = arr.map(a => a.id);

  for (const a of arr) {
    await conn.query(
      `INSERT INTO ipc_audits (
         id, home_id, audit_date, audit_type, auditor, overall_score, compliance_pct,
         risk_areas, corrective_actions, outbreak, notes, reported_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (home_id, id) DO UPDATE SET
         audit_date=$3,audit_type=$4,auditor=$5,overall_score=$6,compliance_pct=$7,
         risk_areas=$8,corrective_actions=$9,outbreak=$10,notes=$11,
         reported_at=$12,updated_at=$13,deleted_at=NULL`,
      [
        a.id, homeId, a.audit_date || null, a.audit_type || null, a.auditor || null,
        a.overall_score ?? null, a.compliance_pct ?? null,
        JSON.stringify(a.risk_areas || []), JSON.stringify(a.corrective_actions || []),
        JSON.stringify(a.outbreak || {}), a.notes || null,
        a.reported_at || null, a.updated_at || null,
      ]
    );
  }

  if (incomingIds.length > 0) {
    await conn.query(
      `UPDATE ipc_audits SET deleted_at = NOW() WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL`,
      [homeId, incomingIds]
    );
  } else {
    await conn.query(`UPDATE ipc_audits SET deleted_at = NOW() WHERE home_id = $1 AND deleted_at IS NULL`, [homeId]);
  }
}

// ── Individual CRUD (Mode 2 endpoints) ────────────────────────────────────────

import { randomUUID } from 'crypto';

export async function findById(id, homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM ipc_audits WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function upsert(homeId, data) {
  const id = data.id || `ipc-${randomUUID()}`;
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO ipc_audits (
       id, home_id, audit_date, audit_type, auditor, overall_score, compliance_pct,
       risk_areas, corrective_actions, outbreak, notes, reported_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (home_id, id) DO UPDATE SET
       audit_date=$3,audit_type=$4,auditor=$5,overall_score=$6,compliance_pct=$7,
       risk_areas=$8,corrective_actions=$9,outbreak=$10,notes=$11,
       reported_at=$12,updated_at=$13,deleted_at=NULL
     RETURNING *`,
    [
      id, homeId, data.audit_date || null, data.audit_type || null, data.auditor || null,
      data.overall_score != null ? data.overall_score : null,
      data.compliance_pct != null ? data.compliance_pct : null,
      JSON.stringify(data.risk_areas || []), JSON.stringify(data.corrective_actions || []),
      JSON.stringify(data.outbreak || {}), data.notes || null,
      data.reported_at || now, now,
    ]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function update(id, homeId, data, version) {
  const fields = Object.entries(data).filter(([_, v]) => v !== undefined);
  if (fields.length === 0) return findById(id, homeId);
  const jsonCols = ['risk_areas', 'corrective_actions', 'outbreak'];
  const mapped = fields.map(([k, v]) => [k, jsonCols.includes(k) ? JSON.stringify(v) : v]);
  const params = [id, homeId, ...mapped.map(([_, v]) => v)];
  const setClause = mapped.map(([k], i) => `"${k}" = $${i + 3}`).join(', ');
  let sql = `UPDATE ipc_audits SET ${setClause}, updated_at = NOW(), version = version + 1 WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ' RETURNING *';
  const { rows, rowCount } = await pool.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function softDelete(id, homeId) {
  const { rowCount } = await pool.query(
    'UPDATE ipc_audits SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rowCount > 0;
}
