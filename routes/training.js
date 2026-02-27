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

async function resolveHome(req, res) {
  const p = homeIdSchema.safeParse(req.query.home);
  if (!p.success || !p.data) { res.status(400).json({ error: 'home parameter is required' }); return null; }
  const home = await homeRepo.findBySlug(p.data);
  if (!home) { res.status(404).json({ error: 'Home not found' }); return null; }
  return home;
}

// GET /api/training?home=X — one-shot load for TrainingMatrix
router.get('/', requireAuth, async (req, res, next) => {
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
    const home = await resolveHome(req, res);
    if (!home) return;
    const staffId = req.params.staffId;
    const typeId = req.params.typeId;
    if (!staffId || !typeId) return res.status(400).json({ error: 'staffId and typeId are required' });
    const record = await trainingRepo.upsertRecord(home.id, staffId, typeId, req.body);
    res.json(record);
  } catch (err) { next(err); }
});

// DELETE /api/training/:staffId/:typeId?home=X — remove training record
router.delete('/:staffId/:typeId', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    await trainingRepo.removeRecord(home.id, req.params.staffId, req.params.typeId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PUT /api/training/config/types?home=X — update training types in config
router.put('/config/types', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    if (!Array.isArray(req.body?.trainingTypes)) {
      return res.status(400).json({ error: 'trainingTypes array required' });
    }
    const updatedConfig = { ...home.config, training_types: req.body.trainingTypes };
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
    if (!req.body?.staffId || !req.body?.date) {
      return res.status(400).json({ error: 'staffId and date are required' });
    }
    const record = { ...req.body, id: `sup-${randomUUID()}` };
    const session = await supervisionRepo.upsertSession(home.id, req.body.staffId, record);
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
    if (!req.body?.staffId) return res.status(400).json({ error: 'staffId is required' });
    const record = { ...req.body, id: idParsed.data };
    const session = await supervisionRepo.upsertSession(home.id, req.body.staffId, record);
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
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/training/appraisals?home=X — create appraisal
router.post('/appraisals', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    if (!req.body?.staffId || !req.body?.date) {
      return res.status(400).json({ error: 'staffId and date are required' });
    }
    const record = { ...req.body, id: `apr-${randomUUID()}` };
    const appraisal = await appraisalRepo.upsertAppraisal(home.id, req.body.staffId, record);
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
    if (!req.body?.staffId) return res.status(400).json({ error: 'staffId is required' });
    const record = { ...req.body, id: idParsed.data };
    const appraisal = await appraisalRepo.upsertAppraisal(home.id, req.body.staffId, record);
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
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/training/fire-drills?home=X — create fire drill
router.post('/fire-drills', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    if (!req.body?.date) return res.status(400).json({ error: 'date is required' });
    const record = { ...req.body, id: `fd-${randomUUID()}` };
    const drill = await fireDrillRepo.upsertDrill(home.id, record);
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
    const record = { ...req.body, id: idParsed.data };
    const drill = await fireDrillRepo.upsertDrill(home.id, record);
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
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
