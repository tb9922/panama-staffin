import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { withTransaction } from '../db.js';
import * as userRepo from '../repositories/userRepo.js';
import * as userHomeRepo from '../repositories/userHomeRepo.js';
import * as authService from './authService.js';
import logger from '../logger.js';

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;

export function validatePassword(password) {
  if (!password || password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters`;
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  return null;
}

/**
 * Seed admin/viewer users from env vars if the users table is empty.
 * Called once at startup. Non-fatal if table doesn't exist yet.
 */
export async function ensureSeedUsers() {
  const existing = await userRepo.listAll();
  if (existing.length > 0) return;

  let seeded = 0;
  for (const envUser of config.users) {
    if (!envUser.hash) continue;
    const exists = await userRepo.existsByUsername(envUser.username);
    if (exists) continue;

    await userRepo.create(
      envUser.username,
      envUser.hash,
      envUser.role,
      envUser.username === 'admin' ? 'Administrator' : 'Viewer',
      'system'
    );
    if (envUser.role === 'admin') {
      await userHomeRepo.grantAllHomesRole(envUser.username);
    }
    seeded++;
    logger.info({ username: envUser.username, role: envUser.role }, 'Seeded user from env vars');
  }

  if (seeded === 0) {
    logger.warn('Users table is empty and no env var hashes found — no users seeded');
  }
}

export async function createUser(username, password, role, displayName, createdBy, client) {
  const pwError = validatePassword(password);
  if (pwError) throw new Error(pwError);

  const exists = await userRepo.existsByUsername(username, client);
  if (exists) throw new Error('Username already exists');

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  let user;
  try {
    user = await userRepo.create(username, hash, role, displayName, createdBy, client);
  } catch (err) {
    if (err.code === '23505' && err.constraint?.includes('username')) {
      throw new Error('Username already exists');
    }
    throw err;
  }

  if (role === 'admin') {
    await userHomeRepo.grantAllHomesRole(username);
  }

  return user;
}

export async function updateUser(id, fields, actorUsername) {
  const target = await userRepo.findById(id);
  if (!target) throw new Error('User not found');

  // Strip is_platform_admin — only settable via direct DB or platform admin routes
  delete fields.is_platform_admin;

  // Cannot deactivate yourself
  if (fields.active === false && target.username === actorUsername) {
    throw new Error('Cannot deactivate your own account');
  }

  // Cannot deactivate or downgrade the last admin.
  // Use a transaction with row-level lock to prevent TOCTOU: two concurrent requests
  // could both pass the count check and both deactivate the last admin.
  const isRemovingAdmin =
    (fields.active === false && target.role === 'admin') ||
    (fields.role !== undefined && fields.role !== 'admin' && target.role === 'admin' && target.active);

  let updated;
  if (isRemovingAdmin) {
    updated = await withTransaction(async (client) => {
      // Lock the target row so concurrent requests serialise here
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [id]);
      const adminCount = await userRepo.countActiveAdmins(client);
      if (adminCount <= 1) {
        throw new Error('Cannot remove the last active admin');
      }
      return userRepo.update(id, fields, client);
    });
  } else {
    updated = await userRepo.update(id, fields);
  }

  // If deactivated, immediately revoke all tokens.
  // Use scope='admin' so the sentinel is NOT cleared if the user somehow re-authenticates.
  if (fields.active === false) {
    await authService.revokeUser(target.username, 'admin');
  }

  // If role changed, force re-login so new JWT has correct claims.
  // Use scope='admin' so the sentinel survives clearForUser on re-login; without this,
  // the user could log in again immediately and reactivate old JWTs with the old role.
  if (fields.role && fields.role !== target.role) {
    await authService.revokeUser(target.username, 'admin');
    // If upgraded to admin, grant all homes
    if (fields.role === 'admin' && fields.role !== target.role) {
      await userHomeRepo.grantAllHomesRole(target.username);
    }
  }

  return updated;
}

export async function resetPassword(userId, newPassword, _actorUsername) {
  const pwError = validatePassword(newPassword);
  if (pwError) throw new Error(pwError);

  const target = await userRepo.findById(userId);
  if (!target) throw new Error('User not found');

  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await userRepo.updatePassword(userId, hash);
  // Clear lockout so the user can immediately log in with the new password
  await userRepo.resetFailedLogin(target.username);

  // Revoke all existing tokens — forces re-login with new password.
  // scope='user' so clearForUser on re-login clears the sentinel and the user
  // can log back in with the new password. The window for old-token reuse is
  // bounded by the JWT TTL (4h); DB re-verification in requireAdmin closes
  // any role-escalation gap for that window.
  await authService.revokeUser(target.username);
}

export async function changeOwnPassword(username, currentPassword, newPassword) {
  const pwError = validatePassword(newPassword);
  if (pwError) throw new Error(pwError);

  const user = await userRepo.findByUsername(username);
  if (!user) throw new Error('User not found');

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) throw new Error('Current password is incorrect');

  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await userRepo.updatePassword(user.id, hash);
  await authService.revokeUser(username);
}
