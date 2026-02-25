import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as auditService from '../services/auditService.js';

const router = Router();

router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const entries = await auditService.getRecent(100);
    res.json(entries);
  } catch (err) {
    next(err);
  }
});

export default router;
