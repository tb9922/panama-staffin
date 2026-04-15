import { Router } from 'express';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter } from '../lib/rateLimiter.js';
import { getCqcDocs } from '../services/cqcDocsService.js';

const router = Router();

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    res.json(await getCqcDocs(req.home.id));
  } catch (err) {
    next(err);
  }
});

export default router;
