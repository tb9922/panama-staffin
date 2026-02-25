import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeService from '../services/homeService.js';
import { validateAll } from '../services/validationService.js';

const router = Router();

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

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || !Array.isArray(body.staff) || typeof body.config !== 'object') {
      return res.status(400).json({ error: 'Invalid data shape — expected { config, staff, overrides }' });
    }

    const homeParam = homeIdSchema.safeParse(req.query.home);
    if (!homeParam.success) return res.status(400).json({ error: 'Invalid home parameter' });
    const homeSlug = homeParam.data || body.config?.home_name?.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';

    const warnings = validateAll(body);
    await homeService.saveData(homeSlug, body, req.user?.username || 'unknown');

    res.json({ ok: true, warnings, backedUp: true });
  } catch (err) {
    next(err);
  }
});

export default router;
