import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeService from '../services/homeService.js';

const router = Router();

router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const homes = await homeService.listHomes();
    res.json(homes);
  } catch (err) {
    next(err);
  }
});

export default router;
