import { Router } from 'express';
import { z } from 'zod';
import { zodError } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { readRateLimiter } from '../lib/rateLimiter.js';
import {
  OPERATIONAL_REVIEW_SEVERITIES,
  OPERATIONAL_REVIEW_TYPES,
  getOperationalReviewQueueForUser,
} from '../services/operationalReviewService.js';

const router = Router();

const listSchema = z.object({
  type: z.enum(OPERATIONAL_REVIEW_TYPES).optional(),
  severity: z.enum(OPERATIONAL_REVIEW_SEVERITIES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

router.get('/', readRateLimiter, requireAuth, async (req, res, next) => {
  try {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) return zodError(res, parsed);

    const result = await getOperationalReviewQueueForUser({
      username: req.user?.username,
      isPlatformAdmin: req.authDbUser?.is_platform_admin === true,
      ...parsed.data,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
