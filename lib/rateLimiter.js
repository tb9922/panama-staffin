import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * Shared rate limiters for route files.
 *
 * Keyed by IP + authenticated username to avoid noisy-neighbor effects
 * behind shared NAT (e.g. all staff at a care home sharing one IP).
 * Unauthenticated requests (before login) fall back to IP-only.
 * Uses ipKeyGenerator for correct IPv6 subnet handling.
 *
 * Existing custom limits (auth, data-save, HR, dashboard) are unchanged —
 * these cover the routes that previously had no protection at all.
 *
 * In test environment (NODE_ENV=test), rate limiting is disabled to prevent
 * E2E test failures from concurrent page loads sharing one IP.
 */

const isTest = process.env.NODE_ENV === 'test';

/** Key generator: IP + username when authenticated, IP-only otherwise */
export function perUserKey(req) {
  const ip = ipKeyGenerator(req.ip);
  return req.user ? `${ip}:${req.user.username}` : ip;
}

/** No-op middleware for test environment */
function passthrough(_req, _res, next) { next(); }

/** POST / PUT / DELETE endpoints — 500 req per 15 min per IP+user */
export const writeRateLimiter = isTest ? passthrough : rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  keyGenerator: perUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

/** GET-heavy / read-only endpoints — 2000 req per 15 min per IP+user */
export const readRateLimiter = isTest ? passthrough : rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  keyGenerator: perUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
