import { pool, withTransaction } from '../db.js';

function shapeRow(row) {
  const toDateStr = (v) => v
    ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
    : null;
  const toTimeStr = (v) => v ? String(v).slice(0, 5) : null; // 'HH:MM:SS' → 'HH:MM'

  return {
    id: row.id,
    home_id: row.home_id,
    staff_id: row.staff_id,
    date: toDateStr(row.date),
    scheduled_start: toTimeStr(row.scheduled_start),
    scheduled_end: toTimeStr(row.scheduled_end),
    actual_start: toTimeStr(row.actual_start),
    actual_end: toTimeStr(row.actual_end),
    snapped_start: toTimeStr(row.snapped_start),
    snapped_end: toTimeStr(row.snapped_end),
    snap_applied: row.snap_applied,
    snap_minutes_saved: parseFloat(row.snap_minutes_saved ?? 0),
    break_minutes: row.break_minutes ?? 0,
    payable_hours: row.payable_hours != null ? parseFloat(row.payable_hours) : null,
    status: row.status,
    approved_by: row.approved_by,
    approved_at: row.approved_at instanceof Date ? row.approved_at.toISOString() : row.approved_at,
    dispute_reason: row.dispute_reason,
    notes: row.notes,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

/** All timesheet entries for a home on a specific date. */
export async function findByHomeAndDate(homeId, date) {
  const { rows } = await pool.query(
    `SELECT * FROM timesheet_entries WHERE home_id = $1 AND date = $2 ORDER BY staff_id`,
    [homeId, date],
  );
  return rows.map(shapeRow);
}

/** Single entry for a staff member on a date. Returns null if not found. */
export async function findByStaffDate(homeId, staffId, date, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT * FROM timesheet_entries WHERE home_id = $1 AND staff_id = $2 AND date = $3`,
    [homeId, staffId, date],
  );
  return rows.length > 0 ? shapeRow(rows[0]) : null;
}

/** All entries for a home within a date range, optionally filtered by status and staffId. */
export async function findByHomePeriod(homeId, start, end, status, staffId, client) {
  const conn = client || pool;
  const params = [homeId, start, end];
  let statusClause = '';
  let staffClause = '';
  if (status) {
    params.push(status);
    statusClause = ` AND status = $${params.length}`;
  }
  if (staffId) {
    params.push(staffId);
    staffClause = ` AND staff_id = $${params.length}`;
  }
  const { rows } = await conn.query(
    `SELECT * FROM timesheet_entries
     WHERE home_id = $1 AND date >= $2 AND date <= $3${statusClause}${staffClause}
     ORDER BY date, staff_id`,
    params,
  );
  return rows.map(shapeRow);
}

/** Upsert a timesheet entry. Uses ON CONFLICT to update if already exists. */
export async function upsert(homeId, entry, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO timesheet_entries
       (home_id, staff_id, date, scheduled_start, scheduled_end,
        actual_start, actual_end, snapped_start, snapped_end,
        snap_applied, snap_minutes_saved, break_minutes, payable_hours,
        status, notes, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
     ON CONFLICT (home_id, staff_id, date) DO UPDATE SET
       actual_start       = EXCLUDED.actual_start,
       actual_end         = EXCLUDED.actual_end,
       snapped_start      = EXCLUDED.snapped_start,
       snapped_end        = EXCLUDED.snapped_end,
       snap_applied       = EXCLUDED.snap_applied,
       snap_minutes_saved = EXCLUDED.snap_minutes_saved,
       break_minutes      = EXCLUDED.break_minutes,
       payable_hours      = EXCLUDED.payable_hours,
       status             = CASE WHEN timesheet_entries.status = 'locked' THEN timesheet_entries.status
                                 ELSE EXCLUDED.status END,
       notes              = EXCLUDED.notes,
       updated_at         = NOW()
     RETURNING *`,
    [
      homeId, entry.staff_id, entry.date,
      entry.scheduled_start || null, entry.scheduled_end || null,
      entry.actual_start || null, entry.actual_end || null,
      entry.snapped_start || null, entry.snapped_end || null,
      entry.snap_applied ?? false, entry.snap_minutes_saved ?? 0,
      entry.break_minutes ?? 0, entry.payable_hours ?? null,
      entry.status ?? 'pending', entry.notes || null,
    ],
  );
  return shapeRow(rows[0]);
}

/** Approve a single entry. Cannot approve locked entries. */
export async function approve(id, homeId, approvedBy, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE timesheet_entries
     SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
     WHERE id = $2 AND home_id = $3 AND status NOT IN ('locked')
     RETURNING *`,
    [approvedBy, id, homeId],
  );
  return rows.length > 0 ? shapeRow(rows[0]) : null;
}

/** Bulk approve all pending entries for a home on a date. */
export async function bulkApproveByDate(homeId, date, approvedBy, client) {
  const conn = client || pool;
  const { rowCount } = await conn.query(
    `UPDATE timesheet_entries
     SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
     WHERE home_id = $2 AND date = $3 AND status = 'pending'`,
    [approvedBy, homeId, date],
  );
  return rowCount;
}

/** Lock all approved entries for a home within a period (called on payroll approval). */
export async function lockByPeriod(homeId, periodStart, periodEnd, client) {
  const conn = client || pool;
  const { rowCount } = await conn.query(
    `UPDATE timesheet_entries
     SET status = 'locked', updated_at = NOW()
     WHERE home_id = $1 AND date >= $2 AND date <= $3 AND status = 'approved'`,
    [homeId, periodStart, periodEnd],
  );
  return rowCount;
}

/** Dispute an entry. */
export async function dispute(id, homeId, reason, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE timesheet_entries
     SET status = 'disputed', dispute_reason = $1, updated_at = NOW()
     WHERE id = $2 AND home_id = $3 AND status NOT IN ('locked')
     RETURNING *`,
    [reason, id, homeId],
  );
  return rows.length > 0 ? shapeRow(rows[0]) : null;
}

/** Sum of snap_minutes_saved for a home and date range — for dashboard metrics. */
export async function totalSnapSavings(homeId, start, end) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(snap_minutes_saved), 0) AS total_minutes,
            COUNT(*) FILTER (WHERE snap_applied) AS snap_count
     FROM timesheet_entries
     WHERE home_id = $1 AND date >= $2 AND date <= $3`,
    [homeId, start, end],
  );
  return {
    totalMinutes: parseFloat(rows[0].total_minutes),
    snapCount: parseInt(rows[0].snap_count, 10),
  };
}

/** Bulk upsert multiple timesheet entries in a single transaction. */
export async function bulkUpsert(homeId, entries, client) {
  if (!client) {
    return withTransaction(c => bulkUpsert(homeId, entries, c));
  }
  const conn = client || pool;
  const results = [];
  for (const entry of entries) {
    const { rows } = await conn.query(
      `INSERT INTO timesheet_entries
         (home_id, staff_id, date, scheduled_start, scheduled_end,
          actual_start, actual_end, snapped_start, snapped_end,
          snap_applied, snap_minutes_saved, break_minutes, payable_hours,
          status, notes, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
       ON CONFLICT (home_id, staff_id, date) DO UPDATE SET
         actual_start       = EXCLUDED.actual_start,
         actual_end         = EXCLUDED.actual_end,
         snapped_start      = EXCLUDED.snapped_start,
         snapped_end        = EXCLUDED.snapped_end,
         snap_applied       = EXCLUDED.snap_applied,
         snap_minutes_saved = EXCLUDED.snap_minutes_saved,
         break_minutes      = EXCLUDED.break_minutes,
         payable_hours      = EXCLUDED.payable_hours,
         status             = CASE WHEN timesheet_entries.status = 'locked' THEN timesheet_entries.status
                                   ELSE EXCLUDED.status END,
         notes              = EXCLUDED.notes,
         updated_at         = NOW()
       RETURNING *`,
      [
        homeId, entry.staff_id, entry.date,
        entry.scheduled_start || null, entry.scheduled_end || null,
        entry.actual_start || null, entry.actual_end || null,
        entry.snapped_start || null, entry.snapped_end || null,
        entry.snap_applied ?? false, entry.snap_minutes_saved ?? 0,
        entry.break_minutes ?? 0, entry.payable_hours ?? null,
        entry.status ?? 'pending', entry.notes || null,
      ],
    );
    results.push(shapeRow(rows[0]));
  }
  return results;
}

/** Approve all pending entries for a specific staff member within a date range. */
export async function approveByStaffRange(homeId, staffId, start, end, approvedBy, client) {
  const conn = client || pool;
  const { rowCount } = await conn.query(
    `UPDATE timesheet_entries
     SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
     WHERE home_id = $2 AND staff_id = $3 AND date >= $4 AND date <= $5 AND status = 'pending'`,
    [approvedBy, homeId, staffId, start, end],
  );
  return rowCount;
}
