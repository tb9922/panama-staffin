import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, getHttpErrorResponse } from '../../errors.js';

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    if (req.headers.authorization !== 'Bearer manager') {
      return res.status(401).json({ error: 'Unauthorised' });
    }
    req.user = { username: 'manager' };
    req.authDbUser = { id: 7 };
    next();
  },
  requireHomeAccess: (req, res, next) => {
    if (req.query.home === 'home-a') {
      req.home = { id: 1, slug: 'home-a' };
      req.homeRole = 'home_manager';
      return next();
    }
    if (req.query.home === 'home-b') {
      return res.status(403).json({ error: 'You do not have access to this home' });
    }
    return res.status(400).json({ error: 'home parameter is required' });
  },
  requireModule: () => (_req, _res, next) => next(),
}));

vi.mock('../../lib/rateLimiter.js', () => ({
  readRateLimiter: (_req, _res, next) => next(),
  writeRateLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../services/acquisitionService.js', () => ({
  ACQUISITION_ITEM_KEYS: [
    'staff_import',
    'resident_import',
    'training_import',
    'rota_baseline',
    'documents',
    'users',
    'audit_templates',
    'go_live_signoff',
  ],
  ACQUISITION_STATUSES: ['not_started', 'in_progress', 'blocked', 'ready', 'complete'],
  listChecklist: vi.fn(),
  getChecklistItem: vi.fn(),
  initializeChecklist: vi.fn(),
  createChecklistItem: vi.fn(),
  updateChecklistItem: vi.fn(),
  deleteChecklistItem: vi.fn(),
}));

import acquisitionRouter from '../../routes/acquisition.js';
import * as acquisitionService from '../../services/acquisitionService.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/acquisition', acquisitionRouter);
  app.use((err, _req, res, _next) => {
    void _next;
    const response = getHttpErrorResponse(err);
    if (response) return res.status(response.statusCode).json({ error: response.message, code: response.code });
    return res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

const app = makeApp();

describe('acquisition route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquisitionService.listChecklist.mockResolvedValue({
      items: [{ id: 1, item_key: 'staff_import', status: 'not_started' }],
      summary: { total: 1, ready: 0 },
    });
    acquisitionService.initializeChecklist.mockResolvedValue({
      inserted: [{ id: 1, item_key: 'staff_import' }],
      items: [{ id: 1, item_key: 'staff_import', status: 'not_started' }],
      summary: { total: 1 },
    });
    acquisitionService.createChecklistItem.mockResolvedValue({ id: 2, item_key: 'documents', status: 'in_progress' });
    acquisitionService.updateChecklistItem.mockResolvedValue({ id: 2, item_key: 'documents', status: 'ready', version: 2 });
    acquisitionService.deleteChecklistItem.mockResolvedValue({ id: 2, item_key: 'documents', deleted_at: '2026-05-04T10:00:00.000Z' });
  });

  it('lists checklist items for the selected accessible home', async () => {
    const res = await request(app)
      .get('/api/acquisition?home=home-a')
      .set('Authorization', 'Bearer manager')
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(acquisitionService.listChecklist).toHaveBeenCalledWith({ id: 1, slug: 'home-a' }, {});
  });

  it('enforces home access before service calls', async () => {
    await request(app)
      .get('/api/acquisition?home=home-b')
      .set('Authorization', 'Bearer manager')
      .expect(403);

    expect(acquisitionService.listChecklist).not.toHaveBeenCalled();
  });

  it('supports initialize, create, update and delete route flows', async () => {
    await request(app)
      .post('/api/acquisition/initialize?home=home-a')
      .set('Authorization', 'Bearer manager')
      .send({})
      .expect(201);

    await request(app)
      .post('/api/acquisition?home=home-a')
      .set('Authorization', 'Bearer manager')
      .send({ item_key: 'documents', status: 'in_progress' })
      .expect(201);

    await request(app)
      .put('/api/acquisition/2?home=home-a')
      .set('Authorization', 'Bearer manager')
      .send({ status: 'ready', _version: 1 })
      .expect(200);

    await request(app)
      .delete('/api/acquisition/2?home=home-a')
      .set('Authorization', 'Bearer manager')
      .send({ _version: 2 })
      .expect(200);

    expect(acquisitionService.initializeChecklist).toHaveBeenCalledWith(
      { id: 1, slug: 'home-a' },
      { id: 7, username: 'manager' }
    );
    expect(acquisitionService.createChecklistItem).toHaveBeenCalledWith(
      { id: 1, slug: 'home-a' },
      expect.objectContaining({ item_key: 'documents', status: 'in_progress' }),
      { id: 7, username: 'manager' }
    );
    expect(acquisitionService.updateChecklistItem).toHaveBeenCalledWith(
      { id: 1, slug: 'home-a' },
      2,
      { status: 'ready' },
      1,
      { id: 7, username: 'manager' }
    );
    expect(acquisitionService.deleteChecklistItem).toHaveBeenCalledWith(
      { id: 1, slug: 'home-a' },
      2,
      2,
      { id: 7, username: 'manager' }
    );
  });

  it('returns 409 for version conflicts', async () => {
    acquisitionService.updateChecklistItem.mockRejectedValueOnce(
      new ConflictError('Record was modified by another user. Please refresh and try again.', 'VERSION_CONFLICT')
    );

    const res = await request(app)
      .put('/api/acquisition/2?home=home-a')
      .set('Authorization', 'Bearer manager')
      .send({ status: 'ready', _version: 1 })
      .expect(409);

    expect(res.body).toMatchObject({
      error: 'Record was modified by another user. Please refresh and try again.',
      code: 'VERSION_CONFLICT',
    });
  });
});
