import { Router } from 'express';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter } from '../lib/rateLimiter.js';
import { getFinanceDocs } from '../services/financeDocsService.js';

const router = Router();

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('finance', 'read'), async (req, res, next) => {
  try {
    res.json(await getFinanceDocs(req.home.id));
  } catch (err) {
    next(err);
  }
});

export default router;
