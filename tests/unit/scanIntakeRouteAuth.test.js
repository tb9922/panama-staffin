import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { username: 'scan-route-tester', role: 'viewer', is_platform_admin: false };
    next();
  },
  requireHomeAccess: (req, _res, next) => {
    req.home = { id: 1, slug: 'home-a', config: { scan_intake_enabled: true } };
    req.homeRole = req.headers['x-home-role'] || 'shift_coordinator';
    next();
  },
}));

vi.mock('../../lib/rateLimiter.js', () => ({
  readRateLimiter: (_req, _res, next) => next(),
  writeRateLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../repositories/documentIntakeRepo.js', () => ({
  findById: vi.fn(),
  listByHome: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../../services/scanIntakeService.js', () => ({
  confirmScanIntake: vi.fn(),
  createScanIntake: vi.fn(),
  decryptExtraction: vi.fn(item => item.extraction || null),
  retryScanIntake: vi.fn(),
}));

vi.mock('../../services/auditService.js', () => ({
  log: vi.fn(),
}));

vi.mock('../../lib/malwareScan.js', () => ({
  assertFilePassedMalwareScan: vi.fn(),
}));

import scanIntakeRouter from '../../routes/scanIntake.js';
import * as scanIntakeService from '../../services/scanIntakeService.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/scan-intake', scanIntakeRouter);
  return app;
}

const app = makeApp();

function handoverPayload(category) {
  return {
    target: 'handover',
    handover: {
      entry_date: '2026-05-04',
      shift: 'E',
      category,
      priority: 'info',
      content: `${category} scan note`,
    },
  };
}

describe('scan intake handover category authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scanIntakeService.confirmScanIntake.mockResolvedValue({
      id: 7,
      routed_module: 'handover',
      routed_record_id: 'handover-1',
    });
  });

  it('blocks scheduling-only users from filing clinical handover scans', async () => {
    await request(app)
      .post('/api/scan-intake/7/confirm?home=home-a')
      .set('x-home-role', 'shift_coordinator')
      .send(handoverPayload('clinical'))
      .expect(403);

    expect(scanIntakeService.confirmScanIntake).not.toHaveBeenCalled();
  });

  it('allows scheduling-only users to file operational handover scans', async () => {
    await request(app)
      .post('/api/scan-intake/7/confirm?home=home-a')
      .set('x-home-role', 'shift_coordinator')
      .send(handoverPayload('operational'))
      .expect(200);

    expect(scanIntakeService.confirmScanIntake).toHaveBeenCalledWith(
      1,
      7,
      expect.objectContaining({ target: 'handover' }),
      'scan-route-tester',
    );
  });

  it('allows compliance writers to file clinical handover scans', async () => {
    await request(app)
      .post('/api/scan-intake/7/confirm?home=home-a')
      .set('x-home-role', 'training_lead')
      .send(handoverPayload('clinical'))
      .expect(200);

    expect(scanIntakeService.confirmScanIntake).toHaveBeenCalled();
  });
});
