import { pool } from '../db.js';

function shapeRow(row) {
  const shaped = { ...row };
  for (const col of [
    'date_raised', 'acknowledgement_date', 'investigation_start_date',
    'follow_up_date', 'resolution_date', 'reported_at', 'updated_at',
  ]) {
    if (shaped[col] instanceof Date) shaped[col] = shaped[col].toISOString().slice(0, 10);
  }
  delete shaped.home_id;
  delete shaped.created_at;
  delete shaped.deleted_at;
  return shaped;
}

export async function findByHome(homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM whistleblowing_concerns WHERE home_id = $1 AND deleted_at IS NULL ORDER BY date_raised DESC NULLS LAST',
    [homeId]
  );
  return rows.map(shapeRow);
}

export async function sync(homeId, arr, client) {
  const conn = client || pool;
  if (!arr) return;
  const incomingIds = arr.map(c => c.id);

  for (const c of arr) {
    await conn.query(
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
         lessons_learned=$21,reported_at=$22,updated_at=$23,deleted_at=NULL`,
      [
        c.id, homeId, c.date_raised || null, c.raised_by_role || null,
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
      ]
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
