import { pool } from '../db.js';

const SAFE_COLUMNS = 'id, username, role, display_name, active, created_at, updated_at, last_login_at, created_by';

export async function findByUsername(username) {
  const { rows } = await pool.query(
    'SELECT id, username, password_hash, role, display_name, active, last_login_at FROM users WHERE username = $1',
    [username]
  );
  return rows[0] || null;
}

export async function findById(id) {
  const { rows } = await pool.query(
    `SELECT ${SAFE_COLUMNS} FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function listAll() {
  const { rows } = await pool.query(
    `SELECT ${SAFE_COLUMNS} FROM users ORDER BY username`
  );
  return rows;
}

export async function create(username, passwordHash, role, displayName, createdBy) {
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, role, display_name, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${SAFE_COLUMNS}`,
    [username, passwordHash, role, displayName || '', createdBy || null]
  );
  return rows[0];
}

export async function update(id, fields) {
  const sets = [];
  const vals = [];
  let idx = 1;

  if (fields.role !== undefined)         { sets.push(`role = $${idx++}`);         vals.push(fields.role); }
  if (fields.display_name !== undefined) { sets.push(`display_name = $${idx++}`); vals.push(fields.display_name); }
  if (fields.active !== undefined)       { sets.push(`active = $${idx++}`);       vals.push(fields.active); }

  if (sets.length === 0) return findById(id);

  sets.push(`updated_at = NOW()`);
  vals.push(id);

  const { rows } = await pool.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING ${SAFE_COLUMNS}`,
    vals
  );
  return rows[0] || null;
}

export async function updatePassword(id, newHash) {
  await pool.query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [newHash, id]
  );
}

export async function updateLastLogin(username) {
  await pool.query(
    'UPDATE users SET last_login_at = NOW() WHERE username = $1',
    [username]
  );
}

export async function countActiveAdmins() {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND active = true"
  );
  return rows[0].count;
}

export async function existsByUsername(username) {
  const { rows } = await pool.query(
    'SELECT 1 FROM users WHERE username = $1 LIMIT 1',
    [username]
  );
  return rows.length > 0;
}
