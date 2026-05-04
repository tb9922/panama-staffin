import { Router } from 'express';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js';
import { readRateLimiter } from '../lib/rateLimiter.js';
import { getOpsStatus } from '../services/opsStatusService.js';

const router = Router();

router.get('/status', readRateLimiter, requireAuth, requirePlatformAdmin, async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getOpsStatus());
  } catch (err) {
    next(err);
  }
});

export default router;
