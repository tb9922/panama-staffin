import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as homeService from '../services/homeService.js';
import * as auditService from '../services/auditService.js';
import { validateAll } from '../services/validationService.js';

const dataBodySchema = z.object({
  config: z.object({}).passthrough(),
  staff: z.array(z.object({}).passthrough()),
  overrides: z.object({}).passthrough(),
}).passthrough();

const router = Router();

const saveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many save requests — try again in 15 minutes' },
});

router.get('/', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const data = await homeService.assembleData(req.home.slug, req.user.role);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, requireAdmin, requireHomeAccess, saveLimiter, async (req, res, next) => {
  try {
    const parsed = dataBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid data shape — expected { config, staff, overrides }' });
    }
    const body = req.body;

    const homeSlug = req.home.slug;

    // Optimistic locking — detect concurrent saves before writing
    // Client sends _clientUpdatedAt (the server timestamp from when it last loaded data).
    // If the DB timestamp has moved on, someone else saved in the meantime — return 409.
    const clientUpdatedAt = body._clientUpdatedAt;
    if (clientUpdatedAt && req.home.updated_at) {
      const serverUpdatedAt = req.home.updated_at.toISOString();
      if (serverUpdatedAt !== clientUpdatedAt) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'This home was modified by someone else since you last loaded it.',
          serverUpdatedAt,
        });
      }
    }

    const warnings = validateAll(body);
    const username = req.user?.username || 'unknown';
    const result = await homeService.saveData(homeSlug, body, username);

    await auditService.log('data_save', homeSlug, username, {
      staffCount: body.staff.length,
      warningCount: warnings.length,
    });

    res.json({ ok: true, warnings, backedUp: true, _updatedAt: result?.updatedAt });
  } catch (err) {
    next(err);
  }
});

export default router;
