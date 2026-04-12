import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { withTransaction } from '../db.js';
import * as userRepo from '../repositories/userRepo.js';
import * as userHomeRepo from '../repositories/userHomeRepo.js';
import * as authService from './authService.js';
import logger from '../logger.js';

function parseBcryptRounds(rawValue) {
  const parsed = parseInt(rawValue || '12', 10);
  if (!Number.isInteger(parsed) || parsed < 10 || parsed > 15) return 12;
  return parsed;
}

const BCRYPT_ROUNDS = parseBcryptRounds(process.env.BCRYPT_ROUNDS);
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
 * Ensure bootstrap users from env vars exist and keep the seed admin elevated.
 * Called once at startup. Non-fatal if table does not exist yet.
 */
export async function ensureSeedUsers() {
  const hasSeedHashes = config.users.some(envUser => !!envUser.hash);
  let seeded = 0;
  let repaired = 0;
  for (const envUser of config.users) {
    if (!envUser.hash) continue;

    const existing = await userRepo.findByUsername(envUser.username);
    if (!existing) {
      await userRepo.create(
        envUser.username,
        envUser.hash,
        envUser.role,
        envUser.username === 'admin' ? 'Administrator' : 'Viewer',
        'system'
      );
      seeded++;
      logger.info({ username: envUser.username, role: envUser.role }, 'Seeded user from env vars');
    }

    if (envUser.role === 'admin') {
      const current = existing || await userRepo.findByUsername(envUser.username);
      if (current && !current.is_platform_admin) {
        await userRepo.setPlatformAdmin(envUser.username, true);
        repaired++;
        logger.info({ username: envUser.username }, 'Granted platform admin to bootstrap admin');
      }
      await userHomeRepo.grantAllHomesRole(envUser.username);
    }
  }

  if (!hasSeedHashes) {
    logger.warn('No env var hashes found - bootstrap users were not ensured');
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
  delete updateFields.is_platform_admin;

  if (updateFields.active === false && target.username === actorUsername) {
    throw new Error('Cannot deactivate your own account');
  }

  const isRemovingAdmin =
    (updateFields.active === false && target.role === 'admin') ||
    (updateFields.role !== undefined && updateFields.role !== 'admin' && target.role === 'admin' && target.active);

  if (updateFields.active === false || (updateFields.role && updateFields.role !== target.role)) {
    updateFields.bump_session_version = true;
  }

  let updated;
  if (isRemovingAdmin) {
    updated = await withTransaction(async (client) => {
      const lockedTarget = await userRepo.findById(id, client, { forUpdate: true });
      if (!lockedTarget) throw new Error('User not found');

      const activeAdminIds = await userRepo.lockActiveAdminIds(client);
      if (activeAdminIds.length <= 1) {
        throw new Error('Cannot remove the last active admin');
      }

      return userRepo.update(id, updateFields, client);
    });
  } else {
    updated = await userRepo.update(id, updateFields);
  }

  if (updateFields.active === false) {
    await authService.revokeUser(target.username);
  }

  if (updateFields.role && updateFields.role !== target.role) {
    await authService.revokeUser(target.username);
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
  await withTransaction(async (client) => {
    await userRepo.updatePassword(userId, hash, client);
    await userRepo.bumpSessionVersionById(userId, client);
    await userRepo.resetFailedLogin(target.username, client);
    await authService.revokeUser(target.username, 'user', client);
  });
}

export async function changeOwnPassword(username, currentPassword, newPassword) {
  const pwError = validatePassword(newPassword);
  if (pwError) throw new Error(pwError);

  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await withTransaction(async (client) => {
    const user = await userRepo.findByUsername(username, client, { forUpdate: true });
    if (!user) throw new Error('User not found');

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) throw new Error('Current password is incorrect');

    await userRepo.updatePassword(user.id, hash, client);
    await userRepo.bumpSessionVersionById(user.id, client);
    await authService.revokeUser(username, 'user', client);
  });
}
