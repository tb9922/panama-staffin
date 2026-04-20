import { pool } from '../db.js';

const CREDENTIAL_COLS = `sac.home_id, sac.staff_id, sac.username, sac.password_hash,
  sac.last_login_at, sac.failed_login_count, sac.locked_until, sac.session_version,
  sac.created_at, sac.updated_at,
  s.name AS staff_name, s.active AS staff_active, s.deleted_at AS staff_deleted_at,
  h.slug AS home_slug, h.name AS home_name, h.config AS home_config`;

const INVITE_COLS = `sit.token, sit.home_id, sit.staff_id, sit.created_by, sit.created_at, sit.expires_at, sit.consumed_at,
  s.name AS staff_name, s.active AS staff_active, s.deleted_at AS staff_deleted_at,
  h.slug AS home_slug, h.name AS home_name, h.config AS home_config`;

function shapeCredentials(row) {
  if (!row) return null;
  return {
    homeId: row.home_id,
    staffId: row.staff_id,
    username: row.username,
    passwordHash: row.password_hash,
    lastLoginAt: row.last_login_at instanceof Date ? row.last_login_at.toISOString() : row.last_login_at,
    failedLoginCount: Number.parseInt(row.failed_login_count, 10) || 0,
    lockedUntil: row.locked_until instanceof Date ? row.locked_until.toISOString() : row.locked_until,
    sessionVersion: Number.parseInt(row.session_version, 10) || 0,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    staffName: row.staff_name,
    staffActive: row.staff_active !== false && row.staff_deleted_at == null,
    homeSlug: row.home_slug,
    homeName: row.home_config?.home_name || row.home_name,
    homeConfig: row.home_config || {},
  };
}

function shapeInvite(row) {
  if (!row) return null;
  return {
    token: row.token,
    homeId: row.home_id,
    staffId: row.staff_id,
    createdBy: row.created_by,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
    consumedAt: row.consumed_at instanceof Date ? row.consumed_at.toISOString() : row.consumed_at,
    staffName: row.staff_name,
    staffActive: row.staff_active !== false && row.staff_deleted_at == null,
    homeSlug: row.home_slug,
    homeName: row.home_config?.home_name || row.home_name,
  };
}

export async function findByUsername(username, client = pool) {
  const { rows } = await client.query(
    `SELECT ${CREDENTIAL_COLS}
       FROM staff_auth_credentials sac
       JOIN staff s ON s.home_id = sac.home_id AND s.id = sac.staff_id
       JOIN homes h ON h.id = sac.home_id AND h.deleted_at IS NULL
      WHERE LOWER(sac.username) = LOWER($1)
      LIMIT 1`,
    [username],
  );
  return shapeCredentials(rows[0]);
}

export async function findByStaff(homeId, staffId, client = pool) {
  const { rows } = await client.query(
    `SELECT ${CREDENTIAL_COLS}
       FROM staff_auth_credentials sac
       JOIN staff s ON s.home_id = sac.home_id AND s.id = sac.staff_id
       JOIN homes h ON h.id = sac.home_id AND h.deleted_at IS NULL
      WHERE sac.home_id = $1 AND sac.staff_id = $2
      LIMIT 1`,
    [homeId, staffId],
  );
  return shapeCredentials(rows[0]);
}

async function reloadCredentials(homeId, staffId, client = pool) {
  return findByStaff(homeId, staffId, client);
}

export async function createCredentials({ homeId, staffId, username, passwordHash }, client = pool) {
  await client.query(
    `INSERT INTO staff_auth_credentials (home_id, staff_id, username, password_hash, updated_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [homeId, staffId, username, passwordHash],
  );
  return reloadCredentials(homeId, staffId, client);
}

export async function createInviteToken({ token, homeId, staffId, createdBy, expiresAt }, client = pool) {
  await client.query(
    `INSERT INTO staff_invite_tokens (token, home_id, staff_id, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [token, homeId, staffId, createdBy, expiresAt],
  );
  return findInviteToken(token, client);
}

export async function revokeOpenInvites(homeId, staffId, client = pool) {
  await client.query(
    `UPDATE staff_invite_tokens
        SET consumed_at = NOW()
      WHERE home_id = $1
        AND staff_id = $2
        AND consumed_at IS NULL`,
    [homeId, staffId],
  );
}

export async function findInviteToken(token, client = pool) {
  const { rows } = await client.query(
    `SELECT ${INVITE_COLS}
       FROM staff_invite_tokens sit
       JOIN staff s ON s.home_id = sit.home_id AND s.id = sit.staff_id
       JOIN homes h ON h.id = sit.home_id AND h.deleted_at IS NULL
      WHERE sit.token = $1
      LIMIT 1`,
    [token],
  );
  return shapeInvite(rows[0]);
}

export async function consumeInviteToken(token, client = pool) {
  const { rowCount } = await client.query(
    `UPDATE staff_invite_tokens
        SET consumed_at = NOW()
      WHERE token = $1
        AND consumed_at IS NULL`,
    [token],
  );
  return rowCount > 0;
}

export async function recordFailedLogin(homeId, staffId, lockoutMinutes = 15, client = pool) {
  await client.query(
    `UPDATE staff_auth_credentials
        SET failed_login_count = failed_login_count + 1,
            locked_until = CASE
              WHEN failed_login_count + 1 >= 5
                THEN NOW() + ($3::text || ' minutes')::interval
              ELSE locked_until
            END,
            updated_at = NOW()
      WHERE home_id = $1 AND staff_id = $2`,
    [homeId, staffId, String(lockoutMinutes)],
  );
}

export async function recordSuccessfulLogin(homeId, staffId, client = pool) {
  await client.query(
    `UPDATE staff_auth_credentials
        SET failed_login_count = 0,
            locked_until = NULL,
            last_login_at = NOW(),
            updated_at = NOW()
      WHERE home_id = $1 AND staff_id = $2`,
    [homeId, staffId],
  );
}

export async function lockAccount(homeId, staffId, minutes, client = pool) {
  await client.query(
    `UPDATE staff_auth_credentials
        SET locked_until = NOW() + ($3::text || ' minutes')::interval,
            updated_at = NOW()
      WHERE home_id = $1 AND staff_id = $2`,
    [homeId, staffId, String(minutes)],
  );
}

export async function updatePassword(homeId, staffId, passwordHash, client = pool) {
  await client.query(
    `UPDATE staff_auth_credentials
        SET password_hash = $3,
            session_version = session_version + 1,
            failed_login_count = 0,
            locked_until = NULL,
            updated_at = NOW()
      WHERE home_id = $1 AND staff_id = $2`,
    [homeId, staffId, passwordHash],
  );
  return reloadCredentials(homeId, staffId, client);
}

export async function bumpSessionVersion(homeId, staffId, client = pool) {
  await client.query(
    `UPDATE staff_auth_credentials
        SET session_version = session_version + 1,
            updated_at = NOW()
      WHERE home_id = $1 AND staff_id = $2`,
    [homeId, staffId],
  );
  return reloadCredentials(homeId, staffId, client);
}
