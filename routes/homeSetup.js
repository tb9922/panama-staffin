import { Router } from 'express';
import { isVerifiedPlatformAdmin, requireAuth, requirePlatformAdmin } from '../middleware/auth.js';
import { readRateLimiter } from '../lib/rateLimiter.js';
import * as homeSetupService from '../services/homeSetupService.js';

const router = Router();

router.get('/', readRateLimiter, requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const result = await homeSetupService.getHomeSetupCompletenessForUser({
      username: req.user.username,
      isPlatformAdmin: isVerifiedPlatformAdmin(req),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
