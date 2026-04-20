import { Router } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import {
  tokenCookieOptions,
  csrfCookieOptions,
  legacyCsrfClearCookieOptions,
} from '../lib/authCookies.js';
import * as staffAuthService from '../services/staffAuthService.js';
import * as staffAuthRepo from '../repositories/staffAuthRepo.js';
import { issueStaffToken } from '../services/authService.js';

const router = Router();

const inviteBodySchema = z.object({
  staffId: z.string().min(1).max(20),
});

const consumeInviteSchema = z.object({
  token: z.string().length(64),
  username: z.string().min(1).max(100),
  password: z.string().min(10).max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10).max(200),
});

const revokeBodySchema = z.object({
  staffId: z.string().min(1).max(20),
});

function ensureStaffPortalEnabled(req, res, next) {
  if (!config.enableStaffPortal) {
    return res.status(404).json({ error: 'Staff portal is not enabled' });
  }
  return next();
}

function setAuthCookies(req, res, token) {
  res.cookie('panama_token', token, tokenCookieOptions(req));
  res.clearCookie('panama_csrf', legacyCsrfClearCookieOptions(req));
  res.cookie('panama_csrf', randomBytes(32).toString('hex'), csrfCookieOptions(req));
}

function requireStaffToken(req, res, next) {
  if (req.user?.role !== 'staff_member' || req.user?.auth_type !== 'staff') {
    return res.status(403).json({ error: 'Staff sign-in required' });
  }
  return next();
}

router.get('/invite/:token', readRateLimiter, ensureStaffPortalEnabled, async (req, res, next) => {
  try {
    const invite = await staffAuthRepo.findInviteToken(req.params.token);
    if (!invite || invite.consumedAt || new Date(invite.expiresAt) <= new Date()) {
      return res.status(404).json({ error: 'Invite token is not valid' });
    }
    res.json({
      staffName: invite.staffName,
      homeName: invite.homeName,
      expiresAt: invite.expiresAt,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/invite/consume', writeRateLimiter, ensureStaffPortalEnabled, async (req, res, next) => {
  try {
    const body = consumeInviteSchema.parse(req.body);
    const result = await staffAuthService.consumeInvite(body);
    const creds = await staffAuthRepo.findByUsername(result.username);
    const { token } = issueStaffToken(creds);
    setAuthCookies(req, res, token);
    res.status(201).json({ ...result, token });
  } catch (err) {
    next(err);
  }
});

router.post('/invite', writeRateLimiter, ensureStaffPortalEnabled, requireAuth, requireHomeAccess, requireModule('staff', 'write'), async (req, res, next) => {
  try {
    const body = inviteBodySchema.parse(req.body);
    const invite = await staffAuthService.createInvite({
      homeId: req.home.id,
      staffId: body.staffId,
      createdBy: req.user.username,
    });
    res.status(201).json(invite);
  } catch (err) {
    next(err);
  }
});

router.post('/change-password', writeRateLimiter, ensureStaffPortalEnabled, requireAuth, requireStaffToken, async (req, res, next) => {
  try {
    const body = changePasswordSchema.parse(req.body);
    await staffAuthService.changePassword({
      homeId: req.user.home_id,
      staffId: req.user.staff_id,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      actorUsername: req.user.username,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/revoke', writeRateLimiter, ensureStaffPortalEnabled, requireAuth, requireHomeAccess, requireModule('staff', 'write'), async (req, res, next) => {
  try {
    const body = revokeBodySchema.parse(req.body);
    await staffAuthService.revokeStaffSessions({
      homeId: req.home.id,
      staffId: body.staffId,
      actor: req.user.username,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
