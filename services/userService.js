import bcrypt from 'bcryptjs';
import { config } from '../config.js';
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

  // Cannot deactivate yourself
  if (fields.active === false && target.username === actorUsername) {
    throw new Error('Cannot deactivate your own account');
  }

  // Cannot deactivate or downgrade the last admin
  const isRemovingAdmin =
    (fields.active === false && target.role === 'admin') ||
    (fields.role === 'viewer' && target.role === 'admin' && target.active);

  if (isRemovingAdmin) {
    const adminCount = await userRepo.countActiveAdmins();
    if (adminCount <= 1) {
      throw new Error('Cannot remove the last active admin');
    }
  }

  const updated = await userRepo.update(id, fields);

  // If deactivated, immediately revoke all tokens
  if (fields.active === false) {
    await authService.revokeUser(target.username);
  }

  // If role or platform admin flag changed, force re-login so new JWT has correct claims
  if ((fields.role && fields.role !== target.role) ||
      (fields.is_platform_admin !== undefined && fields.is_platform_admin !== target.is_platform_admin)) {
    await authService.revokeUser(target.username);
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

  // Revoke all existing tokens — forces re-login with new password
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
