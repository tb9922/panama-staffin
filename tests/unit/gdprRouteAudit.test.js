import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { username: 'gdpr.manager', role: 'viewer', is_platform_admin: false };
    req.authDbUser = { active: true, role: 'viewer', is_platform_admin: false };
    next();
  },
  requireHomeAccess: (req, _res, next) => {
    req.home = { id: 1, slug: 'home-a' };
    req.homeRole = 'home_manager';
    next();
  },
  requireModule: () => (_req, _res, next) => next(),
}));

vi.mock('../../lib/rateLimiter.js', () => ({
  readRateLimiter: (_req, _res, next) => next(),
  writeRateLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../repositories/homeRepo.js', () => ({
  findBySlug: vi.fn(),
  listAllWithIds: vi.fn(),
}));

vi.mock('../../repositories/userHomeRepo.js', () => ({
  findHomeSlugsForUser: vi.fn(),
  getHomeRole: vi.fn(),
  hasAccess: vi.fn(),
}));

vi.mock('../../services/gdprService.js', () => ({
  findBreachById: vi.fn(),
  updateBreach: vi.fn(),
}));

vi.mock('../../services/auditService.js', () => ({
  log: vi.fn(),
}));

import gdprRouter from '../../routes/gdpr.js';
import * as auditService from '../../services/auditService.js';
import * as gdprService from '../../services/gdprService.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/gdpr', gdprRouter);
  return app;
}

const app = makeApp();

describe('GDPR breach audit redaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redacts breach narratives in update and override audit details', async () => {
    const existing = {
      id: 12,
      title: 'Old resident-identifying title',
      description: 'Old narrative about a named resident',
      containment_actions: 'Old containment narrative',
      root_cause: 'Old root cause narrative',
      preventive_measures: 'Old preventive narrative',
      decision_rationale: 'Old rationale narrative',
      recommended_ico_notification: true,
      manual_decision: null,
      version: 3,
    };
    const updated = {
      ...existing,
      title: 'New resident-identifying title',
      description: 'New narrative about a named resident',
      containment_actions: 'New containment narrative',
      root_cause: 'New root cause narrative',
      preventive_measures: 'New preventive narrative',
      decision_rationale: 'New rationale narrative',
      manual_decision: false,
      version: 4,
    };
    gdprService.findBreachById.mockResolvedValue(existing);
    gdprService.updateBreach.mockResolvedValue(updated);

    await request(app)
      .put('/api/gdpr/breaches/12?home=home-a')
      .send({
        title: updated.title,
        description: updated.description,
        containment_actions: updated.containment_actions,
        root_cause: updated.root_cause,
        preventive_measures: updated.preventive_measures,
        manual_decision: false,
        decision_rationale: updated.decision_rationale,
        _version: 3,
      })
      .expect(200);

    const updateAudit = auditService.log.mock.calls.find(([action]) => action === 'gdpr_breach_update');
    expect(updateAudit).toBeTruthy();
    expect(updateAudit[3].changes).toEqual(expect.arrayContaining([
      { field: 'title', old: '[REDACTED]', new: '[REDACTED]' },
      { field: 'description', old: '[REDACTED]', new: '[REDACTED]' },
      { field: 'containment_actions', old: '[REDACTED]', new: '[REDACTED]' },
      { field: 'root_cause', old: '[REDACTED]', new: '[REDACTED]' },
      { field: 'preventive_measures', old: '[REDACTED]', new: '[REDACTED]' },
      { field: 'decision_rationale', old: '[REDACTED]', new: '[REDACTED]' },
    ]));
    expect(JSON.stringify(updateAudit[3])).not.toContain('New narrative');

    const overrideAudit = auditService.log.mock.calls.find(([action]) => action === 'breach_ico_override');
    expect(overrideAudit[3]).toEqual({
      id: 12,
      recommended: true,
      decision: false,
      rationaleProvided: true,
    });
  });
});
