import { pool } from '../db.js';

const SAFE_COLUMNS = 'id, username, role, display_name, active, is_platform_admin, created_at, updated_at, last_login_at, created_by';

export async function findByUsername(username) {
  const { rows } = await pool.query(
    'SELECT id, username, password_hash, role, display_name, active, is_platform_admin, last_login_at, failed_login_count, locked_until FROM users WHERE username = $1',
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

export async function findByHome(homeId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.active, u.is_platform_admin,
            uhr.role_id, uhr.staff_id, uhr.granted_by, uhr.granted_at
     FROM users u
     JOIN user_home_roles uhr ON uhr.username = u.username AND uhr.home_id = $1
     ORDER BY
       CASE uhr.role_id
         WHEN 'home_manager' THEN 1
         WHEN 'deputy_manager' THEN 2
         WHEN 'training_lead' THEN 3
         WHEN 'finance_officer' THEN 4
         WHEN 'hr_officer' THEN 5
         WHEN 'shift_coordinator' THEN 6
         WHEN 'viewer' THEN 7
         WHEN 'staff_member' THEN 8
       END, u.display_name`,
    [homeId]
  );
  return rows;
}

export async function findByIdAtHome(id, homeId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.active, u.is_platform_admin,
            uhr.role_id, uhr.staff_id
     FROM users u
     JOIN user_home_roles uhr ON uhr.username = u.username AND uhr.home_id = $2
     WHERE u.id = $1`,
    [id, homeId]
  );
  return rows[0] || null;
}

export async function create(username, passwordHash, role, displayName, createdBy, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
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
  if (fields.is_platform_admin !== undefined) { sets.push(`is_platform_admin = $${idx++}`); vals.push(fields.is_platform_admin); }

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

export async function existsByUsername(username, client) {
  const conn = client || pool;
  const { rows } = await conn.query(
    'SELECT 1 FROM users WHERE username = $1 LIMIT 1',
    [username]
  );
  return rows.length > 0;
}

export async function incrementFailedLogin(username) {
  await pool.query(
    `UPDATE users SET failed_login_count = failed_login_count + 1,
       locked_until = CASE WHEN failed_login_count + 1 >= 5
         THEN NOW() + INTERVAL '30 minutes' ELSE locked_until END
     WHERE username = $1`,
    [username]
  );
}

export async function resetFailedLogin(username) {
  await pool.query(
    'UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE username = $1',
    [username]
  );
}
