import { pool, toDateStr } from '../db.js';

function shapeRow(row) {
  return {
    id:                      row.id,
    date:                    toDateStr(row.date),
    time:                    row.time || undefined,
    scenario:                row.scenario || undefined,
    evacuation_time_seconds: row.evacuation_time_seconds ?? undefined,
    staff_present:           row.staff_present || [],
    residents_evacuated:     row.residents_evacuated ?? undefined,
    issues:                  row.issues || undefined,
    corrective_actions:      row.corrective_actions || undefined,
    conducted_by:            row.conducted_by || undefined,
    notes:                   row.notes || undefined,
    updated_at:              row.updated_at ? row.updated_at.toISOString() : undefined,
  };
}

/**
 * Return all fire drill records for a home.
 * @param {number} homeId
 */
export async function findByHome(homeId) {
  const { rows } = await pool.query(
    `SELECT * FROM fire_drills WHERE home_id = $1 AND deleted_at IS NULL ORDER BY date DESC`,
    [homeId]
  );
  return rows.map(shapeRow);
}

/**
 * Sync fire drill records. Upserts incoming, hard-deletes removed drills.
 * @param {number} homeId
 * @param {Array} drillsArr
 * @param {object} [client]
 */
export async function sync(homeId, drillsArr, client) {
  const conn = client || pool;
  if (!drillsArr) return;

  const incomingIds = drillsArr.map(d => d.id);

  const COLS_PER_ROW = 11; // 11 parameterised + NOW() literal
  const CHUNK = Math.floor(65000 / COLS_PER_ROW);
  for (let i = 0; i < drillsArr.length; i += CHUNK) {
    const chunk = drillsArr.slice(i, i + CHUNK);
    const placeholders = [];
    const values = [];
    chunk.forEach((d, j) => {
      const b = j * COLS_PER_ROW + 2;
      placeholders.push(
        `($${b},$1,$${b+1},$${b+2},$${b+3},$${b+4},$${b+5},` +
        `$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},NOW())`
      );
      values.push(
        d.id, d.date, d.time || null, d.scenario || null,
        d.evacuation_time_seconds ?? null,
        JSON.stringify(d.staff_present || []),
        d.residents_evacuated ?? null, d.issues || null,
        d.corrective_actions || null, d.conducted_by || null, d.notes || null,
      );
    });
    await conn.query(
      `INSERT INTO fire_drills
         (id, home_id, date, time, scenario, evacuation_time_seconds, staff_present,
          residents_evacuated, issues, corrective_actions, conducted_by, notes, updated_at)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (home_id, id) DO UPDATE SET
         date=EXCLUDED.date,time=EXCLUDED.time,scenario=EXCLUDED.scenario,
         evacuation_time_seconds=EXCLUDED.evacuation_time_seconds,staff_present=EXCLUDED.staff_present,
         residents_evacuated=EXCLUDED.residents_evacuated,issues=EXCLUDED.issues,
         corrective_actions=EXCLUDED.corrective_actions,conducted_by=EXCLUDED.conducted_by,
         notes=EXCLUDED.notes,updated_at=NOW(),deleted_at=NULL`,
      [homeId, ...values]
    );
  }

  if (incomingIds.length === 0) {
    // Empty payload guard: never wipe all records
    return;
  }
  await conn.query(
    `UPDATE fire_drills SET deleted_at = NOW()
     WHERE home_id = $1 AND id != ALL($2::text[]) AND deleted_at IS NULL`,
    [homeId, incomingIds]
  );
}

export async function upsertDrill(homeId, record) {
  const { rows } = await pool.query(
    `INSERT INTO fire_drills
       (id, home_id, date, time, scenario, evacuation_time_seconds, staff_present,
        residents_evacuated, issues, corrective_actions, conducted_by, notes, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
     ON CONFLICT (home_id, id) DO UPDATE SET
       date=EXCLUDED.date, time=EXCLUDED.time, scenario=EXCLUDED.scenario,
       evacuation_time_seconds=EXCLUDED.evacuation_time_seconds, staff_present=EXCLUDED.staff_present,
       residents_evacuated=EXCLUDED.residents_evacuated, issues=EXCLUDED.issues,
       corrective_actions=EXCLUDED.corrective_actions,
       conducted_by=EXCLUDED.conducted_by, notes=EXCLUDED.notes, updated_at=NOW(), deleted_at=NULL
     RETURNING *`,
    [record.id, homeId, record.date, record.time || null, record.scenario || null,
     record.evacuation_time_seconds ?? null,
     JSON.stringify(record.staff_present || []),
     record.residents_evacuated ?? null, record.issues || null,
     record.corrective_actions || null, record.conducted_by || null, record.notes || null]
  );
  return shapeRow(rows[0]);
}

export async function removeDrill(homeId, id) {
  const { rowCount } = await pool.query(
    'UPDATE fire_drills SET deleted_at=NOW() WHERE home_id=$1 AND id=$2 AND deleted_at IS NULL',
    [homeId, id]
  );
  return rowCount > 0;
}
