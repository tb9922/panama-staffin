import { pool } from '../db.js';
import { toIsoOrNull } from '../lib/serverTimestamps.js';

function d(v) { return v instanceof Date ? v.toISOString().slice(0, 10) : v; }
const ts = toIsoOrNull;

// ── Column lists ─────────────────────────────────────────────────────────────

const ACCESS_LOG_COLS = 'id, ts, user_name, user_role, method, endpoint, home_id, data_categories, ip_address, status_code';

const DATA_REQUEST_COLS = 'id, home_id, request_type, subject_type, subject_id, subject_name, date_received, deadline, identity_verified, status, notes, completed_date, completed_by, version, created_at, updated_at';

const DATA_BREACH_COLS = 'id, home_id, title, description, discovered_date, data_categories, individuals_affected, severity, risk_to_rights, ico_notifiable, ico_notification_deadline, ico_notified, ico_notified_date, ico_reference, recommended_ico_notification, manual_decision, decision_by, decision_at, decision_rationale, containment_actions, root_cause, preventive_measures, status, version, created_at, updated_at';

const RETENTION_COLS = 'id, data_category, retention_period, retention_days, retention_basis, legal_basis, applies_to_table, special_category, notes';

const CONSENT_COLS = 'id, home_id, subject_type, subject_id, subject_name, purpose, legal_basis, given, withdrawn, notes, version, created_at, updated_at';

const DP_COMPLAINT_COLS = 'id, home_id, date_received, complainant_name, subject_type, subject_id, category, description, severity, ico_involved, ico_reference, status, resolution, resolution_date, version, created_at, updated_at';

const PROCESSOR_COLS = 'id, home_id, provider_name, provider_role, services, categories_of_data, categories_of_subjects, countries, international_transfers, dpa_status, contract_owner, signed_date, review_due, notes, version, created_by, created_at, updated_at';

// ── Access Log ───────────────────────────────────────────────────────────────

function shapeAccessLog(row) {
  return {
    id: row.id,
    ts: ts(row.ts),
    user_name: row.user_name,
    user_role: row.user_role,
    method: row.method,
    endpoint: row.endpoint,
    home_id: row.home_id,
    data_categories: row.data_categories || [],
    ip_address: row.ip_address,
    status_code: row.status_code,
  };
}

// Access log is global (home_id not resolved per-request to avoid DB lookups).
// All queries return global results — access is admin-only.
export async function getAccessLog({ limit = 100, offset = 0 } = {}, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${ACCESS_LOG_COLS} FROM access_log ORDER BY ts DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map(shapeAccessLog);
}

export async function getAccessLogByHomeSlugs(homeSlugs, { limit = 100, offset = 0 } = {}, client) {
  const conn = client || pool;
  const qualifiedCols = ACCESS_LOG_COLS.split(',').map(c => `al.${c.trim()}`).join(', ');
  const { rows } = await conn.query(
    `SELECT ${qualifiedCols} FROM access_log al
     JOIN homes h ON h.id = al.home_id AND h.deleted_at IS NULL
     WHERE h.slug = ANY($1)
     ORDER BY al.ts DESC LIMIT $2 OFFSET $3`,
    [homeSlugs, limit, offset]
  );
  return rows.map(shapeAccessLog);
}

export async function purgeAccessLog(days, client) {
  const conn = client || pool;
  const { rowCount } = await conn.query(
    `DELETE FROM access_log WHERE ts < NOW() - INTERVAL '1 day' * $1`,
    [days]
  );
  return rowCount;
}

// ── Data Requests (SAR/Erasure/etc.) ─────────────────────────────────────────

function shapeRequest(row) {
  return {
    id: row.id,
    home_id: row.home_id,
    request_type: row.request_type,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    subject_name: row.subject_name,
    date_received: d(row.date_received),
    deadline: d(row.deadline),
    identity_verified: row.identity_verified,
    status: row.status,
    notes: row.notes,
    completed_date: d(row.completed_date),
    completed_by: row.completed_by,
    version: row.version,
    created_at: ts(row.created_at),
    updated_at: ts(row.updated_at),
  };
}

export async function findRequests(homeId, { limit = 100, offset = 0 } = {}, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${DATA_REQUEST_COLS}, COUNT(*) OVER() AS _total FROM data_requests
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY date_received DESC
     LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 500), Math.max(offset, 0)]
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shapeRequest(rest); }), total };
}

export async function findRequestById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${DATA_REQUEST_COLS} FROM data_requests WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rows[0] ? shapeRequest(rows[0]) : null;
}

export async function createRequest(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO data_requests
       (home_id, request_type, subject_type, subject_id, subject_name, date_received, deadline, identity_verified, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${DATA_REQUEST_COLS}`,
    [homeId, data.request_type, data.subject_type, data.subject_id, data.subject_name || null,
     data.date_received, data.deadline, data.identity_verified ?? false, data.status ?? 'received', data.notes || null]
  );
  return shapeRequest(rows[0]);
}

export async function updateRequest(id, homeId, data, client, version) {
  const conn = client || pool;
  const ALLOWED = ['status', 'identity_verified', 'notes', 'completed_date', 'completed_by'];
  const fields = [];
  const values = [id, homeId];
  let idx = 3;
  for (const col of ALLOWED) {
    if (col in data) {
      fields.push(`${col} = $${idx++}`);
      values.push(data[col] ?? null);
    }
  }
  if (fields.length === 0) return null;
  fields.push('updated_at = NOW()');
  fields.push('version = version + 1');
  let sql = `UPDATE data_requests SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { values.push(version); sql += ` AND version = $${values.length}`; }
  sql += ` RETURNING ${DATA_REQUEST_COLS}`;
  const { rows, rowCount } = await conn.query(sql, values);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeRequest(rows[0]) : null;
}

// ── Data Breaches ────────────────────────────────────────────────────────────

function shapeBreach(row) {
  return {
    id: row.id,
    home_id: row.home_id,
    title: row.title,
    description: row.description,
    discovered_date: ts(row.discovered_date),
    data_categories: row.data_categories || [],
    individuals_affected: row.individuals_affected,
    severity: row.severity,
    risk_to_rights: row.risk_to_rights,
    ico_notifiable: row.ico_notifiable,
    ico_notification_deadline: ts(row.ico_notification_deadline),
    ico_notified: row.ico_notified,
    ico_notified_date: d(row.ico_notified_date),
    ico_reference: row.ico_reference,
    recommended_ico_notification: row.recommended_ico_notification,
    manual_decision: row.manual_decision,
    decision_by: row.decision_by,
    decision_at: ts(row.decision_at),
    decision_rationale: row.decision_rationale,
    containment_actions: row.containment_actions,
    root_cause: row.root_cause,
    preventive_measures: row.preventive_measures,
    status: row.status,
    version: row.version,
    created_at: ts(row.created_at),
    updated_at: ts(row.updated_at),
  };
}

export async function findBreaches(homeId, { limit = 100, offset = 0 } = {}, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${DATA_BREACH_COLS}, COUNT(*) OVER() AS _total FROM data_breaches
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY discovered_date DESC
     LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 500), Math.max(offset, 0)]
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shapeBreach(rest); }), total };
}

export async function findBreachById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${DATA_BREACH_COLS} FROM data_breaches WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rows[0] ? shapeBreach(rows[0]) : null;
}

export async function createBreach(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO data_breaches
       (home_id, title, description, discovered_date, data_categories,
        individuals_affected, severity, risk_to_rights, ico_notifiable,
        ico_notification_deadline, containment_actions, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${DATA_BREACH_COLS}`,
    [homeId, data.title, data.description || null, data.discovered_date,
     data.data_categories || [], data.individuals_affected ?? 0,
     data.severity ?? 'low', data.risk_to_rights ?? 'unlikely',
     data.ico_notifiable ?? false, data.ico_notification_deadline || null,
     data.containment_actions || null, data.status ?? 'open']
  );
  return shapeBreach(rows[0]);
}

export async function updateBreach(id, homeId, data, client, version) {
  const conn = client || pool;
  const ALLOWED = [
    'title', 'description', 'severity', 'risk_to_rights',
    'ico_notifiable', 'ico_notification_deadline', 'ico_notified', 'ico_notified_date',
    'ico_reference', 'recommended_ico_notification', 'manual_decision', 'decision_by',
    'decision_at', 'decision_rationale', 'containment_actions', 'root_cause', 'preventive_measures', 'status',
  ];
  const fields = [];
  const values = [id, homeId];
  let idx = 3;
  for (const col of ALLOWED) {
    if (col in data) {
      fields.push(`${col} = $${idx++}`);
      values.push(data[col] ?? null);
    }
  }
  if (fields.length === 0) return null;
  fields.push('updated_at = NOW()');
  fields.push('version = version + 1');
  let sql = `UPDATE data_breaches SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { values.push(version); sql += ` AND version = $${values.length}`; }
  sql += ` RETURNING ${DATA_BREACH_COLS}`;
  const { rows, rowCount } = await conn.query(sql, values);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeBreach(rows[0]) : null;
}

// ── Retention Schedule ───────────────────────────────────────────────────────

function shapeRetention(row) {
  return {
    id: row.id,
    data_category: row.data_category,
    retention_period: row.retention_period,
    retention_days: row.retention_days,
    retention_basis: row.retention_basis,
    legal_basis: row.legal_basis,
    applies_to_table: row.applies_to_table,
    special_category: row.special_category,
    notes: row.notes,
  };
}

export async function getRetentionSchedule(client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${RETENTION_COLS} FROM retention_schedule ORDER BY data_category`
  );
  return rows.map(shapeRetention);
}

// ── Consent Records ──────────────────────────────────────────────────────────

function shapeConsent(row) {
  return {
    id: row.id,
    home_id: row.home_id,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    subject_name: row.subject_name,
    purpose: row.purpose,
    legal_basis: row.legal_basis,
    given: ts(row.given),
    withdrawn: ts(row.withdrawn),
    notes: row.notes,
    version: row.version,
    created_at: ts(row.created_at),
    updated_at: ts(row.updated_at),
  };
}

export async function findConsent(homeId, { limit = 100, offset = 0 } = {}, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${CONSENT_COLS}, COUNT(*) OVER() AS _total FROM consent_records
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 500), Math.max(offset, 0)]
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shapeConsent(rest); }), total };
}

export async function findConsentById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${CONSENT_COLS} FROM consent_records WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rows[0] ? shapeConsent(rows[0]) : null;
}

export async function createConsent(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO consent_records
       (home_id, subject_type, subject_id, subject_name, purpose, legal_basis, given, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${CONSENT_COLS}`,
    [homeId, data.subject_type, data.subject_id, data.subject_name || null,
     data.purpose, data.legal_basis, data.given || null, data.notes || null]
  );
  return shapeConsent(rows[0]);
}

export async function updateConsent(id, homeId, data, client, version) {
  const conn = client || pool;
  const setClauses = [];
  const values = [id, homeId];
  let idx = 3;

  if ('withdrawn' in data) {
    setClauses.push(`withdrawn = $${idx++}`);
    values.push(data.withdrawn ?? null);
  }
  if ('notes' in data) {
    setClauses.push(`notes = $${idx++}`);
    values.push(data.notes ?? null);
  }

  if (setClauses.length === 0) return null;
  setClauses.push('updated_at = NOW()');
  setClauses.push('version = version + 1');

  let sql = `UPDATE consent_records SET ${setClauses.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { values.push(version); sql += ` AND version = $${values.length}`; }
  sql += ` RETURNING ${CONSENT_COLS}`;
  const { rows, rowCount } = await conn.query(sql, values);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeConsent(rows[0]) : null;
}

// ── DP Complaints ────────────────────────────────────────────────────────────

function shapeDPComplaint(row) {
  return {
    id: row.id,
    home_id: row.home_id,
    date_received: d(row.date_received),
    complainant_name: row.complainant_name,
    subject_type: row.subject_type || null,
    subject_id: row.subject_id || null,
    category: row.category,
    description: row.description,
    severity: row.severity,
    ico_involved: row.ico_involved,
    ico_reference: row.ico_reference,
    status: row.status,
    resolution: row.resolution,
    resolution_date: d(row.resolution_date),
    version: row.version,
    created_at: ts(row.created_at),
    updated_at: ts(row.updated_at),
  };
}

export async function findDPComplaints(homeId, { limit = 100, offset = 0 } = {}, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${DP_COMPLAINT_COLS}, COUNT(*) OVER() AS _total FROM dp_complaints
     WHERE home_id = $1 AND deleted_at IS NULL
     ORDER BY date_received DESC
     LIMIT $2 OFFSET $3`,
    [homeId, Math.min(limit, 500), Math.max(offset, 0)]
  );
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map(r => { const { _total, ...rest } = r; return shapeDPComplaint(rest); }), total };
}

export async function findDPComplaintById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${DP_COMPLAINT_COLS} FROM dp_complaints WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rows[0] ? shapeDPComplaint(rows[0]) : null;
}

export async function createDPComplaint(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO dp_complaints
       (home_id, date_received, complainant_name, subject_type, subject_id, category, description, severity, ico_involved, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${DP_COMPLAINT_COLS}`,
    [homeId, data.date_received, data.complainant_name || null, data.subject_type || null, data.subject_id || null, data.category,
     data.description, data.severity ?? 'low', data.ico_involved ?? false, data.status ?? 'open']
  );
  return shapeDPComplaint(rows[0]);
}

export async function updateDPComplaint(id, homeId, data, client, version) {
  const conn = client || pool;
  const ALLOWED = ['status', 'severity', 'ico_involved', 'ico_reference', 'resolution', 'resolution_date'];
  const fields = [];
  const values = [id, homeId];
  let idx = 3;
  for (const col of ALLOWED) {
    if (col in data) {
      fields.push(`${col} = $${idx++}`);
      values.push(data[col] ?? null);
    }
  }
  if (fields.length === 0) return null;
  fields.push('updated_at = NOW()');
  fields.push('version = version + 1');
  let sql = `UPDATE dp_complaints SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) { values.push(version); sql += ` AND version = $${values.length}`; }
  sql += ` RETURNING ${DP_COMPLAINT_COLS}`;
  const { rows, rowCount } = await conn.query(sql, values);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeDPComplaint(rows[0]) : null;
}

// —— GDPR Processors / DPA register ———————————————————————————————————————————

function shapeProcessor(row) {
  return {
    id: row.id,
    home_id: row.home_id,
    provider_name: row.provider_name,
    provider_role: row.provider_role,
    services: row.services,
    categories_of_data: row.categories_of_data,
    categories_of_subjects: row.categories_of_subjects,
    countries: row.countries,
    international_transfers: row.international_transfers,
    dpa_status: row.dpa_status,
    contract_owner: row.contract_owner,
    signed_date: d(row.signed_date),
    review_due: d(row.review_due),
    notes: row.notes,
    version: row.version,
    created_by: row.created_by,
    created_at: ts(row.created_at),
    updated_at: ts(row.updated_at),
  };
}

export async function findProcessors(homeId, { limit = 100, offset = 0, dpa_status = null } = {}, client) {
  const conn = client || pool;
  let sql = `SELECT ${PROCESSOR_COLS}, COUNT(*) OVER() AS _total
               FROM gdpr_processors
              WHERE home_id = $1 AND deleted_at IS NULL`;
  const params = [homeId];
  if (dpa_status) {
    params.push(dpa_status);
    sql += ` AND dpa_status = $${params.length}`;
  }
  sql += ' ORDER BY provider_name ASC';
  params.push(Math.min(limit, 500));
  sql += ` LIMIT $${params.length}`;
  params.push(Math.max(offset, 0));
  sql += ` OFFSET $${params.length}`;
  const { rows } = await conn.query(sql, params);
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  return { rows: rows.map((row) => { const { _total, ...rest } = row; return shapeProcessor(rest); }), total };
}

export async function findProcessorById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${PROCESSOR_COLS}
       FROM gdpr_processors
      WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`,
    [id, homeId]
  );
  return rows[0] ? shapeProcessor(rows[0]) : null;
}

export async function createProcessor(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO gdpr_processors
       (home_id, provider_name, provider_role, services, categories_of_data, categories_of_subjects,
        countries, international_transfers, dpa_status, contract_owner, signed_date, review_due,
        notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING ${PROCESSOR_COLS}`,
    [
      homeId,
      data.provider_name,
      data.provider_role,
      data.services || null,
      data.categories_of_data,
      data.categories_of_subjects,
      data.countries || null,
      data.international_transfers ?? false,
      data.dpa_status || 'requested',
      data.contract_owner || null,
      data.signed_date || null,
      data.review_due || null,
      data.notes || null,
      data.created_by,
    ]
  );
  return shapeProcessor(rows[0]);
}

export async function updateProcessor(id, homeId, data, client, version) {
  const conn = client || pool;
  const settable = [
    'provider_name', 'provider_role', 'services', 'categories_of_data', 'categories_of_subjects',
    'countries', 'international_transfers', 'dpa_status', 'contract_owner', 'signed_date',
    'review_due', 'notes',
  ];
  const fields = [];
  const params = [id, homeId];
  for (const key of settable) {
    if (!(key in data)) continue;
    params.push(data[key] ?? null);
    fields.push(`${key} = $${params.length}`);
  }
  if (fields.length === 0) return findProcessorById(id, homeId, client);
  fields.push('version = version + 1', 'updated_at = NOW()');
  let sql = `UPDATE gdpr_processors SET ${fields.join(', ')} WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL`;
  if (version != null) {
    params.push(version);
    sql += ` AND version = $${params.length}`;
  }
  sql += ` RETURNING ${PROCESSOR_COLS}`;
  const { rows, rowCount } = await conn.query(sql, params);
  if (rowCount === 0 && version != null) return null;
  return rows[0] ? shapeProcessor(rows[0]) : null;
}

