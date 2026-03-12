import { Router } from 'express';
import { requireAuth, requireHomeAccess, requireModule } from '../../middleware/auth.js';
import * as hrService from '../../services/hrService.js';
import { staffIdSchema } from './schemas.js';

const router = Router();

// GET /api/hr/warnings?home=X
router.get('/warnings', requireAuth, requireHomeAccess, requireModule('hr', 'read'), async (req, res, next) => {
  try {
    res.json(await hrService.getActiveWarnings(req.home.id));
  } catch (err) { next(err); }
});

// GET /api/hr/stats?home=X
router.get('/stats', requireAuth, requireHomeAccess, requireModule('hr', 'read'), async (req, res, next) => {
  try {
    res.json(await hrService.getHrStats(req.home.id));
  } catch (err) { next(err); }
});

// ── Absence ─────────────────────────────────────────────────────────────────

// GET /api/hr/absence/summary?home=X
router.get('/absence/summary', requireAuth, requireHomeAccess, requireModule('hr', 'read'), async (req, res, next) => {
  try {
    res.json(await hrService.calculateBradfordScores(req.home.id));
  } catch (err) { next(err); }
});

// GET /api/hr/absence/staff/:staffId?home=X
router.get('/absence/staff/:staffId', requireAuth, requireHomeAccess, requireModule('hr', 'read'), async (req, res, next) => {
  try {
    const staffIdP = staffIdSchema.safeParse(req.params.staffId);
    if (!staffIdP.success) return res.status(400).json({ error: 'Invalid staff ID' });
    res.json(await hrService.getAbsenceSummary(req.home.id, staffIdP.data));
  } catch (err) { next(err); }
});

export default router;
