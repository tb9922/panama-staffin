import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { readRateLimiter } from '../lib/rateLimiter.js';
import * as homeSetupService from '../services/homeSetupService.js';

const router = Router();

router.get('/', readRateLimiter, requireAuth, async (req, res, next) => {
  try {
    const result = await homeSetupService.getHomeSetupCompletenessForUser({
      username: req.user.username,
      isPlatformAdmin: req.authDbUser?.is_platform_admin === true,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
