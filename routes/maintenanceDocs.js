import { Router } from 'express';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter } from '../lib/rateLimiter.js';
import { getMaintenanceDocs } from '../services/maintenanceDocsService.js';

const router = Router();

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    res.json(await getMaintenanceDocs(req.home.id));
  } catch (err) {
    next(err);
  }
});

export default router;
