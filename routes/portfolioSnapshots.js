import { Router } from 'express';
import { z } from 'zod';
import { zodError } from '../errors.js';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';
import { nullableDateInput, requiredDateInput } from '../lib/zodHelpers.js';
import {
  PERIOD_GRANULARITIES,
  capturePortfolioKpiSnapshotsForUser,
  listPortfolioKpiSnapshotsForUser,
} from '../services/portfolioSnapshotService.js';

const router = Router();

const granularitySchema = z.enum(PERIOD_GRANULARITIES);
const homeSlugSchema = z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/i, 'Invalid home slug');

const listQuerySchema = paginationSchema.extend({
  period_granularity: granularitySchema.optional(),
  from: nullableDateInput.optional(),
  to: nullableDateInput.optional(),
  home_id: z.coerce.number().int().positive().optional(),
  home_slug: homeSlugSchema.optional(),
});

const captureBodySchema = z.object({
  period_date: requiredDateInput.optional(),
  period_granularity: granularitySchema.default('daily'),
});

function authContext(req) {
  return {
    username: req.user.username,
    isPlatformAdmin: req.authDbUser?.is_platform_admin === true,
  };
}

router.get('/', readRateLimiter, requireAuth, async (req, res, next) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return zodError(res, parsed);
    if (parsed.data.from && parsed.data.to && parsed.data.to < parsed.data.from) {
      return res.status(400).json({ error: 'To date must be on or after from date' });
    }
    const result = await listPortfolioKpiSnapshotsForUser({
      ...authContext(req),
      filters: parsed.data,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/capture', writeRateLimiter, requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const parsed = captureBodySchema.safeParse(req.body || {});
    if (!parsed.success) return zodError(res, parsed);
    const result = await capturePortfolioKpiSnapshotsForUser({
      ...authContext(req),
      periodDate: parsed.data.period_date || new Date(),
      periodGranularity: parsed.data.period_granularity,
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

export default router;
