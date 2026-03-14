import { Router } from 'express';
import { readRateLimiter } from '../lib/rateLimiter.js';
import { requireAuth, requireHomeAccess } from '../middleware/auth.js';
import * as dashboardService from '../services/dashboardService.js';

const router = Router();

router.use(readRateLimiter);

router.get('/summary', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    res.json(await dashboardService.getDashboardSummary(req.home.id));
  } catch (err) { next(err); }
});

export default router;
