import { Router } from 'express';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter } from '../lib/rateLimiter.js';
import * as dashboardService from '../services/dashboardService.js';

const router = Router();

router.use(readRateLimiter);

router.get('/summary', requireAuth, requireHomeAccess, requireModule('scheduling', 'read'), async (req, res, next) => {
  try {
    res.json(await dashboardService.getDashboardSummary(req.home.id));
  } catch (err) { next(err); }
});

export default router;
