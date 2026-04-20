import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import * as notificationService from '../services/notificationService.js';

const router = Router();

const keysSchema = z.object({
  keys: z.array(z.string().length(20).regex(/^[0-9a-f]{20}$/)).max(100),
});

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    if (!req.authDbUser?.id) {
      return res.status(403).json({ error: 'Notification access requires an active user record' });
    }
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
    if (!req.authDbUser?.id) {
      return res.status(403).json({ error: 'Notification access requires an active user record' });
    }
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
    if (!req.authDbUser?.id) {
      return res.status(403).json({ error: 'Notification access requires an active user record' });
    }
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
