import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import * as handoverRepo from '../repositories/handoverRepo.js';
import * as auditService from '../services/auditService.js';

import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { nullableDateInput } from '../lib/zodHelpers.js';

const router = Router();

const dateSchema = nullableDateInput;
const uuidSchema = z.string().uuid('Invalid entry ID');
const rangeQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const entryBodySchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  shift:      z.enum(['E', 'L', 'N']),
  category:   z.enum(['clinical', 'safety', 'operational', 'admin']),
  priority:   z.enum(['urgent', 'action', 'info']),
  content:    z.string().min(1, 'Content is required').max(2000, 'Content too long'),
  incident_id: z.string().max(50).nullable().optional(),
});

const updateBodySchema = z.object({
  content:  z.string().min(1).max(2000),
  priority: z.enum(['urgent', 'action', 'info']),
});

// GET /api/handover?home=X&date=YYYY-MM-DD
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('scheduling', 'read'), async (req, res, next) => {
  try {
    const dateParam = dateSchema.safeParse(req.query.date);
    if (!dateParam.success || !dateParam.data) return res.status(400).json({ error: 'date parameter required (YYYY-MM-DD)' });
    const result = await handoverRepo.findByHomeAndDate(req.home.id, dateParam.data);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/handover/range?home=X&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/range', readRateLimiter, requireAuth, requireHomeAccess, requireModule('scheduling', 'read'), async (req, res, next) => {
  try {
    const parsed = rangeQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await handoverRepo.findByHomeAndDateRange(
      req.home.id,
      parsed.data.from,
      parsed.data.to,
      { limit: parsed.data.limit, offset: parsed.data.offset }
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/handover?home=X  — create entry (author from JWT)
router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('scheduling', 'write'), async (req, res, next) => {
  try {
    const parsed = entryBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const entry = await handoverRepo.createEntry(req.home.id, parsed.data, req.user.username);
    await auditService.log('handover_create', req.home.slug, req.user.username, { id: entry?.id });
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

// PUT /api/handover/:id?home=X  — update content/priority
router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('scheduling', 'write'), async (req, res, next) => {
  try {
    const idParam = uuidSchema.safeParse(req.params.id);
    if (!idParam.success) return res.status(400).json({ error: 'Invalid entry ID' });
    const parsed = updateBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const entry = await handoverRepo.updateEntry(idParam.data, req.home.id, parsed.data);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    await auditService.log('handover_update', req.home.slug, req.user.username, { id: idParam.data });
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

// POST /api/handover/:id/acknowledge?home=X  — mark as read by incoming shift (auth only — viewer can ack)
router.post('/:id/acknowledge', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('scheduling', 'write'), async (req, res, next) => {
  try {
    const idParam = uuidSchema.safeParse(req.params.id);
    if (!idParam.success) return res.status(400).json({ error: 'Invalid entry ID' });
    const entry = await handoverRepo.acknowledgeEntry(idParam.data, req.home.id, req.user.username);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    await auditService.log('handover_acknowledge', req.home.slug, req.user.username, { id: idParam.data });
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/handover/:id?home=X
router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('scheduling', 'write'), async (req, res, next) => {
  try {
    const idParam = uuidSchema.safeParse(req.params.id);
    if (!idParam.success) return res.status(400).json({ error: 'Invalid entry ID' });
    const deleted = await handoverRepo.deleteEntry(idParam.data, req.home.id);
    if (!deleted) return res.status(404).json({ error: 'Entry not found' });
    await auditService.log('handover_delete', req.home.slug, req.user.username, { id: idParam.data });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
