import { pool, createShaper } from './shared.js';

const COLS = 'id, home_id, case_type, case_id, note_type, content, author, created_at';

const shapeNote = createShaper({
  fields: ['id', 'home_id', 'case_type', 'case_id', 'note_type', 'content', 'author', 'created_at'],
  timestamps: ['created_at'],
});

export async function findCaseNotes(homeId, caseType, caseId, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM hr_case_notes WHERE home_id = $1 AND case_type = $2 AND case_id = $3 ORDER BY created_at DESC`,
    [homeId, caseType, caseId]
  );
  return rows.map(shapeNote);
}

export async function createCaseNote(homeId, caseType, caseId, data, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    `INSERT INTO hr_case_notes (home_id, case_type, case_id, note_type, content, author)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [homeId, caseType, caseId, data.note_type ?? 'note', data.content, data.author]
  );
  return shapeNote(rows[0]);
}
