import { pool, toDateStr } from '../db.js';

const COLS = `id, home_id, staff_id, clock_type, server_time, client_time,
  lat, lng, accuracy_m, distance_m, within_geofence, source,
  shift_date, expected_shift, approved, approved_by, approved_at, note, created_at`;
const SELECT_COLS = `c.id, c.home_id, c.staff_id, c.clock_type, c.server_time, c.client_time,
  c.lat, c.lng, c.accuracy_m, c.distance_m, c.within_geofence, c.source,
  c.shift_date, c.expected_shift, c.approved, c.approved_by, c.approved_at, c.note, c.created_at`;

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    homeId: row.home_id,
    staffId: row.staff_id,
    clockType: row.clock_type,
    serverTime: row.server_time instanceof Date ? row.server_time.toISOString() : row.server_time,
    clientTime: row.client_time instanceof Date ? row.client_time.toISOString() : row.client_time,
    lat: row.lat != null ? parseFloat(row.lat) : null,
    lng: row.lng != null ? parseFloat(row.lng) : null,
    accuracyM: row.accuracy_m != null ? parseFloat(row.accuracy_m) : null,
    distanceM: row.distance_m != null ? parseFloat(row.distance_m) : null,
    withinGeofence: row.within_geofence,
    source: row.source,
    shiftDate: toDateStr(row.shift_date),
    expectedShift: row.expected_shift,
    approved: row.approved === true,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at instanceof Date ? row.approved_at.toISOString() : row.approved_at,
    note: row.note,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    staffName: row.staff_name || null,
  };
}

export async function create(data, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO clock_ins (
        home_id, staff_id, clock_type, client_time, lat, lng, accuracy_m,
        distance_m, within_geofence, source, shift_date, expected_shift, note
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING ${COLS}`,
    [
      data.homeId,
      data.staffId,
      data.clockType,
      data.clientTime ?? null,
      data.lat ?? null,
      data.lng ?? null,
      data.accuracyM ?? null,
      data.distanceM ?? null,
      data.withinGeofence ?? null,
      data.source ?? 'gps',
      data.shiftDate,
      data.expectedShift ?? null,
      data.note ?? null,
    ],
  );
  return shape(rows[0]);
}

export async function approve({ homeId, id, approvedBy }, client = pool) {
  const { rows } = await client.query(
    `UPDATE clock_ins
        SET approved = TRUE,
            approved_by = $3,
            approved_at = NOW()
      WHERE home_id = $1
        AND id = $2
        AND approved = FALSE
      RETURNING ${COLS}`,
    [homeId, id, approvedBy],
  );
  return shape(rows[0]);
}

export async function findById(homeId, id, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM clock_ins WHERE home_id = $1 AND id = $2 LIMIT 1`,
    [homeId, id],
  );
  return shape(rows[0]);
}

export async function findLastForStaff(homeId, staffId, shiftDate, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM clock_ins
      WHERE home_id = $1
        AND staff_id = $2
        AND shift_date = $3
      ORDER BY server_time DESC
      LIMIT 1`,
    [homeId, staffId, shiftDate],
  );
  return shape(rows[0]);
}

export async function findLatestApprovedInBefore(homeId, staffId, shiftDate, beforeTime, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM clock_ins
      WHERE home_id = $1
        AND staff_id = $2
        AND shift_date = $3
        AND clock_type = 'in'
        AND approved = TRUE
        AND server_time < $4
      ORDER BY server_time DESC
      LIMIT 1`,
    [homeId, staffId, shiftDate, beforeTime],
  );
  return shape(rows[0]);
}

export async function findByDate(homeId, shiftDate, client = pool) {
  const { rows } = await client.query(
    `SELECT ${SELECT_COLS}, s.name AS staff_name
       FROM clock_ins c
       LEFT JOIN staff s ON s.home_id = c.home_id AND s.id = c.staff_id
      WHERE c.home_id = $1
        AND c.shift_date = $2
      ORDER BY c.server_time ASC, c.id ASC`,
    [homeId, shiftDate],
  );
  return rows.map(shape);
}

export async function findUnapproved(homeId, { limit = 200 } = {}, client = pool) {
  const { rows } = await client.query(
    `SELECT ${SELECT_COLS}, s.name AS staff_name
       FROM clock_ins c
       LEFT JOIN staff s ON s.home_id = c.home_id AND s.id = c.staff_id
      WHERE c.home_id = $1
        AND c.approved = FALSE
      ORDER BY c.server_time DESC, c.id DESC
      LIMIT $2`,
    [homeId, limit],
  );
  return rows.map(shape);
}
