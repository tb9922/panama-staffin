import { Router } from 'express';
import { randomBytes } from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import * as authService from '../services/authService.js';
import * as auditService from '../services/auditService.js';
import * as authRepo from '../repositories/authRepo.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import logger from '../logger.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // 30 per IP+username prevents whole-home lockout (care homes share one IP).
  // Pre-auth: key by IP + submitted username so one user's typos don't block others.
  max: config.nodeEnv === 'test' ? 1000 : 30,
  keyGenerator: (req) => {
    const ip = ipKeyGenerator(req.ip);
    // Normalise to lowercase + truncate to prevent memory exhaustion
    const username = (req.body?.username || '').toLowerCase().slice(0, 100);
    return `login:${ip}:${username}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts — try again in 15 minutes' },
});

const loginSchema = z.object({
  username: z.string().min(1, 'Username required'),
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

router.post('/', loginLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request body' });
    }
    const { username, password } = parsed.data;
    const result = await authService.login(username, password);
    auditService.log('login', '-', username, null).catch(() => {});

    // Set JWT as HttpOnly cookie — not accessible to JavaScript, immune to XSS token theft.
    // SameSite=Lax allows top-level navigations (email/Slack links) while blocking cross-origin POSTs.
    // Secure requires HTTPS in production. Path=/ so Playwright storageState captures it.
    res.cookie('panama_token', result.token, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 4 * 60 * 60 * 1000, // 4 hours (matches JWT expiry)
    });

    // Clear any stale CSRF cookie from old path (migration from path=/api to path=/)
    res.clearCookie('panama_csrf', { path: '/api', secure: config.nodeEnv === 'production', sameSite: 'strict' });

    // CSRF double-submit cookie — JS-readable so the frontend can send it back
    // as X-CSRF-Token header. SameSite=Strict prevents cross-site transmission.
    res.cookie('panama_csrf', randomBytes(32).toString('hex'), {
      httpOnly: false,
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 4 * 60 * 60 * 1000,
    });

    // Security trade-off: token is included in the response body for API clients
    // using Bearer auth and integration tests (30+ test files read res.body.token).
    // The frontend ignores it — the HttpOnly cookie is the auth mechanism.
    // If removing, all integration tests and any external API consumers would need
    // to extract the JWT from the Set-Cookie header instead.
    res.json(result);
  } catch (err) {
    // Log failed login attempt for brute-force detection
    const username = String(req.body?.username || '(empty)')
      .replace(/[\r\n\t]/g, ' ')
      .slice(0, 200);
    await auditService.log('login_failure', '-', username, null).catch(() => {});
    next(err);
  }
});

// ── Logout (clear cookie) ───────────────────────────────────────────────────

router.post('/logout', requireAuth, async (req, res) => {
  if (req.user.jti) {
    const expiresAt = new Date(req.user.exp * 1000);
    try {
      await authRepo.addToDenyList(req.user.jti, req.user.username, expiresAt);
    } catch (err) {
      logger.error({ jti: req.user.jti, err: err.message }, 'logout deny-list write failed');
      return res.status(503).json({ error: 'Logout failed — please retry' });
    }
  }
  auditService.log('logout', '-', req.user.username, null).catch(() => {});
  res.clearCookie('panama_token', { path: '/', httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax' });
  res.clearCookie('panama_token', { path: '/api', httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax' });
  res.clearCookie('panama_csrf', { path: '/', secure: config.nodeEnv === 'production', sameSite: 'strict' });
  res.json({ ok: true, revoked: true });
});

// ── Token revocation ──────────────────────────────────────────────────────────

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
    await authService.revokeUser(username, 'admin');
    await auditService.log('token_revoke', '-', req.user.username, { revoked_user: username });
    res.json({ ok: true, message: `All tokens revoked for ${username}` });
  } catch (err) {
    next(err);
  }
});

export default router;
