import { describe, expect, it, vi } from 'vitest';
import { buildNotificationDigest } from '../../services/notificationDigestService.js';

const TODAY = new Date('2026-05-04T12:00:00Z');

function makeRepos(overrides = {}) {
  return {
    actionItemRepo: {
      findByHome: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
      ...overrides.actionItemRepo,
    },
    auditTaskRepo: {
      findByHome: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
      ...overrides.auditTaskRepo,
    },
    trainingRepo: {
      findByHome: vi.fn().mockResolvedValue({ rows: {}, total: 0 }),
      ...overrides.trainingRepo,
    },
    agencyAttemptRepo: {
      countEmergencyOverridesByHome: vi.fn().mockResolvedValue([]),
      ...overrides.agencyAttemptRepo,
    },
  };
}

function digestArgs(repos, extra = {}) {
  return {
    homeId: 10,
    homeSlug: 'digest-home',
    homeName: 'Digest Home',
    homeRole: 'home_manager',
    today: TODAY,
    repos,
    ...extra,
  };
}

describe('notificationDigestService', () => {
  it('returns a clean empty in-app digest when there are no actionable exceptions', async () => {
    const repos = makeRepos();

    const digest = await buildNotificationDigest(digestArgs(repos));

    expect(digest.empty).toBe(true);
    expect(digest.degraded).toBe(false);
    expect(digest.counts.total).toBe(0);
    expect(digest.items).toEqual([]);
    expect(digest.delivery).toMatchObject({
      channels: ['in_app'],
      email: { enabled: false },
    });
  });

  it('keeps digest items scoped to the requested home even if a source returns mixed rows', async () => {
    const repos = makeRepos({
      actionItemRepo: {
        findByHome: vi.fn().mockResolvedValue({
          rows: [
            {
              id: 1,
              home_id: 10,
              title: 'Home A action',
              due_date: '2026-05-01',
              status: 'open',
              priority: 'high',
              escalation_level: 1,
            },
            {
              id: 2,
              home_id: 11,
              title: 'Home B action',
              due_date: '2026-04-20',
              status: 'open',
              priority: 'critical',
              escalation_level: 4,
            },
          ],
          total: 2,
        }),
      },
      auditTaskRepo: {
        findByHome: vi.fn().mockResolvedValue({
          rows: [
            { id: 3, home_id: 11, title: 'Other home audit', due_date: '2026-05-04', status: 'open' },
          ],
          total: 1,
        }),
      },
      agencyAttemptRepo: {
        countEmergencyOverridesByHome: vi.fn().mockResolvedValue([
          { home_id: 11, attempts_7d: 4, emergency_overrides_7d: 4 },
        ]),
      },
    });

    const digest = await buildNotificationDigest(digestArgs(repos));

    expect(repos.actionItemRepo.findByHome).toHaveBeenCalledWith(10, expect.objectContaining({ overdue: true }));
    expect(repos.auditTaskRepo.findByHome).toHaveBeenCalledWith(10, expect.objectContaining({ status: 'open' }));
    expect(repos.agencyAttemptRepo.countEmergencyOverridesByHome).toHaveBeenCalledWith([10]);
    expect(digest.items).toHaveLength(1);
    expect(digest.items[0]).toMatchObject({
      homeId: 10,
      source: { table: 'action_items', id: 1 },
      title: 'Home A action',
    });
  });

  it('orders critical digest exceptions ahead of warnings and informational due items', async () => {
    const repos = makeRepos({
      actionItemRepo: {
        findByHome: vi.fn().mockResolvedValue({
          rows: [
            {
              id: 10,
              home_id: 10,
              title: 'Low action overdue',
              due_date: '2026-05-03',
              status: 'open',
              priority: 'low',
              escalation_level: 0,
            },
          ],
          total: 1,
        }),
      },
      auditTaskRepo: {
        findByHome: vi.fn().mockResolvedValue({
          rows: [
            { id: 20, home_id: 10, title: 'Daily medication audit', due_date: '2026-05-04', status: 'open' },
          ],
          total: 1,
        }),
      },
      trainingRepo: {
        findByHome: vi.fn().mockResolvedValue({
          rows: {
            'STAFF-1': {
              'fire-safety': { completed: '2025-05-01', expiry: '2026-05-01' },
            },
          },
          total: 1,
        }),
      },
      agencyAttemptRepo: {
        countEmergencyOverridesByHome: vi.fn().mockResolvedValue([
          { home_id: 10, attempts_7d: 4, emergency_overrides_7d: 2 },
        ]),
      },
    });

    const digest = await buildNotificationDigest(digestArgs(repos, {
      homeConfig: {
        training_types: [
          { id: 'fire-safety', name: 'Fire Safety', category: 'statutory', active: true },
        ],
      },
    }));

    expect(digest.items.map(item => item.severity)).toEqual(['error', 'error', 'warning', 'info']);
    expect(digest.items[0].type).toBe('agency_emergency_override');
    expect(digest.items[1]).toMatchObject({
      type: 'training',
      title: 'Training expired',
    });
  });

  it('does not query or expose sources outside the home role module permissions', async () => {
    const repos = makeRepos();

    const digest = await buildNotificationDigest(digestArgs(repos, {
      homeRole: 'finance_officer',
    }));

    expect(repos.actionItemRepo.findByHome).not.toHaveBeenCalled();
    expect(repos.auditTaskRepo.findByHome).not.toHaveBeenCalled();
    expect(repos.trainingRepo.findByHome).not.toHaveBeenCalled();
    expect(repos.agencyAttemptRepo.countEmergencyOverridesByHome).toHaveBeenCalledWith([10]);
    expect(digest.items).toEqual([]);
  });
});
