import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireHomeAccess } from '../middleware/auth.js';
import * as dashboardService from '../services/dashboardService.js';

const router = Router();

// ── Rate limiting — dashboard endpoints ─────────────────────────────────────
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
}));

router.get('/summary', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    res.json(await dashboardService.getDashboardSummary(req.home.id));
  } catch (err) { next(err); }
});

export default router;
