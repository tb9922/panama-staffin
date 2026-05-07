import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  withTransaction: vi.fn(async fn => fn({ query: vi.fn() })),
}));

vi.mock('../../repositories/accessReviewRepo.js', () => ({
  findReviewByKey: vi.fn(),
  listAccessReviewSourceUsers: vi.fn(),
  listAccessReviewSourceAssignments: vi.fn(),
  insertReview: vi.fn(),
  insertAssignments: vi.fn(),
  listReviews: vi.fn(),
  findReviewById: vi.fn(),
  findReviewByIdForUpdate: vi.fn(),
  listAssignments: vi.fn(),
  findAssignmentById: vi.fn(),
  findAssignmentByIdForUpdate: vi.fn(),
  updateAssignmentStatus: vi.fn(),
  insertAssignmentDecision: vi.fn(),
  markReviewCompleted: vi.fn(),
}));

vi.mock('../../services/auditService.js', () => ({
  log: vi.fn(),
}));

import * as accessReviewRepo from '../../repositories/accessReviewRepo.js';
import * as auditService from '../../services/auditService.js';
import {
  buildAccessReviewSnapshotForTest,
  completeAccessReview,
  listAccessReviews,
  startAccessReview,
  updateAccessReviewAssignment,
} from '../../services/accessReviewService.js';

const actor = { username: 'platform.admin', isPlatformAdmin: true };
const now = new Date('2026-05-04T12:00:00Z');

const users = [
  {
    id: 1,
    username: 'platform.admin',
    role: 'admin',
    display_name: 'Platform Admin',
    active: true,
    is_platform_admin: true,
    last_login_at: '2026-05-02T09:00:00Z',
  },
  {
    id: 2,
    username: 'inactive.manager',
    role: 'admin',
    display_name: 'Inactive Manager',
    active: false,
    is_platform_admin: false,
    last_login_at: '2026-01-01T09:00:00Z',
  },
  {
    id: 3,
    username: 'stale.viewer',
    role: 'viewer',
    display_name: 'Stale Viewer',
    active: true,
    is_platform_admin: false,
    last_login_at: '2025-12-01T09:00:00Z',
  },
  {
    id: 4,
    username: 'no.home',
    role: 'viewer',
    display_name: 'No Home',
    active: true,
    is_platform_admin: false,
    last_login_at: '2026-05-01T09:00:00Z',
  },
];

const assignments = [
  {
    user_id: 1,
    username: 'platform.admin',
    user_role: 'admin',
    display_name: 'Platform Admin',
    active: true,
    is_platform_admin: true,
    last_login_at: '2026-05-02T09:00:00Z',
    home_id: 10,
    home_slug: 'amberwood',
    home_name: 'Amberwood',
    role_id: 'home_manager',
  },
  {
    user_id: 3,
    username: 'stale.viewer',
    user_role: 'viewer',
    display_name: 'Stale Viewer',
    active: true,
    is_platform_admin: false,
    last_login_at: '2025-12-01T09:00:00Z',
    home_id: 10,
    home_slug: 'amberwood',
    home_name: 'Amberwood',
    role_id: 'viewer',
  },
];

describe('accessReviewService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds snapshots without password or secret fields', () => {
    const result = buildAccessReviewSnapshotForTest(users, assignments, now);

    expect(result.snapshot.counts).toMatchObject({
      users: 4,
      platform_admins: 1,
      inactive_users: 1,
      home_assignments: 2,
      no_home_users: 1,
      stale_users: 1,
    });
    expect(result.snapshot.role_counts).toEqual({ home_manager: 1, viewer: 1 });
    expect(JSON.stringify(result)).not.toContain('password');
    expect(JSON.stringify(result)).not.toContain('token');
    expect(result.assignments.find(row => row.username === 'no.home').exception_flags).toContain('no_home');
    expect(result.assignments.find(row => row.username === 'stale.viewer' && row.assignment_type === 'home_role').exception_flags).toContain('stale_login');
  });

  it('requires a platform admin actor for tenant-wide review reads', async () => {
    await expect(listAccessReviews({
      actor: { username: 'home.manager', isPlatformAdmin: false },
    })).rejects.toMatchObject({ statusCode: 403 });
    expect(accessReviewRepo.listReviews).not.toHaveBeenCalled();
  });

  it('starts one quarterly review with source users and assignments', async () => {
    accessReviewRepo.findReviewByKey.mockResolvedValue(null);
    accessReviewRepo.listAccessReviewSourceUsers.mockResolvedValue(users);
    accessReviewRepo.listAccessReviewSourceAssignments.mockResolvedValue(assignments);
    accessReviewRepo.insertReview.mockResolvedValue({
      id: 99,
      review_key: 'quarterly:2026-04-01',
      cadence: 'quarterly',
      period_start: '2026-04-01',
      period_end: '2026-06-30',
      status: 'in_progress',
    });
    accessReviewRepo.insertAssignments.mockImplementation(async (_reviewId, rows) => rows);

    const result = await startAccessReview({ actor, cadence: 'quarterly', now });

    expect(accessReviewRepo.insertReview).toHaveBeenCalledWith(expect.objectContaining({
      review_key: 'quarterly:2026-04-01',
      started_by_username: 'platform.admin',
    }), expect.any(Object));
    expect(result.assignments.length).toBeGreaterThan(assignments.length);
    expect(result.snapshot.counts.platform_admins).toBe(1);
    expect(auditService.log).toHaveBeenCalledWith('access_review_started', null, 'platform.admin', expect.objectContaining({
      reviewId: 99,
      cadence: 'quarterly',
      assignmentCount: result.assignments.length,
    }), expect.any(Object));
  });

  it('blocks duplicate review periods', async () => {
    accessReviewRepo.findReviewByKey.mockResolvedValue({ id: 88 });

    await expect(startAccessReview({ actor, cadence: 'monthly', now }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(accessReviewRepo.insertReview).not.toHaveBeenCalled();
  });

  it('records assignment decisions with reviewer notes', async () => {
    const review = {
      id: 99,
      status: 'in_progress',
    };
    accessReviewRepo.findReviewByIdForUpdate.mockResolvedValue(review);
    accessReviewRepo.findReviewById.mockResolvedValue(review);
    accessReviewRepo.findAssignmentByIdForUpdate.mockResolvedValue({
      id: 123,
      review_id: 99,
      assignment_key: 'home:10:finance.user',
      username: 'finance.user',
      home_slug: 'amberwood',
      status: 'pending',
    });
    accessReviewRepo.updateAssignmentStatus.mockResolvedValue({
      id: 123,
      review_id: 99,
      assignment_key: 'home:10:finance.user',
      username: 'finance.user',
      home_slug: 'amberwood',
      status: 'needs_change',
      notes: 'Remove finance role',
      reviewed_by_username: 'platform.admin',
    });
    accessReviewRepo.insertAssignmentDecision.mockResolvedValue({ id: 700 });

    const result = await updateAccessReviewAssignment({
      actor,
      reviewId: 99,
      assignmentId: 123,
      status: 'needs_change',
      notes: 'Remove finance role',
    });

    expect(accessReviewRepo.updateAssignmentStatus).toHaveBeenCalledWith(99, 123, {
      status: 'needs_change',
      notes: 'Remove finance role',
      reviewed_by_username: 'platform.admin',
    }, expect.any(Object));
    expect(accessReviewRepo.insertAssignmentDecision).toHaveBeenCalledWith({
      review_id: 99,
      assignment_id: 123,
      assignment_key: 'home:10:finance.user',
      from_status: 'pending',
      to_status: 'needs_change',
      notes: 'Remove finance role',
      decided_by_username: 'platform.admin',
    }, expect.any(Object));
    expect(accessReviewRepo.findAssignmentByIdForUpdate).toHaveBeenCalledWith(99, 123, expect.any(Object));
    expect(auditService.log).toHaveBeenCalledWith('access_review_assignment_decision', 'amberwood', 'platform.admin', expect.objectContaining({
      reviewId: 99,
      assignmentId: 123,
      fromStatus: 'pending',
      toStatus: 'needs_change',
    }), expect.any(Object));
    expect(result.reviewed_by_username).toBe('platform.admin');
  });

  it('blocks completion while assignments are still pending', async () => {
    const review = {
      id: 99,
      cadence: 'quarterly',
      period_start: '2026-04-01',
      period_end: '2026-04-30',
      status: 'in_progress',
      assignment_counts: { pending: 1, reviewed: 2 },
    };
    accessReviewRepo.findReviewByIdForUpdate.mockResolvedValue(review);
    accessReviewRepo.findReviewById.mockResolvedValue(review);

    await expect(completeAccessReview({
      actor,
      reviewId: 99,
      now: new Date('2026-05-04T12:00:00Z'),
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(accessReviewRepo.markReviewCompleted).not.toHaveBeenCalled();
  });

  it('blocks completion while access changes are unresolved', async () => {
    const review = {
      id: 99,
      cadence: 'quarterly',
      period_start: '2026-04-01',
      period_end: '2026-04-30',
      status: 'in_progress',
      assignment_counts: { pending: 0, needs_change: 1, revoked_requested: 1 },
    };
    accessReviewRepo.findReviewByIdForUpdate.mockResolvedValue(review);
    accessReviewRepo.findReviewById.mockResolvedValue(review);

    await expect(completeAccessReview({
      actor,
      reviewId: 99,
      now: new Date('2026-05-04T12:00:00Z'),
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(accessReviewRepo.markReviewCompleted).not.toHaveBeenCalled();
  });

  it('audits completion when every assignment has been decided', async () => {
    const review = {
      id: 99,
      cadence: 'quarterly',
      period_start: '2026-04-01',
      period_end: '2026-04-30',
      status: 'in_progress',
      assignment_counts: { reviewed: 3 },
    };
    accessReviewRepo.findReviewByIdForUpdate.mockResolvedValue(review);
    accessReviewRepo.findReviewById.mockResolvedValue(review);
    accessReviewRepo.markReviewCompleted.mockResolvedValue({
      id: 99,
      cadence: 'quarterly',
      period_start: '2026-04-01',
      period_end: '2026-04-30',
      status: 'completed',
      assignment_counts: { reviewed: 3 },
    });

    await completeAccessReview({
      actor,
      reviewId: 99,
      now: new Date('2026-05-04T12:00:00Z'),
    });

    expect(accessReviewRepo.markReviewCompleted).toHaveBeenCalledWith(99, 'platform.admin', expect.any(Object));
    expect(auditService.log).toHaveBeenCalledWith('access_review_completed', null, 'platform.admin', expect.objectContaining({
      reviewId: 99,
      assignmentCounts: { reviewed: 3 },
    }), expect.any(Object));
  });

  it('rejects invalid assignment status transitions', async () => {
    await expect(updateAccessReviewAssignment({
      actor,
      reviewId: 99,
      assignmentId: 123,
      status: 'approved',
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(accessReviewRepo.updateAssignmentStatus).not.toHaveBeenCalled();
  });
});
