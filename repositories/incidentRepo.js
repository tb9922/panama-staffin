import { pool } from '../db.js';

function shapeRow(row) {
  const shaped = { ...row };
  // Convert Date objects to ISO strings
  for (const col of ['date', 'cqc_notified_date', 'riddor_reported_date', 'safeguarding_date',
    'candour_notification_date', 'candour_letter_sent_date', 'police_contact_date',
    'investigation_start_date', 'investigation_review_date', 'investigation_closed_date']) {
    if (shaped[col] instanceof Date) shaped[col] = shaped[col].toISOString().slice(0, 10);
  }
  for (const col of ['reported_at', 'updated_at', 'frozen_at']) {
    if (shaped[col] instanceof Date) shaped[col] = shaped[col].toISOString();
  }
  if (shaped.cqc_notification_deadline instanceof Date) {
    shaped.cqc_notification_deadline = shaped.cqc_notification_deadline.toISOString();
  }
  // Remove DB-internal columns
  delete shaped.home_id;
  delete shaped.created_at;
  delete shaped.deleted_at;
  return shaped;
}

/**
 * Return all non-deleted incidents for a home.
 * @param {number} homeId
 */
export async function findByHome(homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM incidents WHERE home_id = $1 AND deleted_at IS NULL ORDER BY date DESC NULLS LAST',
    [homeId]
  );
  return rows.map(shapeRow);
}

/**
 * Sync incidents. Upserts all incoming, soft-deletes removed records.
 * @param {number} homeId
 * @param {Array} incidentsArr
 * @param {object} [client]
 */
export async function sync(homeId, incidentsArr, client) {
  const conn = client || pool;
  if (!incidentsArr) return;

  const incomingIds = incidentsArr.map(i => i.id);

  for (const inc of incidentsArr) {
    await conn.query(
      `INSERT INTO incidents (
         id, home_id, date, time, location, type, severity, description,
         person_affected, person_affected_name, staff_involved, immediate_action,
         medical_attention, hospital_attendance,
         cqc_notifiable, cqc_notification_type, cqc_notification_deadline,
         cqc_notified, cqc_notified_date, cqc_reference,
         riddor_reportable, riddor_category, riddor_reported, riddor_reported_date, riddor_reference,
         safeguarding_referral, safeguarding_to, safeguarding_reference, safeguarding_date,
         witnesses, duty_of_candour_applies, candour_notification_date, candour_letter_sent_date, candour_recipient,
         police_involved, police_reference, police_contact_date,
         msp_wishes_recorded, msp_outcome_preferences, msp_person_involved,
         investigation_status, investigation_start_date, investigation_lead,
         investigation_review_date, root_cause, lessons_learned, investigation_closed_date,
         corrective_actions, reported_by, reported_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
         $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
         $41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51
       )
       ON CONFLICT (home_id, id) DO UPDATE SET
         date=$3,time=$4,location=$5,type=$6,severity=$7,description=$8,
         person_affected=$9,person_affected_name=$10,staff_involved=$11,immediate_action=$12,
         medical_attention=$13,hospital_attendance=$14,
         cqc_notifiable=$15,cqc_notification_type=$16,cqc_notification_deadline=$17,
         cqc_notified=$18,cqc_notified_date=$19,cqc_reference=$20,
         riddor_reportable=$21,riddor_category=$22,riddor_reported=$23,riddor_reported_date=$24,riddor_reference=$25,
         safeguarding_referral=$26,safeguarding_to=$27,safeguarding_reference=$28,safeguarding_date=$29,
         witnesses=$30,duty_of_candour_applies=$31,candour_notification_date=$32,candour_letter_sent_date=$33,candour_recipient=$34,
         police_involved=$35,police_reference=$36,police_contact_date=$37,
         msp_wishes_recorded=$38,msp_outcome_preferences=$39,msp_person_involved=$40,
         investigation_status=$41,investigation_start_date=$42,investigation_lead=$43,
         investigation_review_date=$44,root_cause=$45,lessons_learned=$46,investigation_closed_date=$47,
         corrective_actions=$48,reported_by=$49,reported_at=$50,updated_at=$51,
         deleted_at=NULL
       WHERE incidents.frozen_at IS NULL`,
      [
        inc.id, homeId, inc.date || null, inc.time || null, inc.location || null,
        inc.type || null, inc.severity || null, inc.description || null,
        inc.person_affected || null, inc.person_affected_name || null,
        JSON.stringify(inc.staff_involved || []), inc.immediate_action || null,
        inc.medical_attention ?? null, inc.hospital_attendance ?? null,
        inc.cqc_notifiable || false, inc.cqc_notification_type || null,
        inc.cqc_notification_deadline || null,
        inc.cqc_notified || false, inc.cqc_notified_date || null, inc.cqc_reference || null,
        inc.riddor_reportable || false, inc.riddor_category || null,
        inc.riddor_reported || false, inc.riddor_reported_date || null, inc.riddor_reference || null,
        inc.safeguarding_referral || false, inc.safeguarding_to || null,
        inc.safeguarding_reference || null, inc.safeguarding_date || null,
        JSON.stringify(inc.witnesses || []), inc.duty_of_candour_applies || false,
        inc.candour_notification_date || null, inc.candour_letter_sent_date || null,
        inc.candour_recipient || null, inc.police_involved || false,
        inc.police_reference || null, inc.police_contact_date || null,
        inc.msp_wishes_recorded ?? null, inc.msp_outcome_preferences || null,
        inc.msp_person_involved ?? null,
        inc.investigation_status || 'open', inc.investigation_start_date || null,
        inc.investigation_lead || null, inc.investigation_review_date || null,
        inc.root_cause || null, inc.lessons_learned || null, inc.investigation_closed_date || null,
        JSON.stringify(inc.corrective_actions || []),
        inc.reported_by || null, inc.reported_at || null, inc.updated_at || null,
      ]
    );
  }

  // Soft-delete records removed from the frontend (skip frozen records)
  if (incomingIds.length > 0) {
    await conn.query(
      `UPDATE incidents SET deleted_at = NOW()
       WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL AND frozen_at IS NULL`,
      [homeId, incomingIds]
    );
  } else {
    await conn.query(
      `UPDATE incidents SET deleted_at = NOW() WHERE home_id = $1 AND deleted_at IS NULL AND frozen_at IS NULL`,
      [homeId]
    );
  }
}

// ── Incident freeze ────────────────────────────────────────────────────────────

/**
 * Freeze an incident. Once frozen, the incident body is immutable.
 * @param {string} incidentId
 * @param {number} homeId
 */
export async function freeze(incidentId, homeId) {
  const { rowCount } = await pool.query(
    `UPDATE incidents SET frozen_at = NOW()
     WHERE id = $1 AND home_id = $2 AND frozen_at IS NULL AND deleted_at IS NULL`,
    [incidentId, homeId]
  );
  return rowCount > 0;
}

/**
 * Check if an incident is frozen.
 * @param {string} incidentId
 * @param {number} homeId
 * @returns {Promise<boolean>}
 */
export async function isFrozen(incidentId, homeId) {
  const { rows } = await pool.query(
    'SELECT frozen_at FROM incidents WHERE id = $1 AND home_id = $2',
    [incidentId, homeId]
  );
  return rows.length > 0 && rows[0].frozen_at != null;
}

// ── Incident addenda (append-only post-freeze notes) ───────────────────────────

/**
 * Add an addendum to an incident. Works on both frozen and unfrozen incidents.
 * @param {string} incidentId
 * @param {number} homeId
 * @param {string} author
 * @param {string} content
 */
export async function addAddendum(incidentId, homeId, author, content) {
  const { rows } = await pool.query(
    `INSERT INTO incident_addenda (incident_id, home_id, author, content)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [incidentId, homeId, author, content]
  );
  return rows[0];
}

/**
 * Get all addenda for an incident, oldest first.
 * @param {string} incidentId
 * @param {number} homeId
 */
export async function getAddenda(incidentId, homeId) {
  const { rows } = await pool.query(
    `SELECT id, author, content, created_at
     FROM incident_addenda
     WHERE incident_id = $1 AND home_id = $2
     ORDER BY created_at ASC`,
    [incidentId, homeId]
  );
  return rows;
}

// ── Individual CRUD (Mode 2 endpoints) ────────────────────────────────────────

import { randomUUID } from 'crypto';

export async function findById(id, homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM incidents WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL',
    [id, homeId]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

/**
 * Create or update a single incident.
 * If data.id is provided and the row exists, it updates (unless frozen).
 * If data.id is omitted, a new UUID-based ID is generated.
 */
export async function upsert(homeId, data) {
  const id = data.id || `inc-${randomUUID()}`;
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO incidents (
       id, home_id, date, time, location, type, severity, description,
       person_affected, person_affected_name, staff_involved, immediate_action,
       medical_attention, hospital_attendance,
       cqc_notifiable, cqc_notification_type, cqc_notification_deadline,
       cqc_notified, cqc_notified_date, cqc_reference,
       riddor_reportable, riddor_category, riddor_reported, riddor_reported_date, riddor_reference,
       safeguarding_referral, safeguarding_to, safeguarding_reference, safeguarding_date,
       witnesses, duty_of_candour_applies, candour_notification_date, candour_letter_sent_date, candour_recipient,
       police_involved, police_reference, police_contact_date,
       msp_wishes_recorded, msp_outcome_preferences, msp_person_involved,
       investigation_status, investigation_start_date, investigation_lead,
       investigation_review_date, root_cause, lessons_learned, investigation_closed_date,
       corrective_actions, reported_by, reported_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
       $41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51
     )
     ON CONFLICT (home_id, id) DO UPDATE SET
       date=$3,time=$4,location=$5,type=$6,severity=$7,description=$8,
       person_affected=$9,person_affected_name=$10,staff_involved=$11,immediate_action=$12,
       medical_attention=$13,hospital_attendance=$14,
       cqc_notifiable=$15,cqc_notification_type=$16,cqc_notification_deadline=$17,
       cqc_notified=$18,cqc_notified_date=$19,cqc_reference=$20,
       riddor_reportable=$21,riddor_category=$22,riddor_reported=$23,riddor_reported_date=$24,riddor_reference=$25,
       safeguarding_referral=$26,safeguarding_to=$27,safeguarding_reference=$28,safeguarding_date=$29,
       witnesses=$30,duty_of_candour_applies=$31,candour_notification_date=$32,candour_letter_sent_date=$33,candour_recipient=$34,
       police_involved=$35,police_reference=$36,police_contact_date=$37,
       msp_wishes_recorded=$38,msp_outcome_preferences=$39,msp_person_involved=$40,
       investigation_status=$41,investigation_start_date=$42,investigation_lead=$43,
       investigation_review_date=$44,root_cause=$45,lessons_learned=$46,investigation_closed_date=$47,
       corrective_actions=$48,reported_by=$49,reported_at=$50,updated_at=$51,
       deleted_at=NULL
     WHERE incidents.frozen_at IS NULL
     RETURNING *`,
    [
      id, homeId, data.date || null, data.time || null, data.location || null,
      data.type || null, data.severity || null, data.description || null,
      data.person_affected || null, data.person_affected_name || null,
      JSON.stringify(data.staff_involved || []), data.immediate_action || null,
      data.medical_attention || false, data.hospital_attendance || false,
      data.cqc_notifiable || false, data.cqc_notification_type || null,
      data.cqc_notification_deadline || null,
      data.cqc_notified || false, data.cqc_notified_date || null, data.cqc_reference || null,
      data.riddor_reportable || false, data.riddor_category || null,
      data.riddor_reported || false, data.riddor_reported_date || null, data.riddor_reference || null,
      data.safeguarding_referral || false, data.safeguarding_to || null,
      data.safeguarding_reference || null, data.safeguarding_date || null,
      JSON.stringify(data.witnesses || []), data.duty_of_candour_applies || false,
      data.candour_notification_date || null, data.candour_letter_sent_date || null,
      data.candour_recipient || null, data.police_involved || false,
      data.police_reference || null, data.police_contact_date || null,
      data.msp_wishes_recorded ?? false, data.msp_outcome_preferences || null,
      data.msp_person_involved ?? null,
      data.investigation_status || 'open', data.investigation_start_date || null,
      data.investigation_lead || null, data.investigation_review_date || null,
      data.root_cause || null, data.lessons_learned || null, data.investigation_closed_date || null,
      JSON.stringify(data.corrective_actions || []),
      data.reported_by || null, data.reported_at || now, now,
    ]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

// Column name whitelist for dynamic SQL
const ALLOWED_COLUMNS = new Set([
  'date', 'time', 'location', 'type', 'severity', 'description',
  'person_affected', 'person_affected_name', 'staff_involved', 'immediate_action',
  'medical_attention', 'hospital_attendance',
  'cqc_notifiable', 'cqc_notification_type', 'cqc_notification_deadline',
  'cqc_notified', 'cqc_notified_date', 'cqc_reference',
  'riddor_reportable', 'riddor_category', 'riddor_reported', 'riddor_reported_date', 'riddor_reference',
  'safeguarding_referral', 'safeguarding_to', 'safeguarding_reference', 'safeguarding_date',
  'witnesses', 'duty_of_candour_applies', 'candour_notification_date', 'candour_letter_sent_date', 'candour_recipient',
  'police_involved', 'police_reference', 'police_contact_date',
  'msp_wishes_recorded', 'msp_outcome_preferences', 'msp_person_involved',
  'investigation_status', 'investigation_start_date', 'investigation_lead',
  'investigation_review_date', 'root_cause', 'lessons_learned', 'investigation_closed_date',
  'corrective_actions',
]);

// Fields that need JSON.stringify before binding
const JSON_COLUMNS = new Set(['staff_involved', 'witnesses', 'corrective_actions']);

export async function update(id, homeId, data) {
  const fields = Object.entries(data).filter(
    ([k, v]) => v !== undefined && ALLOWED_COLUMNS.has(k)
  );
  if (fields.length === 0) return null;

  const setClause = fields.map(([k], i) => `${k} = $${i + 3}`).join(', ');
  const values = fields.map(([k, v]) => JSON_COLUMNS.has(k) ? JSON.stringify(v) : v);
  const { rows } = await pool.query(
    `UPDATE incidents SET ${setClause}, updated_at = NOW()
     WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL AND frozen_at IS NULL
     RETURNING *`,
    [id, homeId, ...values]
  );
  return rows[0] ? shapeRow(rows[0]) : null;
}

export async function softDelete(id, homeId) {
  const { rowCount } = await pool.query(
    `UPDATE incidents SET deleted_at = NOW()
     WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL AND frozen_at IS NULL`,
    [id, homeId]
  );
  return rowCount > 0;
}
