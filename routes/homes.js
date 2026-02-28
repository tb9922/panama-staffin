import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as homeService from '../services/homeService.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as auditService from '../services/auditService.js';
import * as userHomeRepo from '../repositories/userHomeRepo.js';
import { diffFields } from '../lib/audit.js';
import { writeRateLimiter } from '../lib/rateLimiter.js';

const router = Router();
router.use(writeRateLimiter);

const configBodySchema = z.object({
  config: z.object({}).passthrough(),
}).strict();

router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const homes = await homeService.listHomes();
    const allowedIds = await userHomeRepo.findHomeSlugsForUser(req.user.username);
    const allowedSet = new Set(allowedIds);
    res.json(homes.filter(h => allowedSet.has(h.id)));
  } catch (err) {
    next(err);
  }
});

// PUT /api/homes/config?home=X — update the config JSONB for a home
router.put('/config', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = configBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'config object required' });
    }

    const before = req.home.config ?? {};
    await homeRepo.updateConfig(req.home.id, parsed.data.config);
    const changes = diffFields(before, parsed.data.config);
    await auditService.log('home_config_update', req.home.slug, req.user.username, { changes });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
