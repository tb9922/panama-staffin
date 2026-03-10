import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import * as webhookRepo from '../repositories/webhookRepo.js';
import { zodError } from '../errors.js';

const router = Router();

const SUPPORTED_EVENTS = [
  'payroll_run.approved',
  'incident.created',
  'override.created',
];

// Block private/internal IPs to prevent SSRF
const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|::1|fc|fd|fe80)/i;
function isPrivateUrl(url) {
  try {
    const { hostname } = new URL(url);
    return PRIVATE_HOST_RE.test(hostname) || hostname === '[::1]';
  } catch { return true; }
}

const webhookSchema = z.object({
  url: z.string().url().max(2000)
    .refine(u => u.startsWith('https://'), 'Webhook URL must use HTTPS')
    .refine(u => !isPrivateUrl(u), 'Webhook URL must not target private/internal networks'),
  secret: z.string().min(16).max(500),
  events: z.array(z.enum(SUPPORTED_EVENTS)).min(1),
  active: z.boolean(),
});

// GET /api/webhooks?home=X — list webhooks
router.get('/', readRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const hooks = await webhookRepo.findByHome(req.home.id);
    res.json(hooks);
  } catch (err) { next(err); }
});

// POST /api/webhooks?home=X — create webhook
router.post('/', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = webhookSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const hook = await webhookRepo.create(req.home.id, parsed.data);
    res.status(201).json(hook);
  } catch (err) { next(err); }
});

// PUT /api/webhooks/:id?home=X — update webhook
router.put('/:id', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid webhook ID' });
    const parsed = webhookSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const hook = await webhookRepo.update(id, req.home.id, parsed.data);
    if (!hook) return res.status(404).json({ error: 'Webhook not found' });
    res.json(hook);
  } catch (err) { next(err); }
});

// DELETE /api/webhooks/:id?home=X — remove webhook
router.delete('/:id', writeRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid webhook ID' });
    const removed = await webhookRepo.remove(id, req.home.id);
    if (!removed) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/webhooks/:id/deliveries?home=X — recent delivery log
router.get('/:id/deliveries', readRateLimiter, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid webhook ID' });
    const hook = await webhookRepo.findById(id, req.home.id);
    if (!hook) return res.status(404).json({ error: 'Webhook not found' });
    const deliveries = await webhookRepo.getRecentDeliveries(id, req.home.id);
    res.json(deliveries);
  } catch (err) { next(err); }
});

export default router;
