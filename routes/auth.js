import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import * as authService from '../services/authService.js';
import * as auditService from '../services/auditService.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.nodeEnv === 'test' ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts — try again in 15 minutes' },
});

const loginSchema = z.object({
  username: z.string().min(1, 'Username required'),
  password: z.string().min(1, 'Password required').max(200),
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
    // Secure requires HTTPS in production.
    res.cookie('panama_token', result.token, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      path: '/api',
      maxAge: 4 * 60 * 60 * 1000, // 4 hours (matches JWT expiry)
    });

    // Token is also in body for API clients and integration tests.
    // The frontend ignores it — the HttpOnly cookie is the auth mechanism.
    res.json(result);
  } catch (err) {
    // Log failed login attempt for brute-force detection
    const username = req.body?.username || '(empty)';
    await auditService.log('login_failure', '-', username, null).catch(() => {});
    next(err);
  }
});

// ── Logout (clear cookie) ───────────────────────────────────────────────────

router.post('/logout', requireAuth, (req, res) => {
  res.clearCookie('panama_token', { path: '/api' });
  res.json({ ok: true });
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
    await authService.revokeUser(username);
    await auditService.log('token_revoke', '-', req.user.username, { revoked_user: username });
    res.json({ ok: true, message: `All tokens revoked for ${username}` });
  } catch (err) {
    next(err);
  }
});

export default router;
