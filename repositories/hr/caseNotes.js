import { pool, createShaper } from './shared.js';

const COLS = 'id, home_id, case_type, case_id, note_type, content, author, subject_type, subject_id, created_at';

const shapeNote = createShaper({
  fields: ['id', 'home_id', 'case_type', 'case_id', 'note_type', 'content', 'author', 'subject_type', 'subject_id', 'created_at'],
  timestamps: ['created_at'],
});

const CASE_SUBJECT_SQL = {
  disciplinary: 'SELECT staff_id AS subject_id FROM hr_disciplinary_cases WHERE home_id = $1 AND id = $2',
  grievance: 'SELECT staff_id AS subject_id FROM hr_grievance_cases WHERE home_id = $1 AND id = $2',
  performance: 'SELECT staff_id AS subject_id FROM hr_performance_cases WHERE home_id = $1 AND id = $2',
};

const CASE_TABLES = {
  disciplinary: 'hr_disciplinary_cases',
  grievance: 'hr_grievance_cases',
  performance: 'hr_performance_cases',
  rtw_interview: 'hr_rtw_interviews',
  oh_referral: 'hr_oh_referrals',
  contract: 'hr_contracts',
  family_leave: 'hr_family_leave',
  flexible_working: 'hr_flexible_working',
  edi: 'hr_edi_records',
  tupe: 'hr_tupe_transfers',
  renewal: 'hr_rtw_dbs_renewals',
};

export async function caseExists(homeId, caseType, caseId, client) {
  const table = CASE_TABLES[caseType];
  if (!table) return false;
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT 1 FROM ${table} WHERE home_id = $1 AND id = $2 AND deleted_at IS NULL LIMIT 1`,
    [homeId, caseId]
  );
  return rows.length > 0;
}

async function resolveCaseSubject(homeId, caseType, caseId, conn) {
  const sql = CASE_SUBJECT_SQL[caseType];
  if (!sql) return { subject_type: null, subject_id: null };
  const { rows: [row] } = await conn.query(sql, [homeId, caseId]);
  if (!row?.subject_id) return { subject_type: null, subject_id: null };
  return { subject_type: 'staff', subject_id: row.subject_id };
}

export async function findCaseNotes(homeId, caseType, caseId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM hr_case_notes WHERE home_id = $1 AND case_type = $2 AND case_id = $3 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [homeId, caseType, caseId]
  );
  return rows.map(shapeNote);
}

export async function deleteCaseNote(id, homeId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `UPDATE hr_case_notes SET deleted_at = NOW() WHERE id = $1 AND home_id = $2 AND deleted_at IS NULL RETURNING ${COLS}`,
    [id, homeId]
  );
  return rows[0] ? shapeNote(rows[0]) : null;
}

export async function createCaseNote(homeId, caseType, caseId, data, client) {
  const conn = client || pool;
  const subject = await resolveCaseSubject(homeId, caseType, caseId, conn);
  const { rows } = await conn.query(
    `INSERT INTO hr_case_notes (home_id, case_type, case_id, note_type, content, author, subject_type, subject_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${COLS}`,
    [homeId, caseType, caseId, data.note_type ?? 'note', data.content, data.author, subject.subject_type, subject.subject_id]
  );
  return shapeNote(rows[0]);
}
