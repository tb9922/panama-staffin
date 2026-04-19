import { pool } from '../db.js';

const COLS = `id, home_id, staff_id, date, kind, hours, note, source, version, created_at, updated_at`;

function toDateStr(value) {
  return value
    ? (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10))
    : null;
}

function toTs(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function shapeRow(row) {
  return {
    id: row.id,
    home_id: row.home_id,
    staff_id: row.staff_id,
    date: toDateStr(row.date),
    kind: row.kind,
    hours: row.hours != null ? parseFloat(row.hours) : 0,
    note: row.note || null,
    source: row.source || 'manual',
    version: row.version ?? 1,
    created_at: toTs(row.created_at),
    updated_at: toTs(row.updated_at),
  };
}

export function toAdjustmentMap(rows) {
  const map = {};
  for (const row of rows) {
    if (!map[row.date]) map[row.date] = {};
    map[row.date][row.staff_id] = {
      kind: row.kind,
      hours: row.hours,
      note: row.note,
      source: row.source,
      version: row.version,
      id: row.id,
    };
  }
  return map;
}

export async function findByHomePeriod(homeId, start, end, staffId = null, client) {
  const conn = client || pool;
  const params = [homeId, start, end];
  let staffClause = '';
  if (staffId) {
    params.push(staffId);
    staffClause = ` AND staff_id = $${params.length}`;
  }
  const { rows } = await conn.query(
    `SELECT ${COLS}
       FROM shift_hour_adjustments
      WHERE home_id = $1
        AND date >= $2
        AND date <= $3${staffClause}
      ORDER BY date, staff_id`,
    params,
  );
  return rows.map(shapeRow);
}

export async function findMapByHomePeriod(homeId, start, end, staffId = null, client) {
  const rows = await findByHomePeriod(homeId, start, end, staffId, client);
  return toAdjustmentMap(rows);
}

export async function findByStaffDate(homeId, staffId, date, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS}
       FROM shift_hour_adjustments
      WHERE home_id = $1 AND staff_id = $2 AND date = $3`,
    [homeId, staffId, date],
  );
  return rows.length > 0 ? shapeRow(rows[0]) : null;
}

export async function upsert(homeId, adjustment, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO shift_hour_adjustments (home_id, staff_id, date, kind, hours, note, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (home_id, staff_id, date) DO UPDATE SET
       kind = EXCLUDED.kind,
       hours = EXCLUDED.hours,
       note = EXCLUDED.note,
       source = EXCLUDED.source,
       version = shift_hour_adjustments.version + 1,
       updated_at = NOW()
     RETURNING ${COLS}`,
    [
      homeId,
      adjustment.staff_id,
      adjustment.date,
      adjustment.kind,
      adjustment.hours,
      adjustment.note ?? null,
      adjustment.source ?? 'manual',
    ],
  );
  return shapeRow(rows[0]);
}

export async function deleteOne(homeId, staffId, date, client) {
  const conn = client || pool;
  const { rowCount } = await conn.query(
    `DELETE FROM shift_hour_adjustments
      WHERE home_id = $1 AND staff_id = $2 AND date = $3`,
    [homeId, staffId, date],
  );
  return rowCount > 0;
}
