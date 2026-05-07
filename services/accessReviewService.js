import { withTransaction } from '../db.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import * as accessReviewRepo from '../repositories/accessReviewRepo.js';
import * as auditService from './auditService.js';

export const ACCESS_REVIEW_CADENCES = ['monthly', 'quarterly'];
export const ACCESS_REVIEW_STATUSES = ['in_progress', 'completed'];
export const ACCESS_REVIEW_ASSIGNMENT_STATUSES = ['pending', 'reviewed', 'needs_change', 'revoked_requested'];

const STALE_LOGIN_DAYS = 90;

function assertPlatformAdmin(actor = {}) {
  if (actor.isPlatformAdmin !== true) {
    throw new ForbiddenError('Platform admin access required');
  }
}

function parseDateOnly(value, label) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new ValidationError(`Invalid ${label}`);
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new ValidationError(`Invalid ${label}`);
  }
  return raw;
}

function todayDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function periodForCadence(cadence, now = new Date()) {
  if (!ACCESS_REVIEW_CADENCES.includes(cadence)) {
    throw new ValidationError('Invalid review cadence');
  }
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  if (cadence === 'monthly') {
    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 0));
    return {
      period_start: start.toISOString().slice(0, 10),
      period_end: end.toISOString().slice(0, 10),
    };
  }
  const quarterStartMonth = Math.floor(month / 3) * 3;
  const start = new Date(Date.UTC(year, quarterStartMonth, 1));
  const end = new Date(Date.UTC(year, quarterStartMonth + 3, 0));
  return {
    period_start: start.toISOString().slice(0, 10),
    period_end: end.toISOString().slice(0, 10),
  };
}

function reviewKey(cadence, periodStart) {
  return `${cadence}:${periodStart}`;
}

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item) || 'none';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function staleCutoffDate(now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - STALE_LOGIN_DAYS);
  return cutoff;
}

function isStaleUser(user, now = new Date()) {
  if (user.active !== true) return false;
  if (!user.last_login_at) return true;
  const lastLogin = new Date(user.last_login_at);
  if (Number.isNaN(lastLogin.getTime())) return true;
  return lastLogin < staleCutoffDate(now);
}

function buildSnapshot(users, assignments, now = new Date()) {
  const assignedUsernames = new Set(assignments.map(row => String(row.username).toLowerCase()));
  const platformAdmins = users.filter(user => user.is_platform_admin === true);
  const inactiveUsers = users.filter(user => user.active !== true);
  const noHomeUsers = users.filter(user => user.active === true && !assignedUsernames.has(String(user.username).toLowerCase()));
  const staleUsers = users.filter(user => isStaleUser(user, now));

  return {
    generated_at: now.toISOString(),
    stale_login_days: STALE_LOGIN_DAYS,
    counts: {
      users: users.length,
      active_users: users.filter(user => user.active === true).length,
      inactive_users: inactiveUsers.length,
      platform_admins: platformAdmins.length,
      home_assignments: assignments.length,
      no_home_users: noHomeUsers.length,
      stale_users: staleUsers.length,
    },
    role_counts: countBy(assignments, row => row.role_id),
    home_counts: countBy(assignments, row => row.home_slug || `home:${row.home_id}`),
    platform_admins: platformAdmins.map(user => ({
      id: user.id,
      username: user.username,
      display_name: user.display_name || '',
      active: user.active === true,
      last_login_at: user.last_login_at || null,
    })),
    inactive_users: inactiveUsers.map(user => ({
      id: user.id,
      username: user.username,
      display_name: user.display_name || '',
      last_login_at: user.last_login_at || null,
    })),
    no_home_users: noHomeUsers.map(user => ({
      id: user.id,
      username: user.username,
      display_name: user.display_name || '',
      last_login_at: user.last_login_at || null,
    })),
    stale_users: staleUsers.map(user => ({
      id: user.id,
      username: user.username,
      display_name: user.display_name || '',
      last_login_at: user.last_login_at || null,
    })),
  };
}

function flagsForUser(user, assignedUsernames, now) {
  const flags = [];
  if (user.active !== true) flags.push('inactive_user');
  if (user.is_platform_admin === true) flags.push('platform_admin');
  if (user.active === true && !assignedUsernames.has(String(user.username).toLowerCase())) flags.push('no_home');
  if (isStaleUser(user, now)) flags.push('stale_login');
  return flags;
}

function flagsForAssignment(row, userFlags) {
  const flags = [...userFlags];
  if (!row.home_id || !row.home_slug) flags.push('deleted_or_missing_home');
  if (!row.role_id) flags.push('missing_role');
  return [...new Set(flags)];
}

function buildAssignmentRows(users, sourceAssignments, now = new Date()) {
  const assignedUsernames = new Set(sourceAssignments.map(row => String(row.username).toLowerCase()));
  const userByUsername = new Map(users.map(user => [String(user.username).toLowerCase(), user]));
  const rows = sourceAssignments.map((row) => {
    const user = userByUsername.get(String(row.username).toLowerCase()) || row;
    const userFlags = flagsForUser(user, assignedUsernames, now);
    return {
      assignment_key: `home:${row.home_id || 'missing'}:${String(row.username).toLowerCase()}`,
      assignment_type: 'home_role',
      user_id: row.user_id || user.id || null,
      username: row.username,
      display_name: row.display_name || user.display_name || '',
      user_role: row.user_role || user.role || null,
      active: row.active === true,
      is_platform_admin: row.is_platform_admin === true,
      last_login_at: row.last_login_at || user.last_login_at || null,
      home_id: row.home_id || null,
      home_slug: row.home_slug || null,
      home_name: row.home_name || null,
      role_id: row.role_id || null,
      exception_flags: flagsForAssignment(row, userFlags),
    };
  });

  for (const user of users) {
    const userFlags = flagsForUser(user, assignedUsernames, now);
    if (userFlags.length === 0) continue;
    rows.push({
      assignment_key: `user:${String(user.username).toLowerCase()}`,
      assignment_type: 'user_exception',
      user_id: user.id,
      username: user.username,
      display_name: user.display_name || '',
      user_role: user.role || null,
      active: user.active === true,
      is_platform_admin: user.is_platform_admin === true,
      last_login_at: user.last_login_at || null,
      home_id: null,
      home_slug: null,
      home_name: null,
      role_id: null,
      exception_flags: userFlags,
    });
  }

  return rows;
}

function sanitizeNotes(notes) {
  const value = String(notes || '').trim();
  if (value.length > 2000) throw new ValidationError('Notes must be 2000 characters or fewer');
  return value;
}

export function buildAccessReviewSnapshotForTest(users, assignments, now) {
  return {
    snapshot: buildSnapshot(users, assignments, now),
    assignments: buildAssignmentRows(users, assignments, now),
  };
}

export async function startAccessReview({
  actor,
  cadence = 'quarterly',
  periodStart,
  periodEnd,
  now = new Date(),
} = {}) {
  assertPlatformAdmin(actor);
  if (!ACCESS_REVIEW_CADENCES.includes(cadence)) throw new ValidationError('Invalid review cadence');
  const period = periodStart || periodEnd
    ? {
        period_start: parseDateOnly(periodStart, 'period start'),
        period_end: parseDateOnly(periodEnd, 'period end'),
      }
    : periodForCadence(cadence, now);
  if (period.period_end < period.period_start) throw new ValidationError('Period end must be on or after period start');
  const key = reviewKey(cadence, period.period_start);

  return withTransaction(async (client) => {
    const existing = await accessReviewRepo.findReviewByKey(key, client);
    if (existing) throw new ConflictError('Access review already exists for this period');

    const users = await accessReviewRepo.listAccessReviewSourceUsers(client);
    const sourceAssignments = await accessReviewRepo.listAccessReviewSourceAssignments(client);
    const snapshot = buildSnapshot(users, sourceAssignments, now);
    const assignmentRows = buildAssignmentRows(users, sourceAssignments, now);
    const review = await accessReviewRepo.insertReview({
      review_key: key,
      cadence,
      ...period,
      snapshot,
      started_by_username: actor.username,
    }, client);
    const assignments = await accessReviewRepo.insertAssignments(review.id, assignmentRows, client);
    await auditService.log('access_review_started', null, actor.username, {
      reviewId: review.id,
      cadence,
      periodStart: period.period_start,
      periodEnd: period.period_end,
      assignmentCount: assignments.length,
      snapshotCounts: snapshot.counts,
    }, client);
    return { review, assignments, snapshot };
  });
}

export async function listAccessReviews({ actor, filters = {} } = {}) {
  assertPlatformAdmin(actor);
  if (filters.status && !ACCESS_REVIEW_STATUSES.includes(filters.status)) {
    throw new ValidationError('Invalid review status');
  }
  if (filters.cadence && !ACCESS_REVIEW_CADENCES.includes(filters.cadence)) {
    throw new ValidationError('Invalid review cadence');
  }
  const result = await accessReviewRepo.listReviews(filters);
  return { reviews: result.rows, _total: result.total };
}

export async function getAccessReview({ actor, reviewId, filters = {} } = {}) {
  assertPlatformAdmin(actor);
  const review = await accessReviewRepo.findReviewById(reviewId);
  if (!review) throw new NotFoundError('Access review not found');
  const assignments = await accessReviewRepo.listAssignments(review.id, filters);
  return { review, assignments: assignments.rows, _total: assignments.total };
}

export async function updateAccessReviewAssignment({
  actor,
  reviewId,
  assignmentId,
  status,
  notes = '',
} = {}) {
  assertPlatformAdmin(actor);
  if (!ACCESS_REVIEW_ASSIGNMENT_STATUSES.includes(status)) throw new ValidationError('Invalid assignment status');
  const sanitizedNotes = sanitizeNotes(notes);
  return withTransaction(async (client) => {
    const review = await accessReviewRepo.findReviewByIdForUpdate(reviewId, client);
    if (!review) throw new NotFoundError('Access review not found');
    if (review.status === 'completed') throw new ConflictError('Completed access reviews cannot be changed');

    const existing = await accessReviewRepo.findAssignmentByIdForUpdate(reviewId, assignmentId, client);
    if (!existing) throw new NotFoundError('Access review assignment not found');

    const assignment = await accessReviewRepo.updateAssignmentStatus(reviewId, assignmentId, {
      status,
      notes: sanitizedNotes,
      reviewed_by_username: actor.username,
    }, client);
    if (!assignment) throw new NotFoundError('Access review assignment not found');

    await accessReviewRepo.insertAssignmentDecision({
      review_id: review.id,
      assignment_id: assignment.id,
      assignment_key: assignment.assignment_key,
      from_status: existing.status,
      to_status: assignment.status,
      notes: sanitizedNotes,
      decided_by_username: actor.username,
    }, client);

    await auditService.log('access_review_assignment_decision', assignment.home_slug || null, actor.username, {
      reviewId: review.id,
      assignmentId: assignment.id,
      assignmentKey: assignment.assignment_key,
      fromStatus: existing.status,
      toStatus: assignment.status,
      username: assignment.username,
      homeSlug: assignment.home_slug || null,
    }, client);

    return assignment;
  });
}

export async function completeAccessReview({ actor, reviewId, now = new Date() } = {}) {
  assertPlatformAdmin(actor);
  return withTransaction(async (client) => {
    const lockedReview = await accessReviewRepo.findReviewByIdForUpdate(reviewId, client);
    if (!lockedReview) throw new NotFoundError('Access review not found');
    if (lockedReview.status === 'completed') return lockedReview;
    const review = await accessReviewRepo.findReviewById(reviewId, client);
    if (review.period_end > todayDate(now)) {
      throw new ConflictError('Access review period has not ended');
    }
    const pendingCount = Number(review.assignment_counts?.pending || 0);
    if (pendingCount > 0) {
      throw new ConflictError('Access review has pending assignments');
    }
    const unresolvedCount =
      Number(review.assignment_counts?.needs_change || 0)
      + Number(review.assignment_counts?.revoked_requested || 0);
    if (unresolvedCount > 0) {
      throw new ConflictError('Access review has unresolved access changes');
    }
    const completed = await accessReviewRepo.markReviewCompleted(reviewId, actor.username, client);
    await auditService.log('access_review_completed', null, actor.username, {
      reviewId: completed.id,
      cadence: completed.cadence,
      periodStart: completed.period_start,
      periodEnd: completed.period_end,
      assignmentCounts: completed.assignment_counts || review.assignment_counts || {},
    }, client);
    return completed;
  });
}
