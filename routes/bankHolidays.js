import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import logger from '../logger.js';
import { readRateLimiter } from '../lib/rateLimiter.js';

const router = Router();
router.use(readRateLimiter);

let bankHolidayCache = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const now = Date.now();
    if (bankHolidayCache && now < cacheExpiry) {
      return res.json(bankHolidayCache);
    }

    let data;
    try {
      const response = await fetch('https://www.gov.uk/bank-holidays.json', {
        signal: AbortSignal.timeout(5000),
      });
      data = await response.json();
    } catch (fetchErr) {
      if (bankHolidayCache) {
        logger.warn({ err: fetchErr.message }, 'bank holiday fetch failed, returning stale cache');
        return res.json(bankHolidayCache);
      }
      throw fetchErr;
    }

    const holidays = (data['england-and-wales']?.events || []).map(e => ({ date: e.date, name: e.title }));
    bankHolidayCache = holidays;
    cacheExpiry = now + CACHE_TTL_MS;
    res.json(holidays);
  } catch (err) {
    logger.error({ err: err.message }, 'bank holiday fetch failed');
    next(err);
  }
});

export default router;
