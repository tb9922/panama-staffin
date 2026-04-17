import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import logger from '../logger.js';
import { readRateLimiter } from '../lib/rateLimiter.js';

const router = Router();
router.use(readRateLimiter);

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const VALID_REGIONS = new Set(['england-and-wales', 'scotland', 'northern-ireland']);
const bankHolidayCache = new Map();

function normaliseRegion(region) {
  return String(region || 'england-and-wales').trim().toLowerCase();
}

export function __resetBankHolidayCacheForTests() {
  bankHolidayCache.clear();
}

export function __primeBankHolidayCacheForTests(cache, expiresAt = Date.now() + CACHE_TTL_MS, region = 'england-and-wales') {
  bankHolidayCache.set(normaliseRegion(region), { holidays: cache, expiresAt });
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const region = normaliseRegion(req.query.region);
    if (!VALID_REGIONS.has(region)) {
      return res.status(400).json({ error: 'Invalid bank holiday region' });
    }

    const now = Date.now();
    const cached = bankHolidayCache.get(region);
    if (cached && now < cached.expiresAt) {
      return res.json(cached.holidays);
    }

    let data;
    try {
      const response = await fetch('https://www.gov.uk/bank-holidays.json', {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        throw new Error(`GOV.UK bank holiday API returned ${response.status}`);
      }
      data = await response.json();
    } catch (fetchErr) {
      if (cached) {
        logger.warn({ err: fetchErr.message, region }, 'bank holiday fetch failed, returning stale cache');
        return res.json(cached.holidays);
      }
      throw fetchErr;
    }

    const events = data?.[region]?.events;
    if (!Array.isArray(events)) {
      logger.warn({ region }, 'Unexpected bank holiday response shape from GOV.UK');
      if (cached) return res.json(cached.holidays);
      return res.status(502).json({ error: 'Unexpected response from GOV.UK bank holidays API' });
    }

    const holidays = events
      .filter((event) => event.date && event.title)
      .map((event) => ({
        date: String(event.date).slice(0, 10),
        name: String(event.title).slice(0, 200),
      }));

    bankHolidayCache.set(region, { holidays, expiresAt: now + CACHE_TTL_MS });
    res.json(holidays);
  } catch (err) {
    logger.error({ err: err.message }, 'bank holiday fetch failed');
    next(err);
  }
});

export default router;
