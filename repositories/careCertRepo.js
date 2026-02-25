import { pool } from '../db.js';

function shapeRow(row) {
  const shaped = {};
  for (const col of ['start_date', 'expected_completion', 'completion_date']) {
    shaped[col] = row[col] instanceof Date ? row[col].toISOString().slice(0, 10) : row[col];
  }
  shaped.supervisor = row.supervisor;
  shaped.status = row.status;
  // standards stored as JSONB — pg returns it already parsed
  shaped.standards = row.standards || {};
  return { staffId: row.staff_id, data: shaped };
}

export async function findByHome(homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM care_certificates WHERE home_id = $1',
    [homeId]
  );
  // Shape to: { "staffId": { start_date, expected_completion, supervisor, status, completion_date, standards } }
  const result = {};
  for (const row of rows) {
    const { staffId, data } = shapeRow(row);
    result[staffId] = data;
  }
  return result;
}

export async function sync(homeId, certObj, client) {
  const conn = client || pool;
  if (!certObj) return;

  for (const [staffId, cert] of Object.entries(certObj)) {
    await conn.query(
      `INSERT INTO care_certificates (
         home_id, staff_id, start_date, expected_completion, supervisor,
         status, completion_date, standards
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (home_id, staff_id) DO UPDATE SET
         start_date=$3,expected_completion=$4,supervisor=$5,
         status=$6,completion_date=$7,standards=$8`,
      [
        homeId, staffId,
        cert.start_date || null, cert.expected_completion || null,
        cert.supervisor || null, cert.status || null,
        cert.completion_date || null,
        JSON.stringify(cert.standards || {}),
      ]
    );
  }

  // Remove staff who no longer have a care cert record
  const staffIds = Object.keys(certObj);
  if (staffIds.length > 0) {
    await conn.query(
      `DELETE FROM care_certificates WHERE home_id = $1 AND staff_id != ALL($2::text[])`,
      [homeId, staffIds]
    );
  } else {
    await conn.query(`DELETE FROM care_certificates WHERE home_id = $1`, [homeId]);
  }
}
