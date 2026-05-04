import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { username: 'route-tester', role: 'viewer', is_platform_admin: false };
    next();
  },
  requireHomeAccess: (req, _res, next) => {
    req.home = { id: 1, slug: 'home-a' };
    req.homeRole = req.headers['x-home-role'] || 'shift_coordinator';
    next();
  },
}));

vi.mock('../../lib/rateLimiter.js', () => ({
  readRateLimiter: (_req, _res, next) => next(),
  writeRateLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../repositories/handoverRepo.js', () => ({
  acknowledgeEntry: vi.fn(),
  createEntry: vi.fn(),
  deleteEntry: vi.fn(),
  findByHomeAndDate: vi.fn(),
  findByHomeAndDateRange: vi.fn(),
  findById: vi.fn(),
  updateEntry: vi.fn(),
}));

vi.mock('../../services/auditService.js', () => ({
  log: vi.fn(),
}));

vi.mock('../../services/cqcAutoLinkService.js', () => ({
  queueAutoLinkSync: vi.fn(),
}));

import handoverRouter from '../../routes/handover.js';
import * as handoverRepo from '../../repositories/handoverRepo.js';

const clinicalEntry = {
  id: '11111111-1111-4111-8111-111111111111',
  category: 'clinical',
  content: 'Clinical note',
  version: 1,
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/handover', handoverRouter);
  return app;
}

const app = makeApp();

describe('handover category authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters clinical and safety rows from scheduling-only readers', async () => {
    handoverRepo.findByHomeAndDate.mockResolvedValue({
      rows: [
        clinicalEntry,
        { id: '22222222-2222-4222-8222-222222222222', category: 'safety', content: 'Safety note' },
        { id: '33333333-3333-4333-8333-333333333333', category: 'operational', content: 'Ops note' },
        { id: '44444444-4444-4444-8444-444444444444', category: 'admin', content: 'Admin note' },
      ],
    });

    const res = await request(app)
      .get('/api/handover?home=home-a&date=2026-05-04')
      .set('x-home-role', 'shift_coordinator')
      .expect(200);

    expect(res.body.map((row) => row.category)).toEqual(['operational', 'admin']);
  });

  it('allows compliance readers to see clinical and safety rows', async () => {
    handoverRepo.findByHomeAndDate.mockResolvedValue({
      rows: [
        clinicalEntry,
        { id: '22222222-2222-4222-8222-222222222222', category: 'safety', content: 'Safety note' },
      ],
    });

    const res = await request(app)
      .get('/api/handover?home=home-a&date=2026-05-04')
      .set('x-home-role', 'training_lead')
      .expect(200);

    expect(res.body.map((row) => row.category)).toEqual(['clinical', 'safety']);
  });

  it('blocks scheduling-only writers from creating clinical handover entries', async () => {
    await request(app)
      .post('/api/handover?home=home-a')
      .set('x-home-role', 'shift_coordinator')
      .send({
        entry_date: '2026-05-04',
        shift: 'E',
        category: 'clinical',
        priority: 'urgent',
        content: 'Resident clinical note',
      })
      .expect(403);

    expect(handoverRepo.createEntry).not.toHaveBeenCalled();
  });

  it('requires compliance read before acknowledging clinical handover entries', async () => {
    handoverRepo.findById.mockResolvedValue(clinicalEntry);

    await request(app)
      .post(`/api/handover/${clinicalEntry.id}/acknowledge?home=home-a`)
      .set('x-home-role', 'shift_coordinator')
      .expect(403);

    expect(handoverRepo.acknowledgeEntry).not.toHaveBeenCalled();
  });
});
