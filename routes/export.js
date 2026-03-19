import { Router } from 'express';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import * as homeService from '../services/homeService.js';
import * as auditService from '../services/auditService.js';
import { readRateLimiter } from '../lib/rateLimiter.js';

const router = Router();
router.use(readRateLimiter);

router.get('/', requireAuth, requireHomeAccess, requireModule('reports', 'read'), async (req, res, next) => {
  try {
    const homeSlug = req.home.slug;

    // Pass the real per-home role so assembleData's PII_ROLES allowlist applies correctly.
    // Training leads, HR officers, and finance officers have legitimate access to NI/DoB/hourly_rate.
    const data = await homeService.assembleData(homeSlug, req.homeRole);

    await auditService.log('data_export', homeSlug, req.user.username, null);

    res.setHeader('Content-Disposition', `attachment; filename="${homeSlug}_data.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
