import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import * as notificationDigestService from '../services/notificationDigestService.js';
import * as notificationService from '../services/notificationService.js';

const router = Router();

const keysSchema = z.object({
  keys: z.array(z.string().length(20).regex(/^[0-9a-f]{20}$/)).max(100),
});

const digestQuerySchema = z.object({
  period: z.enum(['daily', 'weekly']).default('daily'),
  limit: z.coerce.number().int().min(1).max(250).default(100),
});

function activeUserOrReject(req, res) {
  if (!req.authDbUser?.id) {
    res.status(403).json({ error: 'Notification access requires an active user record' });
    return false;
  }
  return true;
}

router.get('/digest', readRateLimiter, requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    if (!activeUserOrReject(req, res)) return;
    const parsed = digestQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid notification digest query' });
    res.json(await notificationDigestService.buildNotificationDigest({
      homeId: req.home.id,
      homeSlug: req.home.slug,
      homeName: req.home.config?.home_name || req.home.name,
      homeRole: req.homeRole,
      homeConfig: req.home.config,
      period: parsed.data.period,
      limit: parsed.data.limit,
    }));
  } catch (err) {
    next(err);
  }
});

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    if (!activeUserOrReject(req, res)) return;
    res.json(await notificationService.listNotifications({
      homeId: req.home.id,
      homeRole: req.homeRole,
      userId: req.authDbUser.id,
    }));
  } catch (err) {
    next(err);
  }
});

router.post('/read', writeRateLimiter, requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    if (!activeUserOrReject(req, res)) return;
    const parsed = keysSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'keys is required' });
    await notificationService.markNotificationsRead({
      homeId: req.home.id,
      userId: req.authDbUser.id,
      keys: parsed.data.keys,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post('/read-all', writeRateLimiter, requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    if (!activeUserOrReject(req, res)) return;
    await notificationService.markAllNotificationsRead({
      homeId: req.home.id,
      homeRole: req.homeRole,
      userId: req.authDbUser.id,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
