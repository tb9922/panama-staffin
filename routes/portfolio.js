import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { readRateLimiter } from '../lib/rateLimiter.js';
import * as portfolioService from '../services/portfolioService.js';
import * as auditService from '../services/auditService.js';

const router = Router();

router.use(readRateLimiter);

router.get('/kpis', requireAuth, async (req, res, next) => {
  try {
    // Cross-home endpoint: portfolioService filters to platform-admin homes or
    // homes where user_home_roles grants report visibility.
    const isPlatformAdmin = req.authDbUser?.is_platform_admin === true;
    const result = await portfolioService.getPortfolioKpisForUser({
      username: req.user.username,
      isPlatformAdmin,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/board-pack', requireAuth, async (req, res, next) => {
  try {
    const isPlatformAdmin = req.authDbUser?.is_platform_admin === true;
    const result = await portfolioService.getPortfolioBoardPackForUser({
      username: req.user.username,
      isPlatformAdmin,
    });
    const homeSlugs = (result.homes || []).map(home => home.home_slug).filter(Boolean);
    await Promise.all(homeSlugs.map(homeSlug => auditService.log(
      'portfolio_board_pack_download',
      homeSlug,
      req.user.username,
      {
        home_count: homeSlugs.length,
        home_slugs: homeSlugs,
        generated_at: result.generated_at,
      },
    )));
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
