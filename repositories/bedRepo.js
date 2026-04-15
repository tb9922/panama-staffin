import { pool } from '../db.js';
import { ConflictError } from '../errors.js';
import { toIsoOrNull } from '../lib/serverTimestamps.js';

const BED_COLS = 'id, home_id, room_number, room_name, room_type, floor, status, resident_id, status_since, hold_expires, reserved_until, booked_from, booked_until, notes, created_by, updated_by, created_at, updated_at';
const BED_SELECT = `b.${BED_COLS.split(', ').join(', b.')},
  fr.resident_name`;

function d(v) { return v instanceof Date ? v.toISOString().slice(0, 10) : v; }
const ts = toIsoOrNull;

// ── Shape ───────────────────────────────────────────────────────────────────

function shapeBed(row) {
  if (!row) return null;
  return {
    id: row.id,
    home_id: row.home_id,
    room_number: row.room_number,
    room_name: row.room_name,
    room_type: row.room_type,
    floor: row.floor,
    status: row.status,
    resident_id: row.resident_id,
    resident_name: row.resident_name || null,
    status_since: d(row.status_since),
    hold_expires: d(row.hold_expires),
    reserved_until: d(row.reserved_until),
    booked_from: d(row.booked_from),
    booked_until: d(row.booked_until),
    notes: row.notes,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: ts(row.created_at),
    updated_at: ts(row.updated_at),
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function findByHome(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `/* bedRepo – findByHome */
     SELECT ${BED_SELECT}
     FROM beds b
     LEFT JOIN finance_residents fr
       ON fr.id = b.resident_id
      AND fr.home_id = b.home_id
      AND fr.deleted_at IS NULL
     WHERE b.home_id = $1
     ORDER BY b.room_number ASC
     LIMIT 200`,
    [homeId]
  );
  return rows.map(shapeBed);
}

export async function findById(bedId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `/* bedRepo – findById */
     SELECT ${BED_SELECT}
     FROM beds b
     LEFT JOIN finance_residents fr
       ON fr.id = b.resident_id
      AND fr.home_id = b.home_id
      AND fr.deleted_at IS NULL
     WHERE b.id = $1 AND b.home_id = $2`,
    [bedId, homeId]
  );
  return shapeBed(rows[0]);
}

export async function findByIdForUpdate(bedId, homeId, client) {
  const { rows } = await client.query(
    `/* bedRepo – findByIdForUpdate */
     SELECT ${BED_COLS} FROM beds
     WHERE id = $1 AND home_id = $2
     FOR UPDATE`,
    [bedId, homeId]
  );
  return shapeBed(rows[0]);
}

export async function create(homeId, data, client) {
  const conn = client || pool;
  try {
    const { rows } = await conn.query(
      `/* bedRepo – create */
       INSERT INTO beds
         (home_id, room_number, room_name, room_type, floor, status,
          resident_id, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       RETURNING ${BED_COLS}`,
      [homeId, data.room_number, data.room_name || null,
       data.room_type || 'single', data.floor || null,
       data.status ?? 'available', data.resident_id || null,
       data.notes || null, data.created_by]
    );
    return shapeBed(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      if (err.constraint === 'uniq_beds_home_resident_occupied') {
        throw new ConflictError('Resident is already assigned to another occupied bed in this home');
      }
      throw new ConflictError('Room number already exists in this home');
    }
    throw err;
  }
}

export async function createMany(homeId, bedsArray, client) {
  if (!bedsArray.length) return [];
  const conn = client || pool;
  const values = [];
  const params = [];
  for (const bed of bedsArray) {
    const base = params.length;
    params.push(
      homeId,
      bed.room_number,
      bed.room_name || null,
      bed.room_type || 'single',
      bed.floor || null,
      bed.status ?? 'available',
      bed.resident_id || null,
      bed.notes || null,
      bed.created_by,
    );
    const p = (n) => `$${base + n}`;
    values.push(`(${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)},${p(7)},${p(8)},${p(9)},${p(9)})`);
  }
  try {
    const { rows } = await conn.query(
      `/* bedRepo – createMany */
       INSERT INTO beds
         (home_id, room_number, room_name, room_type, floor, status,
          resident_id, notes, created_by, updated_by)
       VALUES ${values.join(', ')}
       RETURNING ${BED_COLS}`,
      params,
    );
    return rows.map(shapeBed);
  } catch (err) {
    if (err.code === '23505') {
      if (err.constraint === 'uniq_beds_home_resident_occupied') {
        throw new ConflictError('Resident is already assigned to another occupied bed in this home');
      }
      throw new ConflictError('Room number already exists in this home');
    }
    throw err;
  }
}

export async function updateDetails(bedId, homeId, data, client) {
  const conn = client || pool;
  try {
    const { rows } = await conn.query(
      `/* bedRepo – updateDetails */
       UPDATE beds SET
         room_number = $3,
         room_name = $4,
         room_type = $5,
         floor = $6,
         notes = $7,
         updated_by = $8,
         updated_at = NOW()
       WHERE id = $1 AND home_id = $2
       RETURNING ${BED_COLS}`,
      [bedId, homeId,
       data.room_number,
       data.room_name || null,
       data.room_type || 'single',
       data.floor || null,
       data.notes || null,
       data.updated_by || null]
    );
    if (!rows[0]) return null;
    return findById(bedId, homeId, conn);
  } catch (err) {
    if (err.code === '23505') {
      throw new ConflictError('Room number already exists in this home');
    }
    throw err;
  }
}

export async function updateStatus(bedId, homeId, statusData, client) {
  const conn = client || pool;
  try {
    const params = [bedId, homeId];
    const fields = [];
    const settable = [
      'status',
      'resident_id',
      'status_since',
      'hold_expires',
      'reserved_until',
      'booked_from',
      'booked_until',
      'notes',
      'updated_by',
    ];
    for (const key of settable) {
      if (!Object.prototype.hasOwnProperty.call(statusData, key)) continue;
      params.push(statusData[key] ?? null);
      fields.push(`${key} = $${params.length}`);
    }
    if (fields.length === 0) return findById(bedId, homeId, conn);
    fields.push('updated_at = NOW()');
    const { rows } = await conn.query(
      `/* bedRepo – updateStatus */
       UPDATE beds SET
         ${fields.join(', ')}
       WHERE id = $1 AND home_id = $2
       RETURNING ${BED_COLS}`,
      params
    );
    return shapeBed(rows[0]);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'uniq_beds_home_resident_occupied') {
      throw new ConflictError('Resident is already assigned to another occupied bed in this home');
    }
    throw err;
  }
}

export async function deleteById(bedId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `/* bedRepo – deleteById */
     DELETE FROM beds
     WHERE id = $1 AND home_id = $2
     RETURNING ${BED_COLS}`,
    [bedId, homeId]
  );
  return shapeBed(rows[0]);
}


export async function getOccupancySummary(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `/* bedRepo – getOccupancySummary */
     SELECT
       COUNT(*)::int AS total,
       COALESCE(COUNT(*) FILTER (WHERE status = 'occupied'), 0)::int AS occupied,
       COALESCE(COUNT(*) FILTER (WHERE status = 'available'), 0)::int AS available,
       COALESCE(COUNT(*) FILTER (WHERE status = 'hospital_hold'), 0)::int AS hospital_hold,
       COALESCE(COUNT(*) FILTER (WHERE status = 'reserved'), 0)::int AS reserved,
       COALESCE(COUNT(*) FILTER (WHERE status = 'deep_clean'), 0)::int AS deep_clean,
       COALESCE(COUNT(*) FILTER (WHERE status = 'maintenance'), 0)::int AS maintenance,
       COALESCE(COUNT(*) FILTER (WHERE status = 'decommissioned'), 0)::int AS decommissioned
     FROM beds
     WHERE home_id = $1`,
    [homeId]
  );
  const r = rows[0];
  const usable = r.total - r.decommissioned;
  const occupancyRate = usable > 0
    ? Math.round((r.occupied / usable) * 10000) / 100
    : 100;
  return {
    total: r.total,
    occupied: r.occupied,
    available: r.available,
    hospitalHold: r.hospital_hold,
    reserved: r.reserved,
    deepClean: r.deep_clean,
    maintenance: r.maintenance,
    decommissioned: r.decommissioned,
    occupancyRate,
  };
}

export async function findExpiringHolds(homeId, withinDays = 7, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `/* bedRepo – findExpiringHolds */
     SELECT ${BED_COLS} FROM beds
     WHERE home_id = $1 AND status = 'hospital_hold'
       AND hold_expires IS NOT NULL
       AND hold_expires <= (CURRENT_DATE + make_interval(days => $2))
     ORDER BY hold_expires ASC`,
    [homeId, withinDays]
  );
  return rows.map(shapeBed);
}

export async function findStaleOccupants(homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `/* bedRepo – findStaleOccupants */
     SELECT b.id, b.home_id, b.room_number, b.room_name, b.room_type, b.floor,
            b.status, b.resident_id, b.status_since, b.hold_expires, b.reserved_until,
            b.booked_from, b.booked_until, b.notes, b.created_by, b.updated_by,
            b.created_at, b.updated_at
     FROM beds b
     INNER JOIN finance_residents fr ON fr.id = b.resident_id
     WHERE b.home_id = $1 AND fr.home_id = $1 AND b.status = 'occupied'
       AND fr.status IN ('discharged', 'deceased')`,
    [homeId]
  );
  return rows.map(shapeBed);
}

export async function findByResidentId(residentId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `/* bedRepo – findByResidentId */
     SELECT ${BED_COLS} FROM beds
     WHERE resident_id = $1 AND home_id = $2 AND status = 'occupied'`,
    [residentId, homeId]
  );
  return shapeBed(rows[0]);
}
