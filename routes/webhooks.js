import { Router } from 'express';
import { z } from 'zod';
import dns from 'node:dns/promises';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import * as webhookRepo from '../repositories/webhookRepo.js';
import { zodError } from '../errors.js';

const router = Router();

const SUPPORTED_EVENTS = [
  'payroll_run.approved',
  'incident.created',
  'override.created',
];

// Block private/internal IPs to prevent SSRF (covers RFC 1918, link-local, loopback, cloud metadata)
const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|::1|fc|fd|fe80|\[::1\])/i;
function isPrivateHost(h) {
  if (PRIVATE_HOST_RE.test(h)) return true;
  // Block cloud metadata endpoints (AWS, GCP, Azure)
  if (h === '169.254.169.254' || h === 'metadata.google.internal') return true;
  // Block IPv4-mapped IPv6 (::ffff:127.0.0.1)
  if (/^::ffff:/i.test(h)) return true;
  // Block numeric/hex/octal IP encoding of loopback (0x7f000001, 2130706433, 017700000001)
  if (/^(0x[0-9a-f]+|[0-9]+|0[0-7]+)$/i.test(h)) return true;
  return false;
}

function isPrivateUrl(url) {
  try {
    const { hostname } = new URL(url);
    const h = hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
    return isPrivateHost(h);
  } catch { return true; }
}

/**
 * DNS resolution check — prevents DNS rebinding attacks where a hostname
 * initially resolves to a public IP but later resolves to a private one.
 * Called on webhook create/update (not on every delivery — too expensive).
 */
async function resolvedToPrivateIp(url) {
  try {
    const { hostname } = new URL(url);
    const h = hostname.replace(/^\[|\]$/g, '');
    // Skip if already an IP literal (covered by isPrivateUrl regex check)
    if (/^[\d.:a-fA-F]+$/.test(h)) return false;
    const addresses = await dns.resolve4(h).catch(() => []);
    const addresses6 = await dns.resolve6(h).catch(() => []);
    for (const ip of [...addresses, ...addresses6]) {
      if (isPrivateHost(ip)) return true;
    }
    return false;
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
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('config', 'read'), async (req, res, next) => {
  try {
    const hooks = await webhookRepo.findByHome(req.home.id);
    res.json(hooks);
  } catch (err) { next(err); }
});

// POST /api/webhooks?home=X — create webhook
router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('config', 'write'), async (req, res, next) => {
  try {
    const parsed = webhookSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    if (await resolvedToPrivateIp(parsed.data.url)) {
      return res.status(400).json({ error: 'Webhook URL resolves to a private/internal IP address' });
    }
    const hook = await webhookRepo.create(req.home.id, parsed.data);
    res.status(201).json(hook);
  } catch (err) { next(err); }
});

// PUT /api/webhooks/:id?home=X — update webhook
router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('config', 'write'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid webhook ID' });
    const parsed = webhookSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    if (await resolvedToPrivateIp(parsed.data.url)) {
      return res.status(400).json({ error: 'Webhook URL resolves to a private/internal IP address' });
    }
    const hook = await webhookRepo.update(id, req.home.id, parsed.data);
    if (!hook) return res.status(404).json({ error: 'Webhook not found' });
    res.json(hook);
  } catch (err) { next(err); }
});

// DELETE /api/webhooks/:id?home=X — remove webhook
router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('config', 'write'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid webhook ID' });
    const removed = await webhookRepo.remove(id, req.home.id);
    if (!removed) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/webhooks/:id/deliveries?home=X — recent delivery log
router.get('/:id/deliveries', readRateLimiter, requireAuth, requireHomeAccess, requireModule('config', 'read'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid webhook ID' });
    const hook = await webhookRepo.findById(id, req.home.id);
    if (!hook) return res.status(404).json({ error: 'Webhook not found' });
    const status = ['delivered', 'pending_retry', 'failed'].includes(req.query.status) ? req.query.status : null;
    const deliveries = await webhookRepo.getRecentDeliveries(id, req.home.id, { status });
    res.json(deliveries);
  } catch (err) { next(err); }
});

export default router;
