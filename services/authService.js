import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { AuthenticationError } from '../errors.js';
import * as authRepo from '../repositories/authRepo.js';
import * as userRepo from '../repositories/userRepo.js';
import * as staffAuthRepo from '../repositories/staffAuthRepo.js';
import * as auditService from './auditService.js';
import logger from '../logger.js';

const STAFF_LOCKOUT_MINUTES = 15;
const DUMMY_BCRYPT_HASH = '$2a$10$7EqJtq98hPqEX7fNZaFWoOHi6V7z8N2N4dAJE1lghYzBL2cJlgKiW';
const AUTH_FAILURE_FLOOR_MS = 50;

async function applyFailureFloor(startedAt) {
  const remaining = AUTH_FAILURE_FLOOR_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

export function issueToken(payload) {
  const jti = randomUUID();
  const token = jwt.sign(
    { ...payload, jti },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
  return { token, jti };
}

export function issueUserToken(dbUser) {
  return issueToken({
    username: dbUser.username,
    role: dbUser.role,
    is_platform_admin: !!dbUser.is_platform_admin,
    session_version: dbUser.session_version || 0,
  });
}

export function issueStaffToken(credentials) {
  return issueToken({
    username: credentials.username,
    role: 'staff_member',
    is_platform_admin: false,
    auth_type: 'staff',
    home_id: credentials.homeId,
    home_slug: credentials.homeSlug,
    staff_id: credentials.staffId,
    session_version: credentials.sessionVersion || 0,
  });
}

/**
 * Verify deny-list table is reachable on startup.
 * In cluster mode, each instance checks DB on every request (no in-memory Set).
 */
export async function loadDenyList() {
  try {
    const jtis = await authRepo.loadActive();
    const usernames = await authRepo.loadActiveUsernames();
    logger.info({ jtis: jtis.length, usernames: usernames.length }, 'Token deny-list verified');
  } catch (err) {
    // Non-fatal on startup — table may not exist yet (pre-migration)
    logger.warn({ error: err.message }, 'Could not verify token deny-list');
  }
}

export async function login(username, password) {
  const startedAt = Date.now();
  // Try database-backed users first
  let dbUser = null;
  let usersTableExists = true;
  try { dbUser = await userRepo.findByUsername(username); } catch (err) {
    // Only fall through when the users table doesn't exist yet (pre-migration state).
    // Any other error (DB down, timeout, pool exhausted) must propagate so auth is
    // never silently bypassed — env-var users skip lockout and deny-list checks.
    if (err.code !== '42P01') throw err;
    usersTableExists = false;
  }

  if (dbUser) {
    if (!dbUser.active) {
      await applyFailureFloor(startedAt);
      throw new AuthenticationError('Invalid credentials');
    }
    // Account lockout — reject if locked and lockout hasn't expired
    if (dbUser.locked_until && new Date(dbUser.locked_until) > new Date()) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      await applyFailureFloor(startedAt);
      const err = new AuthenticationError('Account locked — contact admin');
      err.statusCode = 423;
      throw err;
    }
    const valid = await bcrypt.compare(password, dbUser.password_hash);
    if (!valid) {
      await userRepo.incrementFailedLogin(username);
      await applyFailureFloor(startedAt);
      throw new AuthenticationError('Invalid credentials');
    }
    // Successful login — reset failed counter and clear user-scoped deny-list
    // sentinels so the fresh JWT isn't blocked. Durable "log everyone out"
    // invalidation is enforced separately via users.session_version.
    await userRepo.resetFailedLogin(username);
    await authRepo.clearForUser(username);
    userRepo.updateLastLogin(username).catch(() => {});
    const { token } = issueUserToken(dbUser);
    return { username: dbUser.username, role: dbUser.role, token, displayName: dbUser.display_name || '', isPlatformAdmin: !!dbUser.is_platform_admin };
  }

  if (usersTableExists && config.enableStaffPortal) {
    const creds = await staffAuthRepo.findByUsername(username);
    if (!creds || !creds.staffActive) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      await applyFailureFloor(startedAt);
      throw new AuthenticationError('Invalid credentials');
    }
    if (creds.lockedUntil && new Date(creds.lockedUntil) > new Date()) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      await applyFailureFloor(startedAt);
      const err = new AuthenticationError('Account locked — contact admin');
      err.statusCode = 423;
      throw err;
    }
    const valid = await bcrypt.compare(password, creds.passwordHash);
    if (!valid) {
      await staffAuthRepo.recordFailedLogin(creds.homeId, creds.staffId);
      if ((creds.failedLoginCount + 1) >= 5) {
        await staffAuthRepo.lockAccount(creds.homeId, creds.staffId, STAFF_LOCKOUT_MINUTES);
      }
      await applyFailureFloor(startedAt);
      throw new AuthenticationError('Invalid credentials');
    }

    await authRepo.clearForUser(creds.username);
    await staffAuthRepo.recordSuccessfulLogin(creds.homeId, creds.staffId);
    const freshCreds = await staffAuthRepo.findByStaff(creds.homeId, creds.staffId);
    const { token } = issueStaffToken(freshCreds || creds);
    auditService.log('staff_login', creds.homeSlug, creds.username, {
      staff_id: creds.staffId,
    }).catch((err) => logger.warn({ err: err.message }, 'staff_login audit failed'));
    return {
      username: creds.username,
      role: 'staff_member',
      token,
      displayName: creds.staffName || '',
      isPlatformAdmin: false,
    };
  }
  if (usersTableExists) {
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
    await applyFailureFloor(startedAt);
    throw new AuthenticationError('Invalid credentials');
  }
  logger.error('Database-backed authentication is unavailable because the users table is missing');
  throw new AuthenticationError('Login unavailable until database migrations are applied');
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
}

/**
 * Check if a decoded token has been revoked.
 * Queries DB directly — cluster-safe (no in-memory Set drift between workers).
 * Single indexed query per authenticated request (~0.1ms on PK lookup).
 * @param {object} decoded - decoded JWT payload
 * @returns {Promise<boolean>}
 */
export async function isTokenDenied(decoded) {
  if (!decoded.jti || !decoded.username) return true;
  return authRepo.isDenied(decoded.jti || null, decoded.username || null);
}

/**
 * Revoke all tokens for a username. Used when terminating staff access.
 * Writes to DB — checked per authenticated request (cluster-safe, ~0.1ms PK lookup).
 * @param {string} username
 */
export async function revokeUser(username, scope = 'user', client) {
  await authRepo.revokeAllForUser(username, scope, client);
  logger.info({ username, scope }, 'All tokens revoked for user');
}

/**
 * Prune expired deny-list entries from DB and refresh memory.
 * Call periodically.
 */
export async function pruneDenyList() {
  const count = await authRepo.pruneExpired();
  if (count > 0) {
    logger.info({ pruned: count }, 'Deny-list pruned');
  }
}
