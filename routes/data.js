import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeService from '../services/homeService.js';
import * as homeRepo from '../repositories/homeRepo.js';
import { validateAll } from '../services/validationService.js';

const router = Router();

const saveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many save requests — try again in 15 minutes' },
});

const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid home ID').optional();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const homeParam = homeIdSchema.safeParse(req.query.home);
    if (!homeParam.success) return res.status(400).json({ error: 'Invalid home parameter' });
    const homeSlug = homeParam.data;
    if (!homeSlug) return res.status(400).json({ error: 'home parameter is required' });

    const data = await homeService.assembleData(homeSlug, req.user.role);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, requireAdmin, saveLimiter, async (req, res, next) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || !Array.isArray(body.staff) || typeof body.config !== 'object') {
      return res.status(400).json({ error: 'Invalid data shape — expected { config, staff, overrides }' });
    }

    const homeParam = homeIdSchema.safeParse(req.query.home);
    if (!homeParam.success) return res.status(400).json({ error: 'Invalid home parameter' });
    const homeSlug = homeParam.data || body.config?.home_name?.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';

    // Optimistic locking — detect concurrent saves before writing
    // Client sends _clientUpdatedAt (the server timestamp from when it last loaded data).
    // If the DB timestamp has moved on, someone else saved in the meantime — return 409.
    const clientUpdatedAt = body._clientUpdatedAt;
    if (clientUpdatedAt) {
      const home = await homeRepo.findBySlug(homeSlug);
      if (home?.updated_at) {
        const serverUpdatedAt = home.updated_at.toISOString();
        if (serverUpdatedAt !== clientUpdatedAt) {
          return res.status(409).json({
            error: 'Conflict',
            message: 'This home was modified by someone else since you last loaded it.',
            serverUpdatedAt,
          });
        }
      }
    }

    const warnings = validateAll(body);
    const result = await homeService.saveData(homeSlug, body, req.user?.username || 'unknown');

    res.json({ ok: true, warnings, backedUp: true, _updatedAt: result?.updatedAt });
  } catch (err) {
    next(err);
  }
});

export default router;
