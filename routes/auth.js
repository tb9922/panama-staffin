import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import * as authService from '../services/authService.js';
import * as auditService from '../services/auditService.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
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
    await auditService.log('login', '-', username, null);
    res.json(result);
  } catch (err) {
    // Log failed login attempt for brute-force detection
    const username = req.body?.username || '(empty)';
    await auditService.log('login_failure', '-', username, null).catch(() => {});
    next(err);
  }
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
