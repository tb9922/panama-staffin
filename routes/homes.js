import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeService from '../services/homeService.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as auditService from '../services/auditService.js';

const router = Router();

router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const homes = await homeService.listHomes();
    res.json(homes);
  } catch (err) {
    next(err);
  }
});

// PUT /api/homes/config?home=X — update the config JSONB for a home
router.put('/config', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const p = z.string().regex(/^[a-zA-Z0-9_-]+$/).optional().safeParse(req.query.home);
    if (!p.success || !p.data) return res.status(400).json({ error: 'home parameter is required' });
    const home = await homeRepo.findBySlug(p.data);
    if (!home) return res.status(404).json({ error: 'Home not found' });
    if (!req.body?.config || typeof req.body.config !== 'object') {
      return res.status(400).json({ error: 'config object required' });
    }
    await homeRepo.updateConfig(home.id, req.body.config);
    await auditService.log('config_update', p.data, req.user.username, null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
