import { Router } from 'express';
import { randomBytes } from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import * as authService from '../services/authService.js';
import * as auditService from '../services/auditService.js';
import * as authRepo from '../repositories/authRepo.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { PostgresRateLimitStore } from '../lib/postgresRateLimitStore.js';
import {
  tokenCookieOptions,
  csrfCookieOptions,
  legacyCsrfClearCookieOptions,
  logoutTokenClearCookieOptions,
  logoutCsrfClearCookieOptions,
} from '../lib/authCookies.js';
import logger from '../logger.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // 30 per IP+username prevents whole-home lockout (care homes share one IP).
  // Pre-auth: key by IP + submitted username so one user's typos don't block others.
  max: config.nodeEnv === 'test' ? 1000 : 30,
  keyGenerator: (req) => {
    const ip = ipKeyGenerator(req.ip);
    const username = (req.body?.username || '').toLowerCase().slice(0, 100);
    return `login:${ip}:${username}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: config.nodeEnv === 'test' ? undefined : new PostgresRateLimitStore({ prefix: 'login:' }),
  message: { error: 'Too many login attempts - try again in 15 minutes' },
});

const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Secondary IP-only guard to reduce username spraying from a single network.
  // Kept above the username-scoped limit to avoid whole-home lockouts.
  max: config.nodeEnv === 'test' ? 1000 : 120,
  keyGenerator: (req) => `login-ip:${ipKeyGenerator(req.ip)}`,
  standardHeaders: true,
  legacyHeaders: false,
  store: config.nodeEnv === 'test' ? undefined : new PostgresRateLimitStore({ prefix: 'login-ip:' }),
  message: { error: 'Too many login attempts from this network - try again in 15 minutes' },
});

const loginSchema = z.object({
  username: z.string().min(1, 'Username required'),
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

function logAuthAudit(action, username, details = null) {
  return auditService.log(action, '-', username, details).catch((err) => {
    logger.warn({ action, username, err: err.message }, 'Auth audit write failed');
  });
}

router.post('/', loginIpLimiter, loginLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request body' });
    }
    const { username, password } = parsed.data;
    const result = await authService.login(username, password);
    void logAuthAudit('login', username);

    res.cookie('panama_token', result.token, tokenCookieOptions(req));

    res.clearCookie('panama_csrf', legacyCsrfClearCookieOptions(req));

    res.cookie('panama_csrf', randomBytes(32).toString('hex'), csrfCookieOptions(req));

    res.json(result);
  } catch (err) {
    const username = req.body?.username || '(empty)';
    await logAuthAudit('login_failure', username);
    next(err);
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  let revoked = true;
  if (req.user.jti) {
    const expiresAt = new Date(req.user.exp * 1000);
    try {
      await authRepo.addToDenyList(req.user.jti, req.user.username, expiresAt);
    } catch (err) {
      logger.error({ jti: req.user.jti, err: err.message }, 'logout deny-list write failed');
      revoked = false;
    }
  }

  void logAuthAudit('logout', req.user.username);
  res.clearCookie('panama_token', logoutTokenClearCookieOptions(req, '/'));
  res.clearCookie('panama_token', logoutTokenClearCookieOptions(req, '/api'));
  res.clearCookie('panama_csrf', logoutCsrfClearCookieOptions(req));
  res.json({
    ok: true,
    revoked,
    warning: revoked ? null : 'Server-side revoke failed; local session was cleared',
  });
});

const revokeSchema = z.object({
  username: z.string().min(1, 'Username required'),
});

router.post('/revoke', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const parsed = revokeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request body' });
    }
    const { username } = parsed.data;
    if (username.toLowerCase() === req.user.username.toLowerCase()) {
      return res.status(400).json({ error: 'You cannot revoke your own current admin session' });
    }
    await authService.revokeUser(username, 'admin');
    void logAuthAudit('token_revoke', req.user.username, { revoked_user: username });
    res.json({ ok: true, message: `All tokens revoked for ${username}` });
  } catch (err) {
    next(err);
  }
});

export default router;
