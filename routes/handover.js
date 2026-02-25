import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as handoverRepo from '../repositories/handoverRepo.js';

const router = Router();

const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid home ID').optional();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const uuidSchema = z.string().uuid('Invalid entry ID');

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

async function resolveHomeId(req, res) {
  const homeParam = homeIdSchema.safeParse(req.query.home);
  if (!homeParam.success) {
    res.status(400).json({ error: 'Invalid home parameter' });
    return null;
  }
  const slug = homeParam.data;
  if (!slug) {
    res.status(400).json({ error: 'home parameter is required' });
    return null;
  }
  const home = await homeRepo.findBySlug(slug);
  if (!home) {
    res.status(404).json({ error: 'Home not found' });
    return null;
  }
  return home.id;
}

// GET /api/handover?home=X&date=YYYY-MM-DD
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const homeId = await resolveHomeId(req, res);
    if (homeId === null) return;

    const dateParam = dateSchema.safeParse(req.query.date);
    if (!dateParam.success) return res.status(400).json({ error: 'date parameter required (YYYY-MM-DD)' });

    const entries = await handoverRepo.findByHomeAndDate(homeId, dateParam.data);
    res.json(entries);
  } catch (err) {
    next(err);
  }
});

// POST /api/handover?home=X  — create entry (author from JWT)
router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const homeId = await resolveHomeId(req, res);
    if (homeId === null) return;

    const parsed = entryBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const entry = await handoverRepo.createEntry(homeId, parsed.data, req.user.username);
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

// PUT /api/handover/:id?home=X  — update content/priority
router.put('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParam = uuidSchema.safeParse(req.params.id);
    if (!idParam.success) return res.status(400).json({ error: 'Invalid entry ID' });

    const homeId = await resolveHomeId(req, res);
    if (homeId === null) return;

    const parsed = updateBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const entry = await handoverRepo.updateEntry(idParam.data, homeId, parsed.data);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

// POST /api/handover/:id/acknowledge?home=X  — mark as read by incoming shift (auth only — viewer can ack)
router.post('/:id/acknowledge', requireAuth, async (req, res, next) => {
  try {
    const idParam = uuidSchema.safeParse(req.params.id);
    if (!idParam.success) return res.status(400).json({ error: 'Invalid entry ID' });

    const homeId = await resolveHomeId(req, res);
    if (homeId === null) return;

    const entry = await handoverRepo.acknowledgeEntry(idParam.data, homeId, req.user.username);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/handover/:id?home=X
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParam = uuidSchema.safeParse(req.params.id);
    if (!idParam.success) return res.status(400).json({ error: 'Invalid entry ID' });

    const homeId = await resolveHomeId(req, res);
    if (homeId === null) return;

    const deleted = await handoverRepo.deleteEntry(idParam.data, homeId);
    if (!deleted) return res.status(404).json({ error: 'Entry not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
