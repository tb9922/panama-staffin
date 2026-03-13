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
 */

/** Key generator: IP + username when authenticated, IP-only otherwise */
export function perUserKey(req) {
  const ip = ipKeyGenerator(req.ip);
  return req.user ? `${ip}:${req.user.username}` : ip;
}

/** POST / PUT / DELETE endpoints — 120 req per 15 min per IP+user */
export const writeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  keyGenerator: perUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

/** GET-heavy / read-only endpoints — 300 req per 15 min per IP+user */
export const readRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator: perUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
