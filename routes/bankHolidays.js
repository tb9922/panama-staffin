import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import logger from '../logger.js';
import { readRateLimiter } from '../lib/rateLimiter.js';

const router = Router();
router.use(readRateLimiter);

const VALID_REGIONS = new Set(['england-and-wales', 'scotland', 'northern-ireland']);
const DEFAULT_REGION = 'england-and-wales';
let bankHolidayCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function __resetBankHolidayCacheForTests() {
  bankHolidayCache = new Map();
}

export function __primeBankHolidayCacheForTests(region, holidays, expiresAt = Date.now() + CACHE_TTL_MS) {
  bankHolidayCache.set(region, { holidays, expiresAt });
}

function getCachedRegion(region, now = Date.now()) {
  const cached = bankHolidayCache.get(region);
  if (!cached) return null;
  return now < cached.expiresAt ? cached.holidays : null;
}

function getStaleRegion(region) {
  return bankHolidayCache.get(region)?.holidays || null;
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const region = typeof req.query.region === 'string' ? req.query.region : DEFAULT_REGION;
    if (!VALID_REGIONS.has(region)) {
      return res.status(400).json({ error: 'Invalid bank holiday region' });
    }

    const now = Date.now();
    const cached = getCachedRegion(region, now);
    if (cached) {
      return res.json(cached);
    }

    let data;
    try {
      const response = await fetch('https://www.gov.uk/bank-holidays.json', {
        signal: AbortSignal.timeout(5000),
      });
      data = await response.json();
    } catch (fetchErr) {
      const stale = getStaleRegion(region);
      if (stale) {
        logger.warn({ err: fetchErr.message, region }, 'bank holiday fetch failed, returning stale cache');
        return res.json(stale);
      }
      throw fetchErr;
    }

    const events = data?.[region]?.events;
    if (!Array.isArray(events)) {
      logger.warn({ region }, 'Unexpected bank holiday response shape from GOV.UK');
      const stale = getStaleRegion(region);
      if (stale) return res.json(stale);
      return res.status(502).json({ error: 'Unexpected response from GOV.UK bank holidays API' });
    }
    const holidays = events
      .filter(e => e.date && e.title)
      .map(e => ({ date: String(e.date).slice(0, 10), name: String(e.title).slice(0, 200) }));
    bankHolidayCache.set(region, { holidays, expiresAt: now + CACHE_TTL_MS });
    res.json(holidays);
  } catch (err) {
    logger.error({ err: err.message }, 'bank holiday fetch failed');
    next(err);
  }
});

export default router;
