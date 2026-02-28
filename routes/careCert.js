import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as careCertRepo from '../repositories/careCertRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as auditService from '../services/auditService.js';

const router = Router();
const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/).optional();
const staffIdSchema = z.string().min(1).max(20);
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

const careCertCreateSchema = z.object({
  staffId:    staffIdSchema,
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supervisor: z.string().max(200).nullable().optional(),
});

const standardDataSchema = z.object({
  knowledge: z.object({
    date: dateSchema.optional(),
    assessor: z.string().max(200).nullable().optional(),
    status: z.string().max(50).nullable().optional(),
    score: z.coerce.number().min(0).max(100).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
  }).optional(),
  observations: z.array(z.object({
    date: dateSchema.optional(),
    observer: z.string().max(200).nullable().optional(),
    evidence: z.string().max(5000).nullable().optional(),
    status: z.string().max(50).nullable().optional(),
  })).optional(),
  completion_date: dateSchema.optional(),
  status: z.string().max(50).nullable().optional(),
}).passthrough();

const careCertUpdateSchema = z.object({
  start_date:          dateSchema.optional(),
  expected_completion: dateSchema.optional(),
  supervisor:          z.string().max(200).nullable().optional(),
  status:              z.enum(['not_started', 'in_progress', 'completed', 'overdue']).optional(),
  completion_date:     dateSchema.optional(),
  standards:           z.record(z.string().regex(/^std-\d+$/), standardDataSchema).optional(),
});

async function resolveHome(req, res) {
  const p = homeIdSchema.safeParse(req.query.home);
  if (!p.success || !p.data) { res.status(400).json({ error: 'home parameter is required' }); return null; }
  const home = await homeRepo.findBySlug(p.data);
  if (!home) { res.status(404).json({ error: 'Home not found' }); return null; }
  return home;
}

// GET /api/care-cert?home=X
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const [careCert, staffRows] = await Promise.all([
      careCertRepo.findByHome(home.id),
      staffRepo.findByHome(home.id),
    ]);
    const staff = staffRows.map(s => ({ id: s.id, name: s.name, role: s.role, team: s.team, active: s.active, start_date: s.start_date }));
    res.json({ careCert, staff, config: home.config });
  } catch (err) { next(err); }
});

// POST /api/care-cert?home=X — start new CC for a staff member
router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = careCertCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const { staffId, start_date, supervisor } = parsed.data;
    // Calculate expected_completion: start_date + 12 weeks
    const start = new Date(start_date);
    const expected = new Date(start);
    expected.setUTCDate(expected.getUTCDate() + 84); // 12 weeks
    const record = {
      start_date,
      expected_completion: expected.toISOString().slice(0, 10),
      supervisor: supervisor || null,
      status: 'in_progress',
      completion_date: null,
      standards: {},
    };
    const result = await careCertRepo.upsertStaff(home.id, staffId, record);
    await auditService.log('care_cert_create', home.slug, req.user.username, { staffId });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// PUT /api/care-cert/:staffId?home=X — update CC record (standard, supervisor, status)
router.put('/:staffId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = staffIdSchema.safeParse(req.params.staffId);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid staff ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    // Fetch current record first, merge updates
    const current = await careCertRepo.findByHome(home.id);
    const currentRecord = current[idParsed.data];
    if (!currentRecord) return res.status(404).json({ error: 'Care certificate record not found' });
    const bodyParsed = careCertUpdateSchema.safeParse(req.body);
    if (!bodyParsed.success) return res.status(400).json({ error: 'Validation failed', issues: bodyParsed.error.issues });
    const updated = { ...currentRecord, ...bodyParsed.data };
    const result = await careCertRepo.upsertStaff(home.id, idParsed.data, updated);
    await auditService.log('care_cert_update', home.slug, req.user.username, { staffId: idParsed.data });
    res.json(result);
  } catch (err) { next(err); }
});

// DELETE /api/care-cert/:staffId?home=X — remove from tracking
router.delete('/:staffId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = staffIdSchema.safeParse(req.params.staffId);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid staff ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const deleted = await careCertRepo.removeStaff(home.id, idParsed.data);
    if (!deleted) return res.status(404).json({ error: 'Care certificate record not found' });
    await auditService.log('care_cert_delete', home.slug, req.user.username, { staffId: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
