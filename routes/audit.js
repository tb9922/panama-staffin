import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as auditService from '../services/auditService.js';

const router = Router();

router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const raw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(raw) ? Math.min(10000, Math.max(1, raw)) : 100;
    const entries = await auditService.getRecent(limit);
    res.json(entries);
  } catch (err) {
    next(err);
  }
});

export default router;
