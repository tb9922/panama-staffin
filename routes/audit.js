import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as auditService from '../services/auditService.js';
import * as homeRepo from '../repositories/homeRepo.js';
import { hasAccess } from '../repositories/userHomeRepo.js';
import { readRateLimiter } from '../lib/rateLimiter.js';

const router = Router();
router.use(readRateLimiter);

const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(100).optional();

router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const raw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(raw) ? Math.min(10000, Math.max(1, raw)) : 100;
    const homeP = homeIdSchema.safeParse(req.query.home);
    if (!homeP.success) return res.status(400).json({ error: 'Invalid home parameter' });
    if (homeP.data) {
      const home = await homeRepo.findBySlug(homeP.data);
      if (!home) return res.status(404).json({ error: 'Home not found' });
      const allowed = await hasAccess(req.user.username, home.id);
      if (!allowed) return res.status(403).json({ error: 'You do not have access to this home' });
    }
    const entries = await auditService.getRecent(limit, homeP.data);
    res.json(entries);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/audit/purge — remove audit entries older than N days (default 2555 = ~7 years)
const purgeSchema = z.object({
  days: z.coerce.number().int().min(30).max(3650).default(2555),
});

router.delete('/purge', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = purgeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const deleted = await auditService.purgeOlderThan(parsed.data.days, req.home.slug);
    res.json({ deleted, days: parsed.data.days, home: req.home.slug });
  } catch (err) {
    next(err);
  }
});

export default router;
