import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getHttpErrorResponse } from '../../errors.js';

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    if (req.headers.authorization !== 'Bearer platform') {
      return res.status(401).json({ error: 'Unauthorised' });
    }
    req.user = { username: 'platform.admin', role: 'admin', is_platform_admin: true };
    req.authDbUser = { username: 'platform.admin', role: 'admin', active: true, is_platform_admin: true };
    return next();
  },
  isVerifiedPlatformAdmin: req => req.authDbUser?.active === true
    && req.authDbUser?.role === 'admin'
    && req.authDbUser?.is_platform_admin === true,
  requirePlatformAdmin: (_req, _res, next) => next(),
}));

vi.mock('../../lib/rateLimiter.js', () => ({
  readRateLimiter: (_req, _res, next) => next(),
  writeRateLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../services/accessReviewService.js', () => ({
  ACCESS_REVIEW_ASSIGNMENT_STATUSES: ['pending', 'reviewed', 'needs_change', 'revoked_requested'],
  ACCESS_REVIEW_CADENCES: ['monthly', 'quarterly'],
  ACCESS_REVIEW_STATUSES: ['in_progress', 'completed'],
  completeAccessReview: vi.fn(),
  getAccessReview: vi.fn(),
  listAccessReviews: vi.fn(),
  startAccessReview: vi.fn(),
  updateAccessReviewAssignment: vi.fn(),
}));

import accessReviewsRouter from '../../routes/accessReviews.js';
import * as accessReviewService from '../../services/accessReviewService.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/access-reviews', accessReviewsRouter);
  app.use((err, _req, res, _next) => {
    void _next;
    const response = getHttpErrorResponse(err);
    if (response) return res.status(response.statusCode).json({ error: response.message, code: response.code });
    return res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

const app = makeApp();

describe('access review route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accessReviewService.getAccessReview.mockResolvedValue({
      review: { id: 99, status: 'in_progress' },
      assignments: [],
      _total: 0,
    });
  });

  it('parses exception_only=false as false', async () => {
    await request(app)
      .get('/api/access-reviews/99?exception_only=false&limit=250')
      .set('Authorization', 'Bearer platform')
      .expect(200);

    expect(accessReviewService.getAccessReview).toHaveBeenCalledWith({
      actor: { username: 'platform.admin', isPlatformAdmin: true },
      reviewId: 99,
      filters: expect.objectContaining({
        exceptionOnly: false,
        limit: 250,
      }),
    });
  });

  it('rejects invalid review and assignment ids before service calls', async () => {
    await request(app)
      .get('/api/access-reviews/not-a-number')
      .set('Authorization', 'Bearer platform')
      .expect(400);

    await request(app)
      .patch('/api/access-reviews/99/assignments/abc')
      .set('Authorization', 'Bearer platform')
      .send({ status: 'reviewed' })
      .expect(400);

    await request(app)
      .post('/api/access-reviews/1.5/complete')
      .set('Authorization', 'Bearer platform')
      .expect(400);

    expect(accessReviewService.getAccessReview).not.toHaveBeenCalled();
    expect(accessReviewService.updateAccessReviewAssignment).not.toHaveBeenCalled();
    expect(accessReviewService.completeAccessReview).not.toHaveBeenCalled();
  });
});
