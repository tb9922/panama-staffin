import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  pool: {
    query: vi.fn(),
  },
  withTransaction: vi.fn(async fn => fn({ tx: true })),
}));

vi.mock('../../services/portfolioService.js', () => ({
  getPortfolioKpisForUser: vi.fn(),
  clearPortfolioCache: vi.fn(),
}));

vi.mock('../../repositories/portfolioSnapshotRepo.js', () => ({
  upsert: vi.fn(),
  listByHomeIds: vi.fn(),
}));

vi.mock('../../services/auditService.js', () => ({
  log: vi.fn(),
}));

import { pool } from '../../db.js';
import * as portfolioService from '../../services/portfolioService.js';
import * as portfolioSnapshotRepo from '../../repositories/portfolioSnapshotRepo.js';
import * as auditService from '../../services/auditService.js';
import {
  capturePortfolioKpiSnapshotsForUser,
  listPortfolioKpiSnapshotsForUser,
  normalizePeriod,
} from '../../services/portfolioSnapshotService.js';

const homeA = {
  home_id: 10,
  home_slug: 'home-a',
  home_name: 'Home A',
  staffing: { gaps_7d: 0, gaps_per_100_planned_shifts: 0 },
  training: { compliance_pct: 98 },
  rag: { staffing: 'green', training: 'green', overall: 'green' },
};

const homeB = {
  home_id: 20,
  home_slug: 'home-b',
  home_name: 'Home B',
  staffing: { gaps_7d: 3, gaps_per_100_planned_shifts: 12 },
  training: { compliance_pct: 88 },
  rag: { staffing: 'amber', training: 'red', overall: 'red' },
};

describe('portfolioSnapshotService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes weekly snapshots to the ISO week start date', () => {
    expect(normalizePeriod({
      periodDate: '2026-05-07',
      periodGranularity: 'weekly',
    })).toEqual({
      period_date: '2026-05-04',
      period_granularity: 'weekly',
    });
  });

  it('uses stable unique keys for idempotent snapshot upserts', async () => {
    portfolioService.getPortfolioKpisForUser.mockResolvedValue({
      generated_at: '2026-05-04T10:00:00.000Z',
      homes: [homeA, homeB],
    });
    portfolioSnapshotRepo.upsert.mockImplementation(async (homeId, data) => ({
      id: homeId,
      home_id: homeId,
      created_at: '2026-05-04T10:01:00.000Z',
      ...data,
    }));

    await capturePortfolioKpiSnapshotsForUser({
      username: 'manager',
      isPlatformAdmin: true,
      periodDate: '2026-05-04',
      periodGranularity: 'daily',
    });
    await capturePortfolioKpiSnapshotsForUser({
      username: 'manager',
      isPlatformAdmin: true,
      periodDate: '2026-05-04',
      periodGranularity: 'daily',
    });

    expect(portfolioSnapshotRepo.upsert).toHaveBeenCalledTimes(4);
    expect(portfolioService.clearPortfolioCache).toHaveBeenCalledTimes(2);
    expect(portfolioSnapshotRepo.upsert).toHaveBeenNthCalledWith(1, 10, expect.objectContaining({
      period_date: '2026-05-04',
      period_granularity: 'daily',
    }), expect.any(Object));
    expect(portfolioSnapshotRepo.upsert).toHaveBeenNthCalledWith(3, 10, expect.objectContaining({
      period_date: '2026-05-04',
      period_granularity: 'daily',
    }), expect.any(Object));
  });

  it('stores rag JSON separately from the KPI JSON shape', async () => {
    portfolioService.getPortfolioKpisForUser.mockResolvedValue({
      generated_at: '2026-05-04T10:00:00.000Z',
      homes: [homeA],
    });
    portfolioSnapshotRepo.upsert.mockImplementation(async (homeId, data) => ({
      id: 1,
      home_id: homeId,
      created_at: '2026-05-04T10:01:00.000Z',
      ...data,
    }));

    const result = await capturePortfolioKpiSnapshotsForUser({
      username: 'manager',
      isPlatformAdmin: true,
      periodDate: '2026-05-04',
    });

    expect(result.snapshots[0].rag).toEqual(homeA.rag);
    expect(result.snapshots[0].kpis).toMatchObject({
      home_id: 10,
      home_slug: 'home-a',
      staffing: { gaps_7d: 0 },
      training: { compliance_pct: 98 },
    });
    expect(result.snapshots[0].kpis).not.toHaveProperty('rag');
    expect(auditService.log).toHaveBeenCalledWith('portfolio_snapshot_capture', null, 'manager', expect.objectContaining({
      periodDate: '2026-05-04',
      periodGranularity: 'daily',
      homeCount: 1,
      homeIds: [10],
    }), expect.any(Object));
  });

  it('requires platform admin authority to capture snapshots', async () => {
    await expect(capturePortfolioKpiSnapshotsForUser({
      username: 'viewer',
      isPlatformAdmin: false,
      periodDate: '2026-05-04',
    })).rejects.toMatchObject({ statusCode: 403 });
    expect(portfolioSnapshotRepo.upsert).not.toHaveBeenCalled();
  });

  it('filters snapshot reads to report-visible homes before querying snapshots', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 10, slug: 'home-a', name: 'Home A', config: {}, role_id: 'viewer' },
        { id: 20, slug: 'home-b', name: 'Home B', config: {}, role_id: 'staff_member' },
        { id: 30, slug: 'home-c', name: 'Home C', config: {}, role_id: 'home_manager' },
      ],
    });
    portfolioSnapshotRepo.listByHomeIds.mockResolvedValueOnce({
      rows: [{ id: 1, home_id: 10, period_date: '2026-05-04', rag: {}, kpis: {} }],
      total: 1,
    });

    const result = await listPortfolioKpiSnapshotsForUser({
      username: 'manager',
      filters: { period_granularity: 'daily', from: '2026-05-01', to: '2026-05-04' },
    });

    expect(portfolioSnapshotRepo.listByHomeIds).toHaveBeenCalledWith([10, 30], expect.objectContaining({
      period_granularity: 'daily',
      from: '2026-05-01',
      to: '2026-05-04',
    }));
    expect(result._total).toBe(1);
  });

  it('returns no rows when a read filter names an inaccessible home', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 10, slug: 'home-a', name: 'Home A', config: {}, role_id: 'viewer' },
      ],
    });

    const result = await listPortfolioKpiSnapshotsForUser({
      username: 'manager',
      filters: { home_id: 99 },
    });

    expect(result).toEqual({ snapshots: [], _total: 0 });
    expect(portfolioSnapshotRepo.listByHomeIds).not.toHaveBeenCalled();
  });
});
