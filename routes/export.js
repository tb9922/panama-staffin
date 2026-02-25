import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeService from '../services/homeService.js';

const router = Router();

const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid home ID').optional();

router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const homeParam = homeIdSchema.safeParse(req.query.home);
    if (!homeParam.success) return res.status(400).json({ error: 'Invalid home parameter' });
    const homeSlug = homeParam.data;
    if (!homeSlug) return res.status(400).json({ error: 'home parameter is required' });

    // Assemble as admin — exports full dataset including GDPR special-category fields
    const data = await homeService.assembleData(homeSlug, 'admin');
    res.setHeader('Content-Disposition', `attachment; filename=${homeSlug}_data.json`);
    res.setHeader('Content-Type', 'application/json');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
