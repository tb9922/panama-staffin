import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as incidentRepo from '../repositories/incidentRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as auditService from '../services/auditService.js';

const router = Router();

const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/).optional();
const incidentIdSchema = z.string().min(1).max(100);
const addendumSchema = z.object({ content: z.string().min(1).max(5000) });

async function resolveHome(req, res) {
  const p = homeIdSchema.safeParse(req.query.home);
  if (!p.success || !p.data) { res.status(400).json({ error: 'home parameter is required' }); return null; }
  const home = await homeRepo.findBySlug(p.data);
  if (!home) { res.status(404).json({ error: 'Home not found' }); return null; }
  return home;
}

// GET /api/incidents?home=X
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const [incidents, staffRows] = await Promise.all([
      incidentRepo.findByHome(home.id),
      staffRepo.findByHome(home.id),
    ]);
    const incidentTypes = home.config?.incident_types || [];
    const staff = staffRows.filter(s => s.active !== false).map(s => ({ id: s.id, name: s.name, role: s.role }));
    res.json({ incidents, incidentTypes, staff });
  } catch (err) { next(err); }
});

// POST /api/incidents?home=X
router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    if (!req.body?.type || !req.body?.date || !req.body?.severity) {
      return res.status(400).json({ error: 'type, date, and severity are required' });
    }
    const incident = await incidentRepo.upsert(home.id, { ...req.body, reported_by: req.user.username });
    await auditService.log('incident_create', home.slug, req.user.username, { incident_id: incident?.id });
    res.status(201).json(incident);
  } catch (err) { next(err); }
});

// PUT /api/incidents/:id?home=X
router.put('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = incidentIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid incident ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const incident = await incidentRepo.upsert(home.id, { ...req.body, id: idParsed.data });
    if (!incident) return res.status(404).json({ error: 'Incident not found or frozen' });
    res.json(incident);
  } catch (err) { next(err); }
});

// DELETE /api/incidents/:id?home=X
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = incidentIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid incident ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const deleted = await incidentRepo.softDelete(idParsed.data, home.id);
    if (!deleted) return res.status(404).json({ error: 'Incident not found or frozen' });
    await auditService.log('incident_delete', home.slug, req.user.username, { incident_id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/incidents/:id/freeze?home=X
router.post('/:id/freeze', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = incidentIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid incident ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const frozen = await incidentRepo.freeze(idParsed.data, home.id);
    if (!frozen) return res.status(404).json({ error: 'Incident not found or already frozen' });
    await auditService.log('incident_freeze', home.slug, req.user.username, { incident_id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/incidents/:id/addenda?home=X
router.get('/:id/addenda', requireAuth, async (req, res, next) => {
  try {
    const idParsed = incidentIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid incident ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const addenda = await incidentRepo.getAddenda(idParsed.data, home.id);
    res.json(addenda);
  } catch (err) { next(err); }
});

// POST /api/incidents/:id/addenda?home=X
router.post('/:id/addenda', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const idParsed = incidentIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid incident ID' });
    const home = await resolveHome(req, res);
    if (!home) return;
    const parsed = addendumSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const addendum = await incidentRepo.addAddendum(idParsed.data, home.id, req.user.username, parsed.data.content);
    await auditService.log('incident_addendum', home.slug, req.user.username, { incident_id: idParsed.data });
    res.json(addendum);
  } catch (err) { next(err); }
});

export default router;
