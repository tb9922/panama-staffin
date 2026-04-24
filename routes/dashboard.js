import { Router } from 'express';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter } from '../lib/rateLimiter.js';
import * as dashboardService from '../services/dashboardService.js';
import { isOwnDataOnly } from '../shared/roles.js';

const router = Router();

router.use(readRateLimiter);

router.get('/summary', requireAuth, requireHomeAccess, requireModule('scheduling', 'read'), async (req, res, next) => {
  try {
    if (isOwnDataOnly(req.homeRole, 'scheduling')) {
      return res.status(403).json({ error: 'Dashboard summary is not available for own-data users' });
    }
    res.json(await dashboardService.getDashboardSummary(req.home.id, { homeRole: req.homeRole }));
  } catch (err) { next(err); }
});

export default router;
