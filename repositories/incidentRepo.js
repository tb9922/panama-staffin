import { pool } from '../db.js';

function shapeRow(row) {
  const shaped = { ...row };
  // Convert Date objects to ISO strings
  for (const col of ['date', 'cqc_notified_date', 'riddor_reported_date', 'safeguarding_date',
    'candour_notification_date', 'candour_letter_sent_date', 'police_contact_date',
    'investigation_start_date', 'investigation_review_date', 'investigation_closed_date',
    'reported_at', 'updated_at']) {
    if (shaped[col] instanceof Date) shaped[col] = shaped[col].toISOString().slice(0, 10);
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
         deleted_at=NULL`,
      [
        inc.id, homeId, inc.date || null, inc.time || null, inc.location || null,
        inc.type || null, inc.severity || null, inc.description || null,
        inc.person_affected || null, inc.person_affected_name || null,
        JSON.stringify(inc.staff_involved || []), inc.immediate_action || null,
        inc.medical_attention || null, inc.hospital_attendance || null,
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
        inc.msp_wishes_recorded || null, inc.msp_outcome_preferences || null,
        inc.msp_person_involved || null,
        inc.investigation_status || 'open', inc.investigation_start_date || null,
        inc.investigation_lead || null, inc.investigation_review_date || null,
        inc.root_cause || null, inc.lessons_learned || null, inc.investigation_closed_date || null,
        JSON.stringify(inc.corrective_actions || []),
        inc.reported_by || null, inc.reported_at || null, inc.updated_at || null,
      ]
    );
  }

  // Soft-delete records removed from the frontend
  if (incomingIds.length > 0) {
    await conn.query(
      `UPDATE incidents SET deleted_at = NOW()
       WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL`,
      [homeId, incomingIds]
    );
  } else {
    await conn.query(
      `UPDATE incidents SET deleted_at = NOW() WHERE home_id = $1 AND deleted_at IS NULL`,
      [homeId]
    );
  }
}
