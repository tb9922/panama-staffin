import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import logger from '../logger.js';
import { readRateLimiter } from '../lib/rateLimiter.js';

const router = Router();
router.use(readRateLimiter);

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const response = await fetch('https://www.gov.uk/bank-holidays.json');
    const data = await response.json();
    res.json((data['england-and-wales']?.events || []).map(e => ({ date: e.date, name: e.title })));
  } catch (err) {
    logger.error({ err: err.message }, 'bank holiday fetch failed');
    next(err);
  }
});

export default router;
