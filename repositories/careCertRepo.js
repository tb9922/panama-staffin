import { pool, toDateStr } from '../db.js';

function shapeRow(row) {
  const shaped = {};
  for (const col of ['start_date', 'expected_completion', 'completion_date']) {
    shaped[col] = toDateStr(row[col]);
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

  const flat = Object.entries(certObj).map(([staffId, cert]) => ({
    staffId,
    start_date: cert.start_date || null,
    expected_completion: cert.expected_completion || null,
    supervisor: cert.supervisor || null,
    status: cert.status || null,
    completion_date: cert.completion_date || null,
    standards: JSON.stringify(cert.standards || {}),
  }));

  const staffIds = flat.map(r => r.staffId);

  if (flat.length > 0) {
    const COLS_PER_ROW = 7;
    const CHUNK = Math.floor(65000 / COLS_PER_ROW);
    for (let i = 0; i < flat.length; i += CHUNK) {
      const chunk = flat.slice(i, i + CHUNK);
      const placeholders = [];
      const values = [];
      chunk.forEach((c, j) => {
        const b = j * COLS_PER_ROW + 2;
        placeholders.push(`($1,$${b},$${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},NOW())`);
        values.push(
          c.staffId, c.start_date, c.expected_completion,
          c.supervisor, c.status, c.completion_date, c.standards
        );
      });
      await conn.query(
        `INSERT INTO care_certificates (
           home_id, staff_id, start_date, expected_completion, supervisor,
           status, completion_date, standards, updated_at
         ) VALUES ${placeholders.join(',')}
         ON CONFLICT (home_id, staff_id) DO UPDATE SET
           start_date=EXCLUDED.start_date,expected_completion=EXCLUDED.expected_completion,supervisor=EXCLUDED.supervisor,
           status=EXCLUDED.status,completion_date=EXCLUDED.completion_date,standards=EXCLUDED.standards,updated_at=NOW()`,
        [homeId, ...values]
      );
    }
  }

  // Soft-delete staff who no longer have a care cert record
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
       (home_id, staff_id, start_date, expected_completion, supervisor, status, completion_date, standards, updated_at, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NULL)
     ON CONFLICT (home_id, staff_id) DO UPDATE SET
       start_date=EXCLUDED.start_date, expected_completion=EXCLUDED.expected_completion, supervisor=EXCLUDED.supervisor,
       status=EXCLUDED.status, completion_date=EXCLUDED.completion_date, standards=EXCLUDED.standards, updated_at=NOW(),
       deleted_at=NULL
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
