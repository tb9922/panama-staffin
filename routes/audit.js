import { Router } from 'express';
import { z } from 'zod';
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

// DELETE /api/audit/purge — remove audit entries older than N days (default 2555 = ~7 years)
const purgeSchema = z.object({
  days: z.coerce.number().int().min(30).max(3650).default(2555),
});

router.delete('/purge', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const parsed = purgeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const deleted = await auditService.purgeOlderThan(parsed.data.days);
    res.json({ deleted, days: parsed.data.days });
  } catch (err) {
    next(err);
  }
});

export default router;
