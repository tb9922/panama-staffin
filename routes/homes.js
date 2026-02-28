import { Router } from 'express';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as homeService from '../services/homeService.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as auditService from '../services/auditService.js';
import * as userHomeRepo from '../repositories/userHomeRepo.js';

const router = Router();

router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const homes = await homeService.listHomes();
    const allowedIds = await userHomeRepo.findHomeIdsForUser(req.user.username);
    const allowedSet = new Set(allowedIds);
    res.json(homes.filter(h => allowedSet.has(h.id)));
  } catch (err) {
    next(err);
  }
});

// PUT /api/homes/config?home=X — update the config JSONB for a home
router.put('/config', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    if (!req.body?.config || typeof req.body.config !== 'object') {
      return res.status(400).json({ error: 'config object required' });
    }
    await homeRepo.updateConfig(req.home.id, req.body.config);
    await auditService.log('config_update', req.home.slug, req.user.username, null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
