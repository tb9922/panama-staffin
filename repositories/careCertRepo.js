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
  shaped.updated_at = row.updated_at ? row.updated_at.toISOString() : undefined;
  return { staffId: row.staff_id, data: shaped };
}

export async function findByHome(homeId) {
  const { rows } = await pool.query(
    'SELECT * FROM care_certificates WHERE home_id = $1 AND deleted_at IS NULL',
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
         status, completion_date, standards, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (home_id, staff_id) DO UPDATE SET
         start_date=EXCLUDED.start_date,expected_completion=EXCLUDED.expected_completion,supervisor=EXCLUDED.supervisor,
         status=EXCLUDED.status,completion_date=EXCLUDED.completion_date,standards=EXCLUDED.standards,updated_at=NOW()`,
      [
        homeId, staffId,
        cert.start_date || null, cert.expected_completion || null,
        cert.supervisor || null, cert.status || null,
        cert.completion_date || null,
        JSON.stringify(cert.standards || {}),
      ]
    );
  }

  // Soft-delete staff who no longer have a care cert record
  const staffIds = Object.keys(certObj);
  if (staffIds.length === 0) {
    // Empty payload guard: never wipe all records
    return;
  }
  await conn.query(
    `UPDATE care_certificates SET deleted_at = NOW()
     WHERE home_id = $1 AND staff_id != ALL($2::text[]) AND deleted_at IS NULL`,
    [homeId, staffIds]
  );
}

export async function upsertStaff(homeId, staffId, record) {
  const { rows } = await pool.query(
    `INSERT INTO care_certificates
       (home_id, staff_id, start_date, expected_completion, supervisor, status, completion_date, standards, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (home_id, staff_id) DO UPDATE SET
       start_date=EXCLUDED.start_date, expected_completion=EXCLUDED.expected_completion, supervisor=EXCLUDED.supervisor,
       status=EXCLUDED.status, completion_date=EXCLUDED.completion_date, standards=EXCLUDED.standards, updated_at=NOW()
     RETURNING *`,
    [homeId, staffId,
     record.start_date || null, record.expected_completion || null,
     record.supervisor || null, record.status || null,
     record.completion_date || null, JSON.stringify(record.standards || {})]
  );
  const { data } = shapeRow(rows[0]);
  return data;
}

export async function removeStaff(homeId, staffId) {
  const { rowCount } = await pool.query(
    'UPDATE care_certificates SET deleted_at=NOW() WHERE home_id=$1 AND staff_id=$2 AND deleted_at IS NULL',
    [homeId, staffId]
  );
  return rowCount > 0;
}
