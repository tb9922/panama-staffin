import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess } from '../middleware/auth.js';
import * as handoverRepo from '../repositories/handoverRepo.js';
import * as auditService from '../services/auditService.js';
import { queueAutoLinkSync } from '../services/cqcAutoLinkService.js';
import { hasModuleAccess } from '../shared/roles.js';

import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { nullableDateInput } from '../lib/zodHelpers.js';
import { idempotency } from '../middleware/idempotency.js';

const router = Router();

const dateSchema = nullableDateInput;
const uuidSchema = z.string().uuid('Invalid entry ID');
const HANDOVER_CATEGORY_MODULE = Object.freeze({
  clinical: 'compliance',
  safety: 'compliance',
  operational: 'scheduling',
  admin: 'scheduling',
});
const rangeQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const entryBodySchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  shift:      z.enum(['E', 'L', 'EL', 'N']),
  category:   z.enum(['clinical', 'safety', 'operational', 'admin']),
  priority:   z.enum(['urgent', 'action', 'info']),
  content:    z.string().min(1, 'Content is required').max(2000, 'Content too long'),
  incident_id: z.string().max(50).nullable().optional(),
});

const updateBodySchema = z.object({
  content:  z.string().min(1).max(2000),
  priority: z.enum(['urgent', 'action', 'info']),
  _version: z.number().int().nonnegative(),
});

const deleteBodySchema = z.object({
  _version: z.number().int().nonnegative(),
});

function canAccessHandoverCategory(req, category, level) {
  if (req.user?.is_platform_admin && req.homeRole != null) return true;
  const moduleId = HANDOVER_CATEGORY_MODULE[category] || 'scheduling';
  return hasModuleAccess(req.homeRole, moduleId, level, { includeOwn: false });
}

function requireAnyHandoverRead(req, res, next) {
  if (req.user?.is_platform_admin && req.homeRole != null) return next();
  if (
    hasModuleAccess(req.homeRole, 'scheduling', 'read', { includeOwn: false })
    || hasModuleAccess(req.homeRole, 'compliance', 'read', { includeOwn: false })
  ) {
    return next();
  }
  return res.status(403).json({ error: 'Insufficient permissions for handover' });
}

function filterReadableEntries(req, rows) {
  return rows.filter((entry) => canAccessHandoverCategory(req, entry.category, 'read'));
}

// GET /api/handover?home=X&date=YYYY-MM-DD
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireAnyHandoverRead, async (req, res, next) => {
  try {
    const dateParam = dateSchema.safeParse(req.query.date);
    if (!dateParam.success || !dateParam.data) return res.status(400).json({ error: 'date parameter required (YYYY-MM-DD)' });
    const result = await handoverRepo.findByHomeAndDate(req.home.id, dateParam.data);
    res.json(filterReadableEntries(req, result.rows));
  } catch (err) {
    next(err);
  }
});

// GET /api/handover/range?home=X&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/range', readRateLimiter, requireAuth, requireHomeAccess, requireAnyHandoverRead, async (req, res, next) => {
  try {
    const parsed = rangeQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await handoverRepo.findByHomeAndDateRange(
      req.home.id,
      parsed.data.from,
      parsed.data.to,
      { limit: parsed.data.limit, offset: parsed.data.offset }
    );
    const rows = filterReadableEntries(req, result.rows);
    res.json({ ...result, rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/handover?home=X  — create entry (author from JWT)
router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, idempotency('handover:create'), async (req, res, next) => {
  try {
    const parsed = entryBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    if (!canAccessHandoverCategory(req, parsed.data.category, 'write')) {
      return res.status(403).json({ error: `Insufficient permissions for ${HANDOVER_CATEGORY_MODULE[parsed.data.category]}` });
    }
    const entry = await handoverRepo.createEntry(req.home.id, parsed.data, req.user.username);
    await auditService.log('handover_create', req.home.slug, req.user.username, { id: entry?.id });
    queueAutoLinkSync(req.home.id, 'handover', entry, req.user.username);
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

// PUT /api/handover/:id?home=X  — update content/priority
router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const idParam = uuidSchema.safeParse(req.params.id);
    if (!idParam.success) return res.status(400).json({ error: 'Invalid entry ID' });
    const parsed = updateBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const existing = await handoverRepo.findById(idParam.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Entry not found' });
    if (!canAccessHandoverCategory(req, existing.category, 'write')) {
      return res.status(403).json({ error: `Insufficient permissions for ${HANDOVER_CATEGORY_MODULE[existing.category]}` });
    }
    const entry = await handoverRepo.updateEntry(idParam.data, req.home.id, parsed.data, parsed.data._version);
    if (!entry) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    await auditService.log('handover_update', req.home.slug, req.user.username, { id: idParam.data });
    queueAutoLinkSync(req.home.id, 'handover', entry, req.user.username);
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

// POST /api/handover/:id/acknowledge?home=X  — mark as read by incoming shift (auth only — viewer can ack)
router.post('/:id/acknowledge', writeRateLimiter, requireAuth, requireHomeAccess, idempotency('handover:acknowledge'), async (req, res, next) => {
  try {
    const idParam = uuidSchema.safeParse(req.params.id);
    if (!idParam.success) return res.status(400).json({ error: 'Invalid entry ID' });
    const existing = await handoverRepo.findById(idParam.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Entry not found' });
    if (!canAccessHandoverCategory(req, existing.category, 'read')) {
      return res.status(403).json({ error: `Insufficient permissions for ${HANDOVER_CATEGORY_MODULE[existing.category]}` });
    }
    const entry = await handoverRepo.acknowledgeEntry(idParam.data, req.home.id, req.user.username);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    await auditService.log('handover_acknowledge', req.home.slug, req.user.username, { id: idParam.data });
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/handover/:id?home=X
router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const idParam = uuidSchema.safeParse(req.params.id);
    if (!idParam.success) return res.status(400).json({ error: 'Invalid entry ID' });
    const parsed = deleteBodySchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const existing = await handoverRepo.findById(idParam.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Entry not found' });
    if (!canAccessHandoverCategory(req, existing.category, 'write')) {
      return res.status(403).json({ error: `Insufficient permissions for ${HANDOVER_CATEGORY_MODULE[existing.category]}` });
    }
    const deleted = await handoverRepo.deleteEntry(idParam.data, req.home.id, parsed.data._version);
    if (!deleted) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    await auditService.log('handover_delete', req.home.slug, req.user.username, { id: idParam.data });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
