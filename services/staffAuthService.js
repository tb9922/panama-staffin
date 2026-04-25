import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { withTransaction } from '../db.js';
import { AppError, ConflictError, ForbiddenError, ValidationError } from '../errors.js';
import * as authRepo from '../repositories/authRepo.js';
import * as staffAuthRepo from '../repositories/staffAuthRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as userRepo from '../repositories/userRepo.js';
import * as auditService from './auditService.js';
import { validatePassword } from './userService.js';

const INVITE_TTL_HOURS = 72;
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
const USERNAME_RE = /^[a-z0-9._-]+$/;

function ensureStrongPassword(password) {
  const err = validatePassword(password);
  if (err) throw new ValidationError(err);
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

export async function createInvite({ homeId, staffId, createdBy }) {
  return withTransaction(async (client) => {
    const staff = await staffRepo.findById(homeId, staffId, client);
    if (!staff || staff.active === false) {
      throw new AppError('Staff member not found', 404, 'STAFF_NOT_FOUND');
    }

    const existing = await staffAuthRepo.findByStaff(homeId, staffId, client);
    if (existing) {
      throw new ConflictError('This staff member already has sign-in credentials', 'STAFF_AUTH_EXISTS');
    }

    await staffAuthRepo.revokeOpenInvites(homeId, staffId, client);
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);
    const invite = await staffAuthRepo.createInviteToken({ token, homeId, staffId, createdBy, expiresAt }, client);

    await auditService.log('staff_invite_created', invite.homeSlug, createdBy, {
      staff_id: staffId,
      expires_at: invite.expiresAt,
    }, client);

    return {
      ...invite,
      inviteUrl: `/staff/setup?token=${token}`,
    };
  });
}

export async function consumeInvite({ token, username, password }) {
  ensureStrongPassword(password);
  const normalizedUsername = normalizeUsername(username);
  if (normalizedUsername.length < 3 || normalizedUsername.length > 100 || !USERNAME_RE.test(normalizedUsername)) {
    throw new ValidationError('Username must be 3-100 characters and use letters, numbers, dots, underscores, or hyphens');
  }

  return withTransaction(async (client) => {
    const invite = await staffAuthRepo.findInviteToken(token, client);
    if (!invite) throw new AppError('Invite token not found', 404, 'INVITE_NOT_FOUND');
    if (invite.consumedAt) throw new ConflictError('Invite token has already been used', 'INVITE_CONSUMED');
    if (new Date(invite.expiresAt) <= new Date()) throw new AppError('Invite token has expired', 410, 'INVITE_EXPIRED');
    if (!invite.staffActive) throw new ForbiddenError('Staff member is not active');

    const existingStaffCredentials = await staffAuthRepo.findByUsername(normalizedUsername, client);
    if (existingStaffCredentials) {
      throw new ConflictError('Username is already in use', 'USERNAME_TAKEN');
    }
    const existingUser = await userRepo.findByUsername(normalizedUsername).catch((err) => {
      if (err.code === '42P01') return null;
      throw err;
    });
    if (existingUser) {
      throw new ConflictError('Username is already in use', 'USERNAME_TAKEN');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const credentials = await staffAuthRepo.createCredentials({
      homeId: invite.homeId,
      staffId: invite.staffId,
      username: normalizedUsername,
      passwordHash,
    }, client);
    await staffAuthRepo.consumeInviteToken(token, client);
    await authRepo.clearForUser(normalizedUsername);

    await auditService.log('staff_invite_consumed', invite.homeSlug, normalizedUsername, {
      staff_id: invite.staffId,
    }, client);

    return {
      username: normalizedUsername,
      role: 'staff_member',
      displayName: credentials.staffName || '',
      isPlatformAdmin: false,
    };
  });
}

export async function changePassword({ homeId, staffId, currentPassword, newPassword, actorUsername }) {
  ensureStrongPassword(newPassword);
  return withTransaction(async (client) => {
    const creds = await staffAuthRepo.findByStaff(homeId, staffId, client);
    if (!creds) throw new AppError('Credentials not found', 404, 'STAFF_AUTH_NOT_FOUND');

    const valid = await bcrypt.compare(currentPassword, creds.passwordHash);
    if (!valid) throw new ForbiddenError('Current password is incorrect', 'INVALID_CURRENT_PASSWORD');

    const nextHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const updated = await staffAuthRepo.updatePassword(homeId, staffId, nextHash, client);
    await authRepo.revokeAllForUser(updated.username, 'user', client);
    await auditService.log('staff_password_changed', updated.homeSlug, actorUsername || updated.username, {
      staff_id: staffId,
    }, client);
    return updated;
  });
}

export async function revokeStaffSessions({ homeId, staffId, actor }) {
  return withTransaction(async (client) => {
    const creds = await staffAuthRepo.bumpSessionVersion(homeId, staffId, client);
    if (!creds) throw new AppError('Credentials not found', 404, 'STAFF_AUTH_NOT_FOUND');
    await authRepo.revokeAllForUser(creds.username, 'admin', client);
    await auditService.log('staff_sessions_revoked', creds.homeSlug, actor, {
      staff_id: staffId,
      username: creds.username,
    }, client);
    return creds;
  });
}
