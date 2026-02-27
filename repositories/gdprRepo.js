import { pool } from '../db.js';

function d(v) { return v instanceof Date ? v.toISOString().slice(0, 10) : v; }
function ts(v) { return v instanceof Date ? v.toISOString() : v; }

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
    `SELECT * FROM access_log ORDER BY ts DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
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
    created_at: ts(row.created_at),
    updated_at: ts(row.updated_at),
  };
}

export async function findRequests(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT * FROM data_requests WHERE home_id = $1 ORDER BY date_received DESC`,
    [homeId]
  );
  return rows.map(shapeRequest);
}

export async function findRequestById(id, client) {
  const conn = client || pool;
  const { rows } = await conn.query(`SELECT * FROM data_requests WHERE id = $1`, [id]);
  return rows[0] ? shapeRequest(rows[0]) : null;
}

export async function createRequest(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO data_requests
       (home_id, request_type, subject_type, subject_id, subject_name, date_received, deadline, identity_verified, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [homeId, data.request_type, data.subject_type, data.subject_id, data.subject_name || null,
     data.date_received, data.deadline, data.identity_verified || false, data.status || 'received', data.notes || null]
  );
  return shapeRequest(rows[0]);
}

export async function updateRequest(id, homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE data_requests SET
       status = COALESCE($2, status),
       identity_verified = COALESCE($3, identity_verified),
       notes = COALESCE($4, notes),
       completed_date = COALESCE($5, completed_date),
       completed_by = COALESCE($6, completed_by),
       updated_at = NOW()
     WHERE id = $1 AND home_id = $7 RETURNING *`,
    [id, data.status || null, data.identity_verified ?? null, data.notes ?? null,
     data.completed_date || null, data.completed_by || null, homeId]
  );
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
    containment_actions: row.containment_actions,
    root_cause: row.root_cause,
    preventive_measures: row.preventive_measures,
    status: row.status,
    created_at: ts(row.created_at),
    updated_at: ts(row.updated_at),
  };
}

export async function findBreaches(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT * FROM data_breaches WHERE home_id = $1 ORDER BY discovered_date DESC`,
    [homeId]
  );
  return rows.map(shapeBreach);
}

export async function findBreachById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT * FROM data_breaches WHERE id = $1 AND home_id = $2`,
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
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [homeId, data.title, data.description || null, data.discovered_date,
     data.data_categories || [], data.individuals_affected || 0,
     data.severity || 'low', data.risk_to_rights || 'unlikely',
     data.ico_notifiable || false, data.ico_notification_deadline || null,
     data.containment_actions || null, data.status || 'open']
  );
  return shapeBreach(rows[0]);
}

export async function updateBreach(id, homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE data_breaches SET
       title = COALESCE($2, title),
       description = COALESCE($3, description),
       severity = COALESCE($4, severity),
       risk_to_rights = COALESCE($5, risk_to_rights),
       ico_notifiable = COALESCE($6, ico_notifiable),
       ico_notification_deadline = COALESCE($7, ico_notification_deadline),
       ico_notified = COALESCE($8, ico_notified),
       ico_notified_date = COALESCE($9, ico_notified_date),
       ico_reference = COALESCE($10, ico_reference),
       containment_actions = COALESCE($11, containment_actions),
       root_cause = COALESCE($12, root_cause),
       preventive_measures = COALESCE($13, preventive_measures),
       status = COALESCE($14, status),
       updated_at = NOW()
     WHERE id = $1 AND home_id = $15 RETURNING *`,
    [id, data.title ?? null, data.description ?? null, data.severity ?? null,
     data.risk_to_rights ?? null, data.ico_notifiable ?? null,
     data.ico_notification_deadline ?? null,
     data.ico_notified ?? null, data.ico_notified_date ?? null,
     data.ico_reference ?? null, data.containment_actions ?? null,
     data.root_cause ?? null, data.preventive_measures ?? null, data.status ?? null,
     homeId]
  );
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
    `SELECT * FROM retention_schedule ORDER BY data_category`
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
    created_at: ts(row.created_at),
    updated_at: ts(row.updated_at),
  };
}

export async function findConsent(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT * FROM consent_records WHERE home_id = $1 ORDER BY created_at DESC`,
    [homeId]
  );
  return rows.map(shapeConsent);
}

export async function createConsent(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO consent_records
       (home_id, subject_type, subject_id, subject_name, purpose, legal_basis, given, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [homeId, data.subject_type, data.subject_id, data.subject_name || null,
     data.purpose, data.legal_basis, data.given || null, data.notes || null]
  );
  return shapeConsent(rows[0]);
}

export async function updateConsent(id, homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE consent_records SET
       withdrawn = COALESCE($2, withdrawn),
       notes = COALESCE($3, notes),
       updated_at = NOW()
     WHERE id = $1 AND home_id = $4 RETURNING *`,
    [id, data.withdrawn || null, data.notes ?? null, homeId]
  );
  return rows[0] ? shapeConsent(rows[0]) : null;
}

// ── DP Complaints ────────────────────────────────────────────────────────────

function shapeDPComplaint(row) {
  return {
    id: row.id,
    home_id: row.home_id,
    date_received: d(row.date_received),
    complainant_name: row.complainant_name,
    category: row.category,
    description: row.description,
    severity: row.severity,
    ico_involved: row.ico_involved,
    ico_reference: row.ico_reference,
    status: row.status,
    resolution: row.resolution,
    resolution_date: d(row.resolution_date),
    created_at: ts(row.created_at),
    updated_at: ts(row.updated_at),
  };
}

export async function findDPComplaints(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT * FROM dp_complaints WHERE home_id = $1 ORDER BY date_received DESC`,
    [homeId]
  );
  return rows.map(shapeDPComplaint);
}

export async function createDPComplaint(homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO dp_complaints
       (home_id, date_received, complainant_name, category, description, severity, ico_involved, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [homeId, data.date_received, data.complainant_name || null, data.category,
     data.description, data.severity || 'low', data.ico_involved || false, data.status || 'open']
  );
  return shapeDPComplaint(rows[0]);
}

export async function updateDPComplaint(id, homeId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE dp_complaints SET
       status = COALESCE($2, status),
       severity = COALESCE($3, severity),
       ico_involved = COALESCE($4, ico_involved),
       ico_reference = COALESCE($5, ico_reference),
       resolution = COALESCE($6, resolution),
       resolution_date = COALESCE($7, resolution_date),
       updated_at = NOW()
     WHERE id = $1 AND home_id = $8 RETURNING *`,
    [id, data.status ?? null, data.severity ?? null, data.ico_involved ?? null,
     data.ico_reference ?? null, data.resolution ?? null, data.resolution_date ?? null,
     homeId]
  );
  return rows[0] ? shapeDPComplaint(rows[0]) : null;
}
