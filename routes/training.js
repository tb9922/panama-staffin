import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as trainingRepo from '../repositories/trainingRepo.js';
import * as supervisionRepo from '../repositories/supervisionRepo.js';
import * as appraisalRepo from '../repositories/appraisalRepo.js';
import * as fireDrillRepo from '../repositories/fireDrillRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as auditService from '../services/auditService.js';

const router = Router();
const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/).optional();
const recordIdSchema = z.string().min(1).max(100);
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
const staffIdSchema = z.string().min(1).max(20);
const typeIdSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);

const trainingTypeSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  category: z.enum(['statutory', 'mandatory']),
  refresher_months: z.coerce.number().int().min(1).max(120).nullable(),
  roles: z.array(z.string().max(100)).nullable(),
  legislation: z.string().max(500).nullable().optional(),
  active: z.boolean(),
  levels: z.array(z.object({
    id: z.string().max(50),
    name: z.string().max(200),
    roles: z.array(z.string().max(100)).nullable().optional(),
  })).optional(),
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
  _clientUpdatedAt: z.string().optional(),
});

const supervisionSchema = z.object({
  staffId:    staffIdSchema,
  date:       dateSchema,
  supervisor: z.string().max(200).nullable().optional(),
  topics:     z.string().max(5000).nullable().optional(),
  actions:    z.string().max(5000).nullable().optional(),
  next_due:   dateSchema.optional(),
  notes:      z.string().max(5000).nullable().optional(),
  _clientUpdatedAt: z.string().optional(),
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
  _clientUpdatedAt: z.string().optional(),
});

const fireDrillSchema = z.object({
  date:                    dateSchema,
  time:                    z.string().max(10).nullable().optional(),
  scenario:                z.string().max(2000).nullable().optional(),
  evacuation_time_seconds: z.coerce.number().int().min(0).max(3600).nullable().optional(),
  staff_present:           z.array(z.string().max(20)).optional(),
  residents_evacuated:     z.coerce.number().int().min(0).max(500).nullable().optional(),
  issues:                  z.string().max(5000).nullable().optional(),
  corrective_actions:      z.string().max(5000).nullable().optional(),
  conducted_by:            z.string().max(200).nullable().optional(),
  notes:                   z.string().max(5000).nullable().optional(),
  _clientUpdatedAt:        z.string().optional(),
});

async function resolveHome(req, res) {
  const p = homeIdSchema.safeParse(req.query.home);
  if (!p.success || !p.data) { res.status(400).json({ error: 'home parameter is required' }); return null; }
  const home = await homeRepo.findBySlug(p.data);
  if (!home) { res.status(404).json({ error: 'Home not found' }); return null; }
  return home;
}

// GET /api/training?home=X — one-shot load for TrainingMatrix
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const [training, supervisions, appraisals, fireDrills, staffRows] = await Promise.all([
      trainingRepo.findByHome(home.id),
      supervisionRepo.findByHome(home.id),
      appraisalRepo.findByHome(home.id),
      fireDrillRepo.findByHome(home.id),
      staffRepo.findByHome(home.id),
    ]);
    const staff = staffRows.map(s => ({ id: s.id, name: s.name, role: s.role, team: s.team, active: s.active }));
    const trainingTypes = home.config?.training_types || [];
    res.json({ training, supervisions, appraisals, fireDrills, trainingTypes, staff });
  } catch (err) { next(err); }
});

// PUT /api/training/:staffId/:typeId?home=X — upsert single training record
router.put('/:staffId/:typeId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const staffParsed = staffIdSchema.safeParse(req.params.staffId);
    const typeParsed = typeIdSchema.safeParse(req.params.typeId);
    if (!staffParsed.success || !typeParsed.success) return res.status(400).json({ error: 'Invalid staffId or typeId' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = trainingRecordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = await trainingRepo.upsertRecord(home.id, staffParsed.data, typeParsed.data, parsed.data);
    await auditService.log('training_record_upsert', home.slug, req.user.username, { staffId: staffParsed.data, typeId: typeParsed.data });
    res.json(record);
  } catch (err) { next(err); }
});

// DELETE /api/training/:staffId/:typeId?home=X — remove training record
router.delete('/:staffId/:typeId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const staffParsed = staffIdSchema.safeParse(req.params.staffId);
    const typeParsed = typeIdSchema.safeParse(req.params.typeId);
    if (!staffParsed.success || !typeParsed.success) return res.status(400).json({ error: 'Invalid staffId or typeId' });
    const home = await resolveHome(req, res);
    if (!home) return;
    await trainingRepo.removeRecord(home.id, staffParsed.data, typeParsed.data);
    await auditService.log('training_record_delete', home.slug, req.user.username, { staffId: staffParsed.data, typeId: typeParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PUT /api/training/config/types?home=X — update training types in config
router.put('/config/types', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = trainingTypesArraySchema.safeParse(req.body?.trainingTypes);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const updatedConfig = { ...home.config, training_types: parsed.data };
    await homeRepo.updateConfig(home.id, updatedConfig);
    await auditService.log('training_types_update', home.slug, req.user.username, null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/training/supervisions?home=X — create supervision
router.post('/supervisions', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = supervisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = { ...parsed.data, id: `sup-${randomUUID()}` };
    const session = await supervisionRepo.upsertSession(home.id, parsed.data.staffId, record);
    await auditService.log('supervision_create', home.slug, req.user.username, { staffId: parsed.data.staffId });
    res.status(201).json(session);
  } catch (err) { next(err); }
});

// PUT /api/training/supervisions/:id?home=X — update supervision
router.put('/supervisions/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = supervisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = { ...parsed.data, id: idParsed.data };
    const session = await supervisionRepo.upsertSession(home.id, parsed.data.staffId, record);
    await auditService.log('supervision_update', home.slug, req.user.username, { staffId: parsed.data.staffId, id: idParsed.data });
    res.json(session);
  } catch (err) { next(err); }
});

// DELETE /api/training/supervisions/:id?home=X — soft-delete supervision
router.delete('/supervisions/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const deleted = await supervisionRepo.softDeleteSession(home.id, idParsed.data);
    if (!deleted) return res.status(404).json({ error: 'Supervision not found' });
    await auditService.log('supervision_delete', home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/training/appraisals?home=X — create appraisal
router.post('/appraisals', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = appraisalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = { ...parsed.data, id: `apr-${randomUUID()}` };
    const appraisal = await appraisalRepo.upsertAppraisal(home.id, parsed.data.staffId, record);
    await auditService.log('appraisal_create', home.slug, req.user.username, { staffId: parsed.data.staffId });
    res.status(201).json(appraisal);
  } catch (err) { next(err); }
});

// PUT /api/training/appraisals/:id?home=X — update appraisal
router.put('/appraisals/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = appraisalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = { ...parsed.data, id: idParsed.data };
    const appraisal = await appraisalRepo.upsertAppraisal(home.id, parsed.data.staffId, record);
    await auditService.log('appraisal_update', home.slug, req.user.username, { staffId: parsed.data.staffId, id: idParsed.data });
    res.json(appraisal);
  } catch (err) { next(err); }
});

// DELETE /api/training/appraisals/:id?home=X — soft-delete appraisal
router.delete('/appraisals/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const deleted = await appraisalRepo.softDeleteAppraisal(home.id, idParsed.data);
    if (!deleted) return res.status(404).json({ error: 'Appraisal not found' });
    await auditService.log('appraisal_delete', home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/training/fire-drills?home=X — create fire drill
router.post('/fire-drills', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = fireDrillSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = { ...parsed.data, id: `fd-${randomUUID()}` };
    const drill = await fireDrillRepo.upsertDrill(home.id, record);
    await auditService.log('fire_drill_create', home.slug, req.user.username, { id: record.id });
    res.status(201).json(drill);
  } catch (err) { next(err); }
});

// PUT /api/training/fire-drills/:id?home=X — update fire drill
router.put('/fire-drills/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = fireDrillSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
    const record = { ...parsed.data, id: idParsed.data };
    const drill = await fireDrillRepo.upsertDrill(home.id, record);
    await auditService.log('fire_drill_update', home.slug, req.user.username, { id: idParsed.data });
    res.json(drill);
  } catch (err) { next(err); }
});

// DELETE /api/training/fire-drills/:id?home=X — hard-delete fire drill
router.delete('/fire-drills/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = recordIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const deleted = await fireDrillRepo.removeDrill(home.id, idParsed.data);
    if (!deleted) return res.status(404).json({ error: 'Fire drill not found' });
    await auditService.log('fire_drill_delete', home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
