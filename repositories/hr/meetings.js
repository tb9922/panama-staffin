import { pool, createShaper } from './shared.js';

const COLS = `id, home_id, case_type, case_id,
  meeting_date, meeting_time, meeting_type, location, attendees,
  summary, key_points, outcome, recorded_by,
  created_at, updated_at, version`;

const shapeMeeting = createShaper({
  fields: [
    'id', 'home_id', 'case_type', 'case_id',
    'meeting_date', 'meeting_time', 'meeting_type', 'location', 'attendees',
    'summary', 'key_points', 'outcome', 'recorded_by',
    'created_at', 'updated_at', 'version',
  ],
  dates: ['meeting_date'],
  jsonArrays: ['attendees'],
});

export async function findMeetings(caseType, caseId, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM hr_investigation_meetings WHERE case_type = $1 AND case_id = $2 AND home_id = $3 ORDER BY meeting_date DESC, created_at DESC`,
    [caseType, caseId, homeId]
  );
  return rows.map(shapeMeeting);
}

export async function findMeetingById(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM hr_investigation_meetings WHERE id = $1 AND home_id = $2`,
    [id, homeId]
  );
  return rows[0] ? shapeMeeting(rows[0]) : null;
}

export async function createMeeting(homeId, caseType, caseId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_investigation_meetings (home_id, case_type, case_id, meeting_date, meeting_time, meeting_type, location, attendees, summary, key_points, outcome, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [homeId, caseType, caseId, data.meeting_date, data.meeting_time || null, data.meeting_type ?? 'interview', data.location || null,
     JSON.stringify(data.attendees || []), data.summary || null, data.key_points || null, data.outcome || null, data.recorded_by]
  );
  return shapeMeeting(rows[0]);
}

export async function updateMeeting(id, homeId, data, client, version) {
  const conn = client || pool;
  const fields = [];
  const vals = [];
  let n = 1;
  for (const key of ['meeting_date','meeting_time','meeting_type','location','summary','key_points','outcome']) {
    if (data[key] !== undefined) { fields.push(`${key} = $${n}`); vals.push(data[key]); n++; }
  }
  if (data.attendees !== undefined) { fields.push(`attendees = $${n}`); vals.push(JSON.stringify(data.attendees)); n++; }
  fields.push('version = version + 1');
  if (fields.length === 1) {
    const { rows } = await conn.query(`SELECT ${COLS} FROM hr_investigation_meetings WHERE id = $1 AND home_id = $2`, [id, homeId]);
    return shapeMeeting(rows[0]);
  }
  vals.push(id, homeId);
  let where = `WHERE id = $${n} AND home_id = $${n + 1}`;
  n += 2;
  if (version != null) { vals.push(version); where += ` AND version = $${n}`; n++; }
  const { rows, rowCount } = await conn.query(
    `UPDATE hr_investigation_meetings SET ${fields.join(', ')} ${where} RETURNING *`,
    vals
  );
  if (rowCount === 0 && version != null) return null;
  return shapeMeeting(rows[0]);
}
