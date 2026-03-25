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
    await userHomeRepo.grantAllHomesRole(username, client);
  }

  return user;
}

export async function updateUser(id, fields, actorUsername) {
  const target = await userRepo.findById(id);
  if (!target) throw new Error('User not found');

  const updateFields = { ...fields };
  // Strip is_platform_admin — only settable via direct DB or platform admin routes
  delete updateFields.is_platform_admin;

  // Cannot deactivate yourself
  if (updateFields.active === false && target.username === actorUsername) {
    throw new Error('Cannot deactivate your own account');
  }

  // Cannot deactivate or downgrade the last admin.
  // Use a transaction with row-level lock to prevent TOCTOU: two concurrent requests
  // could both pass the count check and both deactivate the last admin.
  const isRemovingAdmin =
    (updateFields.active === false && target.role === 'admin') ||
    (updateFields.role !== undefined && updateFields.role !== 'admin' && target.role === 'admin' && target.active);

  if (updateFields.active === false || (updateFields.role && updateFields.role !== target.role)) {
    updateFields.bump_session_version = true;
  }

  let updated;
  if (isRemovingAdmin) {
    updated = await withTransaction(async (client) => {
      // Lock the target row so concurrent requests serialise here
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [id]);
      const adminCount = await userRepo.countActiveAdmins(client);
      if (adminCount <= 1) {
        throw new Error('Cannot remove the last active admin');
      }
      return userRepo.update(id, updateFields, client);
    });
  } else {
    updated = await userRepo.update(id, updateFields);
  }

  // If deactivated, immediately revoke all currently-issued tokens. Fresh login is blocked
  // by users.active, and old JWTs are durably blocked by the session_version bump above.
  if (updateFields.active === false) {
    await authService.revokeUser(target.username);
  }

  // If role changed, force re-login so a fresh JWT is issued with the new claims.
  // session_version makes the old token stay invalid even after the user logs back in.
  if (updateFields.role && updateFields.role !== target.role) {
    await authService.revokeUser(target.username);
    // If upgraded to admin, grant all homes
    if (updateFields.role === 'admin' && updateFields.role !== target.role) {
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
  await userRepo.bumpSessionVersionById(userId);
  // Clear lockout so the user can immediately log in with the new password
  await userRepo.resetFailedLogin(target.username);

  // Revoke all existing tokens — forces re-login with the new password.
  // users.session_version keeps old JWTs invalid even after the next successful login.
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
  await userRepo.bumpSessionVersionById(user.id);
  await authService.revokeUser(username);
}
