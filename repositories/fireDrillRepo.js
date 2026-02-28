import { pool } from '../db.js';

function shapeRow(row) {
  return {
    id:                      row.id,
    date:                    row.date ? row.date.toISOString().slice(0, 10) : null,
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

  for (const d of drillsArr) {
    await conn.query(
      `INSERT INTO fire_drills
         (id, home_id, date, time, scenario, evacuation_time_seconds, staff_present,
          residents_evacuated, issues, corrective_actions, conducted_by, notes, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
       ON CONFLICT (home_id, id) DO UPDATE SET
         date                    = EXCLUDED.date,
         time                    = EXCLUDED.time,
         scenario                = EXCLUDED.scenario,
         evacuation_time_seconds = EXCLUDED.evacuation_time_seconds,
         staff_present           = EXCLUDED.staff_present,
         residents_evacuated     = EXCLUDED.residents_evacuated,
         issues                  = EXCLUDED.issues,
         corrective_actions      = EXCLUDED.corrective_actions,
         conducted_by            = EXCLUDED.conducted_by,
         notes                   = EXCLUDED.notes,
         updated_at              = NOW()`,
      [
        d.id, homeId, d.date, d.time || null, d.scenario || null,
        d.evacuation_time_seconds ?? null,
        JSON.stringify(d.staff_present || []),
        d.residents_evacuated ?? null, d.issues || null,
        d.corrective_actions || null, d.conducted_by || null, d.notes || null,
      ]
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
       conducted_by=EXCLUDED.conducted_by, notes=EXCLUDED.notes, updated_at=NOW()
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
