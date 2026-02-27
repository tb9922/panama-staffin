import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as homeService from '../services/homeService.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as incidentRepo from '../repositories/incidentRepo.js';
import * as auditService from '../services/auditService.js';
import { validateAll } from '../services/validationService.js';

const router = Router();

const saveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many save requests — try again in 15 minutes' },
});

const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid home ID').optional();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const homeParam = homeIdSchema.safeParse(req.query.home);
    if (!homeParam.success) return res.status(400).json({ error: 'Invalid home parameter' });
    const homeSlug = homeParam.data;
    if (!homeSlug) return res.status(400).json({ error: 'home parameter is required' });

    const data = await homeService.assembleData(homeSlug, req.user.role);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, requireAdmin, saveLimiter, async (req, res, next) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || !Array.isArray(body.staff) || typeof body.config !== 'object') {
      return res.status(400).json({ error: 'Invalid data shape — expected { config, staff, overrides }' });
    }

    const homeParam = homeIdSchema.safeParse(req.query.home);
    if (!homeParam.success) return res.status(400).json({ error: 'Invalid home parameter' });
    const homeSlug = homeParam.data || body.config?.home_name?.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';

    const warnings = validateAll(body);
    await homeService.saveData(homeSlug, body, req.user?.username || 'unknown');

    res.json({ ok: true, warnings, backedUp: true });
  } catch (err) {
    next(err);
  }
});

// ── Helper: resolve slug → home ───────────────────────────────────────────────

async function resolveHome(req, res) {
  const parsed = homeIdSchema.safeParse(req.query.home);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid home parameter' }); return null; }
  if (!parsed.data)    { res.status(400).json({ error: 'home parameter is required' }); return null; }
  const home = await homeRepo.findBySlug(parsed.data);
  if (!home) { res.status(404).json({ error: 'Home not found' }); return null; }
  return home;
}

// ── Incident freeze + addenda ─────────────────────────────────────────────────

const incidentIdSchema = z.string().min(1).max(50);
const addendumSchema = z.object({
  content: z.string().min(1, 'Addendum content is required').max(5000),
});

// POST /api/data/incidents/:id/freeze?home=X — freeze an incident (immutable)
router.post('/incidents/:id/freeze', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idParsed = incidentIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid incident ID' });

    const frozen = await incidentRepo.freeze(idParsed.data, home.id);
    if (!frozen) return res.status(404).json({ error: 'Incident not found or already frozen' });

    await auditService.log('incident_freeze', home.slug, req.user.username, { incident_id: idParsed.data });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/data/incidents/:id/addenda?home=X — list addenda for an incident
router.get('/incidents/:id/addenda', requireAuth, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idParsed = incidentIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid incident ID' });

    const addenda = await incidentRepo.getAddenda(idParsed.data, home.id);
    res.json(addenda);
  } catch (err) {
    next(err);
  }
});

// POST /api/data/incidents/:id/addenda?home=X — add an addendum to an incident
router.post('/incidents/:id/addenda', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const home = await resolveHome(req, res);
    if (!home) return;
    const idParsed = incidentIdSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid incident ID' });

    const parsed = addendumSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const addendum = await incidentRepo.addAddendum(
      idParsed.data, home.id, req.user.username, parsed.data.content
    );
    await auditService.log('incident_addendum', home.slug, req.user.username, { incident_id: idParsed.data });
    res.json(addendum);
  } catch (err) {
    next(err);
  }
});

export default router;
