import { pool } from '../db.js';
import { toIsoOrNull } from '../lib/serverTimestamps.js';

const d = v => v instanceof Date ? v.toISOString().slice(0, 10) : v;
const ts = toIsoOrNull;

const COLS = 'id, home_id, title, processing_description, purpose, scope, screening_result, screening_rationale, high_risk_triggers, necessity_assessment, proportionality_assessment, legal_basis, risk_assessment, risk_level, measures, residual_risk, consultation_required, dpo_advice, dpo_advice_date, ico_consultation, ico_consultation_date, stakeholder_views, status, approved_by, approved_date, review_date, next_review_due, notes, version, created_by, created_at, updated_at';

function shape(row) {
  if (!row) return null;
  return {
    id: row.id, home_id: row.home_id, title: row.title,
    processing_description: row.processing_description, purpose: row.purpose, scope: row.scope,
    screening_result: row.screening_result, screening_rationale: row.screening_rationale,
    high_risk_triggers: row.high_risk_triggers,
    necessity_assessment: row.necessity_assessment, proportionality_assessment: row.proportionality_assessment,
    legal_basis: row.legal_basis,
    risk_assessment: row.risk_assessment, risk_level: row.risk_level,
    measures: row.measures, residual_risk: row.residual_risk,
    consultation_required: row.consultation_required, dpo_advice: row.dpo_advice,
    dpo_advice_date: d(row.dpo_advice_date),
    ico_consultation: row.ico_consultation, ico_consultation_date: d(row.ico_consultation_date),
    stakeholder_views: row.stakeholder_views,
    status: row.status, approved_by: row.approved_by, approved_date: d(row.approved_date),
    review_date: d(row.review_date), next_review_due: d(row.next_review_due),
    notes: row.notes, version: row.version, created_by: row.created_by,
    created_at: ts(row.created_at), updated_at: ts(row.updated_at),
  };
}

export async function findAll(homeId, { status, limit = 100, offset = 0 } = {}, client) {
  const conn = client || pool;
  let sql = `SELECT ${COLS}, COUNT(*) OVER() AS _total FROM dpia_assessments WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  sql += ' ORDER BY created_at DESC';
  params.push(Math.min(limit, 500)); sql += ` LIMIT $${params.length}`;
  params.push(offset); sql += ` OFFSET $${params.length}`;
  const { rows } = await conn.query(sql, params);
  const total = rows.length > 0 ? parseInt(rows[0]._total) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shape(rest); }), total };
}

export async function findById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM dpia_assessments WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`, [id, homeId]
  );
  return rows[0] ? shape(rows[0]) : null;
}

export async function create(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO dpia_assessments (home_id, title, processing_description, purpose, scope,
       screening_result, screening_rationale, high_risk_triggers, legal_basis, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${COLS}`,
    [homeId, data.title, data.processing_description, data.purpose || null, data.scope || null,
     data.screening_result || 'required', data.screening_rationale || null,
     data.high_risk_triggers || null, data.legal_basis || null,
     data.status || 'screening', data.created_by]
  );
  return shape(rows[0]);
}

export async function update(id, homeId, data, client, version) {
  const conn = client || pool;
  const settable = [
    'title', 'processing_description', 'purpose', 'scope',
    'screening_result', 'screening_rationale', 'high_risk_triggers',
    'necessity_assessment', 'proportionality_assessment', 'legal_basis',
    'risk_assessment', 'risk_level', 'measures', 'residual_risk',
    'consultation_required', 'dpo_advice', 'dpo_advice_date',
    'ico_consultation', 'ico_consultation_date', 'stakeholder_views',
    'status', 'approved_by', 'approved_date', 'review_date', 'next_review_due', 'notes',
  ];
  const fields = [];
  const params = [id, homeId];
  for (const key of settable) {
    if (key in data) { params.push(data[key] ?? null); fields.push(`${key} = $${params.length}`); }
  }
  if (fields.length === 0) return findById(id, homeId, client);
  fields.push('version = version + 1', 'updated_at = NOW()');
  let sql = `UPDATE dpia_assessments SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { params.push(version); sql += ` AND version = $${params.length}`; }
  sql += ` RETURNING ${COLS}`;
  const { rows, rowCount } = await conn.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shape(rows[0]) : null;
}

export async function softDelete(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE dpia_assessments SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING id`,
    [id, homeId]
  );
  return rows[0] || null;
}
