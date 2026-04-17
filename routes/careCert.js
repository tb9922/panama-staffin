import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import { diffFields } from '../lib/audit.js';
import * as careCertRepo from '../repositories/careCertRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as auditService from '../services/auditService.js';
import { nullableDateInput } from '../lib/zodHelpers.js';
import { addDaysLocalISO } from '../lib/dateOnly.js';

const router = Router();
const staffIdSchema = z.string().min(1).max(20);
const dateSchema = nullableDateInput;

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
});

const careCertUpdateSchema = z.object({
  start_date:          dateSchema.optional(),
  expected_completion: dateSchema.optional(),
  supervisor:          z.string().max(200).nullable().optional(),
  status:              z.enum(['not_started', 'in_progress', 'completed', 'overdue']).optional(),
  completion_date:     dateSchema.optional(),
  standards:           z.record(z.string().regex(/^std-\d+$/), standardDataSchema).optional(),
});

// GET /api/care-cert?home=X
router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const [careCert, staffResult] = await Promise.all([
      careCertRepo.findByHome(req.home.id),
      staffRepo.findByHome(req.home.id),
    ]);
    const staff = staffResult.rows.map(s => ({ id: s.id, name: s.name, role: s.role, team: s.team, active: s.active, start_date: s.start_date }));
    res.json({ careCert, staff, config: req.home.config });
  } catch (err) { next(err); }
});

// POST /api/care-cert?home=X — start new CC for a staff member
router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = careCertCreateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const { staffId, start_date, supervisor } = parsed.data;
    const record = {
      start_date,
      expected_completion: addDaysLocalISO(start_date, 84),
      supervisor: supervisor || null,
      status: 'in_progress',
      completion_date: null,
      standards: {},
    };
    const result = await careCertRepo.upsertStaff(req.home.id, staffId, record);
    await auditService.log('care_cert_create', req.home.slug, req.user.username, { staffId });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// PUT /api/care-cert/:staffId?home=X — update CC record (standard, supervisor, status)
router.put('/:staffId', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = staffIdSchema.safeParse(req.params.staffId);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid staff ID' });
    // Fetch current record first, merge updates
    const current = await careCertRepo.findByHome(req.home.id);
    const currentRecord = current[idParsed.data];
    if (!currentRecord) return res.status(404).json({ error: 'Care certificate record not found' });
    const bodyParsed = careCertUpdateSchema.safeParse(req.body);
    if (!bodyParsed.success) return zodError(res, bodyParsed);
    // Deep merge standards to avoid overwriting other standards on single-standard update
    const updated = { ...currentRecord, ...bodyParsed.data };
    if (bodyParsed.data.standards && currentRecord.standards) {
      updated.standards = { ...currentRecord.standards };
      for (const [stdKey, stdVal] of Object.entries(bodyParsed.data.standards)) {
        updated.standards[stdKey] = { ...(currentRecord.standards[stdKey] || {}), ...stdVal };
      }
    }
    const result = await careCertRepo.upsertStaff(req.home.id, idParsed.data, updated);
    const changes = diffFields(currentRecord, result);
    await auditService.log('care_cert_update', req.home.slug, req.user.username, { staffId: idParsed.data, changes });
    res.json(result);
  } catch (err) { next(err); }
});

// DELETE /api/care-cert/:staffId?home=X — remove from tracking
router.delete('/:staffId', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = staffIdSchema.safeParse(req.params.staffId);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid staff ID' });
    const deleted = await careCertRepo.removeStaff(req.home.id, idParsed.data);
    if (!deleted) return res.status(404).json({ error: 'Care certificate record not found' });
    await auditService.log('care_cert_delete', req.home.slug, req.user.username, { staffId: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
