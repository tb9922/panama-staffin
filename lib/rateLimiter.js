import rateLimit from 'express-rate-limit';

/**
 * Shared rate limiters for route files.
 *
 * Existing custom limits (auth, data-save, HR, dashboard) are unchanged —
 * these cover the routes that previously had no protection at all.
 */

/** POST / PUT / DELETE endpoints — 120 req per 15 min per IP */
export const writeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

/** GET-heavy / read-only endpoints — 300 req per 15 min per IP */
export const readRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
