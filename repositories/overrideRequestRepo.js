import { pool, toDateStr } from '../db.js';

const COLS = `id, home_id, staff_id, request_type, date, requested_shift, al_hours,
  swap_with_staff, reason, status, submitted_at, decided_by, decided_at, decision_note, version`;

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    homeId: row.home_id,
    staffId: row.staff_id,
    requestType: row.request_type,
    date: toDateStr(row.date),
    requestedShift: row.requested_shift,
    alHours: row.al_hours != null ? parseFloat(row.al_hours) : null,
    swapWithStaff: row.swap_with_staff,
    reason: row.reason,
    status: row.status,
    submittedAt: row.submitted_at instanceof Date ? row.submitted_at.toISOString() : row.submitted_at,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at instanceof Date ? row.decided_at.toISOString() : row.decided_at,
    decisionNote: row.decision_note,
    version: Number.parseInt(row.version, 10) || 0,
  };
}

export async function create(data, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO override_requests (home_id, staff_id, request_type, date, requested_shift, al_hours, swap_with_staff, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING ${COLS}`,
    [
      data.homeId,
      data.staffId,
      data.requestType,
      data.date,
      data.requestedShift ?? null,
      data.alHours ?? null,
      data.swapWithStaff ?? null,
      data.reason ?? null,
    ],
  );
  return shape(rows[0]);
}

export async function findById(homeId, id, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM override_requests WHERE home_id = $1 AND id = $2 LIMIT 1`,
    [homeId, id],
  );
  return shape(rows[0]);
}

export async function findByStaff(homeId, staffId, { limit = 100 } = {}, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM override_requests
      WHERE home_id = $1 AND staff_id = $2
      ORDER BY submitted_at DESC
      LIMIT $3`,
    [homeId, staffId, limit],
  );
  return rows.map(shape);
}

export async function findPending(homeId, { limit = 200 } = {}, client = pool) {
  const { rows } = await client.query(
    `SELECT ${COLS}
       FROM override_requests
      WHERE home_id = $1 AND status = 'pending'
      ORDER BY submitted_at ASC
      LIMIT $2`,
    [homeId, limit],
  );
  return rows.map(shape);
}

export async function decide({ homeId, id, status, decidedBy, decisionNote, expectedVersion }, client = pool) {
  const { rows } = await client.query(
    `UPDATE override_requests
        SET status = $3,
            decided_by = $4,
            decided_at = NOW(),
            decision_note = $5,
            version = version + 1
      WHERE home_id = $1
        AND id = $2
        AND status = 'pending'
        AND version = $6
      RETURNING ${COLS}`,
    [homeId, id, status, decidedBy, decisionNote ?? null, expectedVersion],
  );
  return shape(rows[0]);
}

export async function cancelByStaff({ homeId, staffId, id, expectedVersion }, client = pool) {
  const { rows } = await client.query(
    `UPDATE override_requests
        SET status = 'cancelled',
            version = version + 1
      WHERE home_id = $1
        AND id = $2
        AND staff_id = $3
        AND status = 'pending'
        AND version = $4
      RETURNING ${COLS}`,
    [homeId, id, staffId, expectedVersion],
  );
  return shape(rows[0]);
}
