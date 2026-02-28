import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import { writeRateLimiter } from '../lib/rateLimiter.js';
import * as trainingRepo from '../repositories/trainingRepo.js';
import * as supervisionRepo from '../repositories/supervisionRepo.js';
import * as appraisalRepo from '../repositories/appraisalRepo.js';
import * as fireDrillRepo from '../repositories/fireDrillRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as auditService from '../services/auditService.js';
import { paginationSchema } from '../lib/pagination.js';

const router = Router();
router.use(writeRateLimiter);
const recordIdSchema = z.string().min(1).max(100);
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
const staffIdSchema = z.string().min(1).max(20);
const typeIdSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);

const trainingTypeSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  category: z.enum(['statutory', 'mandatory']),
  refresher_months: z.coerce.number().int().min(1).max(120).nullable(),
  roles: z.array(z.string().max(100)).max(50).nullable(),
  legislation: z.string().max(500).nullable().optional(),
  active: z.boolean(),
  levels: z.array(z.object({
    id: z.string().max(50),
    name: z.string().max(200),
    roles: z.array(z.string().max(100)).max(50).nullable().optional(),
  })).max(20).optional(),
});

const trainingTypesArraySchema = z.array(trainingTypeSchema).max(100);

// ── Zod Schemas ─────────────────────────────────────────────────────────────

const trainingRecordSchema = z.object({
  completed:       dateSchema,
  expiry:          dateSchema.optional(),
  trainer:         z.string().max(200).nullable().optional(),
  method:          z.enum(['classroom', 'e-learning', 'practical', 'online']).nullable().optional(),
  certificate_ref: z.string().max(200).nullable().optional(),
  level:           z.string().max(50).nullable().optional(),
  notes:           z.string().max(5000).nullable().optional(),
  _clientUpdatedAt: z.string().max(50).optional(),
});

const supervisionSchema = z.object({
  staffId:    staffIdSchema,
  date:       dateSchema,
  supervisor: z.string().max(200).nullable().optional(),
  topics:     z.string().max(5000).nullable().optional(),
  actions:    z.string().max(5000).nullable().optional(),
  next_due:   dateSchema.optional(),
  notes:      z.string().max(5000).nullable().optional(),
  _clientUpdatedAt: z.string().max(50).optional(),
});

const appraisalSchema = z.object({
  staffId:          staffIdSchema,
  date:             dateSchema,
  appraiser:        z.string().max(200).nullable().optional(),
  objectives:       z.string().max(5000).nullable().optional(),
  training_needs:   z.string().max(5000).nullable().optional(),
  development_plan: z.string().max(5000).nullable().optional(),
  next_due:         dateSchema.optional(),
  notes:            z.string().max(5000).nullable().optional(),
  _clientUpdatedAt: z.string().max(50).optional(),
});

const fireDrillSchema = z.object({
  date:                    dateSchema,
  time:                    z.string().max(10).nullable().optional(),
  scenario:                z.string().max(2000).nullable().optional(),
  evacuation_time_seconds: z.coerce.number().int().min(0).max(3600).nullable().optional(),
  staff_present:           z.array(z.string().max(20)).max(200).optional(),
  residents_evacuated:     z.coerce.number().int().min(0).max(500).nullable().optional(),
  issues:                  z.string().max(5000).nullable().optional(),
  corrective_actions:      z.string().max(5000).nullable().optional(),
  conducted_by:            z.string().max(200).nullable().optional(),
  notes:                   z.string().max(5000).nullable().optional(),
  _clientUpdatedAt:        z.string().max(50).optional(),
});

// GET /api/training?home=X — one-shot load for TrainingMatrix
router.get('/', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const pg = paginationSchema.parse(req.query);
    const [trainingResult, supervisionsResult, appraisalsResult, fireDrills, staffResult] = await Promise.all([
      trainingRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset }),
      supervisionRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset }),
      appraisalRepo.findByHome(req.home.id, { limit: pg.limit, offset: pg.offset }),
      fireDrillRepo.findByHome(req.home.id),
      staffRepo.findByHome(req.home.id),
    ]);
    const training = trainingResult.rows;
    const supervisions = supervisionsResult.rows;
    const appraisals = appraisalsResult.rows;
    const staff = staffResult.rows.map(s => ({ id: s.id, name: s.name, role: s.role, team: s.team, active: s.active, start_date: s.start_date }));
    const trainingTypes = req.home.config?.training_types || [];
    const supervisionConfig = {
      supervision_frequency_probation: req.home.config?.supervision_frequency_probation ?? 30,
      supervision_frequency_standard: req.home.config?.supervision_frequency_standard ?? 49,
      supervision_probation_months: req.home.config?.supervision_probation_months ?? 6,
    };
    res.json({ training, supervisions, appraisals, fireDrills, trainingTypes, staff, supervisionConfig });
  } catch (err) { next(err); }
});

// PUT /api/training/config/types?home=X — update training types in config
router.put('/config/types', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = trainingTypesArraySchema.safeParse(req.body?.trainingTypes);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const updatedConfig = { ...req.home.config, training_types: parsed.data };
    const { updateConfig } = await import('../repositories/homeRepo.js');
    await updateConfig(req.home.id, updatedConfig);
    await auditService.log('training_types_update', req.home.slug, req.user.username, null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/training/supervisions?home=X — create supervision
router.post('/supervisions', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = supervisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = { ...parsed.data, id: `sup-${randomUUID()}` };
    const session = await supervisionRepo.upsertSession(req.home.id, parsed.data.staffId, record);
    await auditService.log('supervision_create', req.home.slug, req.user.username, { staffId: parsed.data.staffId });
    res.status(201).json(session);
  } catch (err) { next(err); }
});

// PUT /api/training/supervisions/:id?home=X — update supervision
router.put('/supervisions/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = supervisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = { ...parsed.data, id: idParsed.data };
    const session = await supervisionRepo.upsertSession(req.home.id, parsed.data.staffId, record);
    await auditService.log('supervision_update', req.home.slug, req.user.username, { staffId: parsed.data.staffId, id: idParsed.data });
    res.json(session);
  } catch (err) { next(err); }
});

// DELETE /api/training/supervisions/:id?home=X — soft-delete supervision
router.delete('/supervisions/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await supervisionRepo.softDeleteSession(req.home.id, idParsed.data);
    if (!deleted) return res.status(404).json({ error: 'Supervision not found' });
    await auditService.log('supervision_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/training/appraisals?home=X — create appraisal
router.post('/appraisals', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = appraisalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = { ...parsed.data, id: `apr-${randomUUID()}` };
    const appraisal = await appraisalRepo.upsertAppraisal(req.home.id, parsed.data.staffId, record);
    await auditService.log('appraisal_create', req.home.slug, req.user.username, { staffId: parsed.data.staffId });
    res.status(201).json(appraisal);
  } catch (err) { next(err); }
});

// PUT /api/training/appraisals/:id?home=X — update appraisal
router.put('/appraisals/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = appraisalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = { ...parsed.data, id: idParsed.data };
    const appraisal = await appraisalRepo.upsertAppraisal(req.home.id, parsed.data.staffId, record);
    await auditService.log('appraisal_update', req.home.slug, req.user.username, { staffId: parsed.data.staffId, id: idParsed.data });
    res.json(appraisal);
  } catch (err) { next(err); }
});

// DELETE /api/training/appraisals/:id?home=X — soft-delete appraisal
router.delete('/appraisals/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await appraisalRepo.softDeleteAppraisal(req.home.id, idParsed.data);
    if (!deleted) return res.status(404).json({ error: 'Appraisal not found' });
    await auditService.log('appraisal_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/training/fire-drills?home=X — create fire drill
router.post('/fire-drills', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = fireDrillSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = { ...parsed.data, id: `fd-${randomUUID()}` };
    const drill = await fireDrillRepo.upsertDrill(req.home.id, record);
    await auditService.log('fire_drill_create', req.home.slug, req.user.username, { id: record.id });
    res.status(201).json(drill);
  } catch (err) { next(err); }
});

// PUT /api/training/fire-drills/:id?home=X — update fire drill
router.put('/fire-drills/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = fireDrillSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = { ...parsed.data, id: idParsed.data };
    const drill = await fireDrillRepo.upsertDrill(req.home.id, record);
    await auditService.log('fire_drill_update', req.home.slug, req.user.username, { id: idParsed.data });
    res.json(drill);
  } catch (err) { next(err); }
});

// DELETE /api/training/fire-drills/:id?home=X — hard-delete fire drill
router.delete('/fire-drills/:id', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await fireDrillRepo.removeDrill(req.home.id, idParsed.data);
    if (!deleted) return res.status(404).json({ error: 'Fire drill not found' });
    await auditService.log('fire_drill_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PUT /api/training/:staffId/:typeId?home=X — upsert single training record
// NOTE: Must be registered AFTER all named routes (config/*, supervisions/*, appraisals/*, fire-drills/*)
// to avoid the greedy /:staffId/:typeId pattern shadowing them.
router.put('/:staffId/:typeId', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const staffParsed = staffIdSchema.safeParse(req.params.staffId);
    const typeParsed = typeIdSchema.safeParse(req.params.typeId);
    if (!staffParsed.success || !typeParsed.success) return res.status(400).json({ error: 'Invalid staffId or typeId' });
    const parsed = trainingRecordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = await trainingRepo.upsertRecord(req.home.id, staffParsed.data, typeParsed.data, parsed.data);
    await auditService.log('training_record_upsert', req.home.slug, req.user.username, { staffId: staffParsed.data, typeId: typeParsed.data });
    res.json(record);
  } catch (err) { next(err); }
});

// DELETE /api/training/:staffId/:typeId?home=X — remove training record
// NOTE: Must be registered AFTER all named routes for the same reason.
router.delete('/:staffId/:typeId', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const staffParsed = staffIdSchema.safeParse(req.params.staffId);
    const typeParsed = typeIdSchema.safeParse(req.params.typeId);
    if (!staffParsed.success || !typeParsed.success) return res.status(400).json({ error: 'Invalid staffId or typeId' });
    await trainingRepo.removeRecord(req.home.id, staffParsed.data, typeParsed.data);
    await auditService.log('training_record_delete', req.home.slug, req.user.username, { staffId: staffParsed.data, typeId: typeParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
