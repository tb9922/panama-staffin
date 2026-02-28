import { Router } from 'express';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as homeService from '../services/homeService.js';

const router = Router();

router.get('/', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const homeSlug = req.home.slug;

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
