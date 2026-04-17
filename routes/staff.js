import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { writeRateLimiter } from '../lib/rateLimiter.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import * as overrideRequestService from '../services/overrideRequestService.js';
import { withTransaction } from '../db.js';
import * as auditService from '../services/auditService.js';
import { diffFields } from '../lib/audit.js';
import { checkNLWViolation } from '../services/validationService.js';
import { definedWithoutVersion, splitVersion } from '../lib/versionedPayload.js';

const router = Router();
const staffIdSchema = z.string().min(1).max(20);

const STAFF_ROLES = ['Senior Carer', 'Carer', 'Team Lead', 'Night Senior', 'Night Carer', 'Float Senior', 'Float Carer'];
const STAFF_TEAMS = ['Day A', 'Day B', 'Night A', 'Night B', 'Float'];

const STAFF_PREFS = ['E', 'L', 'EL', 'N', 'ANY'];
const optDate = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional());
const optNI   = z.preprocess(v => v === '' ? null : v, z.string().regex(/^[A-Z]{2}\d{6}[A-D]$/).nullable().optional());

const staffBodySchema = z.object({
  id:              z.string().min(1).max(20).optional(),
  name:            z.string().min(1).max(200),
  role:            z.enum(STAFF_ROLES),
  team:            z.enum(STAFF_TEAMS),
  pref:            z.enum(STAFF_PREFS).nullable().optional(),
  skill:           z.number().min(0).max(5).optional(),
  hourly_rate:     z.number().positive().optional(),
  active:          z.boolean().optional(),
  wtr_opt_out:     z.boolean().optional(),
  start_date:      optDate,
  contract_hours:  z.number().min(0).nullable().optional(),
  date_of_birth:   optDate,
  ni_number:       optNI,
  al_entitlement:  z.number().min(0).max(2000).nullable().optional(),
  al_carryover:    z.number().min(0).max(500).optional(),
  leaving_date:    optDate,
});
const staffUpdateSchema = staffBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});
const overrideRequestDecisionSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  decisionNote: z.string().max(1000).optional(),
  expectedVersion: z.number().int().nonnegative(),
});

// POST /api/staff?home=X — create a new staff member
// Server generates the ID inside a transaction to prevent concurrent collisions.
// Client-provided IDs are allowed for imports/backfills, but POST must never
// overwrite an existing staff row. Updates belong on PUT /api/staff/:staffId.
router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('staff', 'write'), async (req, res, next) => {
  try {
    const parsed = staffBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const data = parsed.data;
    const staff = await withTransaction(async (client) => {
      if (!data.id) {
        data.id = await staffRepo.nextId(req.home.id, client);
      }
      return staffRepo.createOne(req.home.id, data, client);
    });
    await auditService.log('staff_create', req.home.slug, req.user.username, { staff_id: data.id });
    const warnings = [];
    const nlwWarning = checkNLWViolation(staff, req.home.config);
    if (nlwWarning) warnings.push(nlwWarning);
    res.status(201).json(warnings.length > 0 ? { ...staff, warnings } : staff);
  } catch (err) { next(err); }
});

// PUT /api/staff/:staffId?home=X — update a staff member
router.put('/:staffId', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('staff', 'write'), async (req, res, next) => {
  try {
    const idParsed = staffIdSchema.safeParse(req.params.staffId);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid staff ID' });
    const parsed = staffUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await staffRepo.findById(req.home.id, idParsed.data);
    if (!existing) return res.status(404).json({ error: 'Staff member not found' });
    const { version } = splitVersion(parsed.data);
    const staff = await staffRepo.updateOne(req.home.id, idParsed.data, definedWithoutVersion(parsed.data), version);
    if (staff === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const changes = diffFields(existing, staff);
    await auditService.log('staff_update', req.home.slug, req.user.username, { staff_id: idParsed.data, changes });
    const warnings = [];
    const nlwWarning = checkNLWViolation(staff, req.home.config);
    if (nlwWarning) warnings.push(nlwWarning);
    res.json(warnings.length > 0 ? { ...staff, warnings } : staff);
  } catch (err) { next(err); }
});

// DELETE /api/staff/:staffId?home=X — soft-delete staff + remove their overrides
router.delete('/:staffId', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('staff', 'write'), async (req, res, next) => {
  try {
    const idParsed = staffIdSchema.safeParse(req.params.staffId);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid staff ID' });
    await withTransaction(async (client) => {
      const deleted = await staffRepo.softDeleteOne(req.home.id, idParsed.data, client);
      if (!deleted) throw Object.assign(new Error('Staff member not found'), { status: 404 });
      await overrideRepo.deleteForStaff(req.home.id, idParsed.data, client);
    });
    await auditService.log('staff_deactivate', req.home.slug, req.user.username, { staff_id: idParsed.data });
    res.json({ ok: true });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// GET /api/staff/override-requests?home=X — pending staff self-service requests for manager review
router.get('/override-requests', requireAuth, requireHomeAccess, requireModule('scheduling', 'write'), async (req, res, next) => {
  try {
    const rows = await overrideRequestService.findPending({ homeId: req.home.id });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/staff/override-requests/:id/decision?home=X — approve / reject a pending request
router.post('/override-requests/:id/decision', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('scheduling', 'write'), async (req, res, next) => {
  try {
    const id = staffIdSchema.transform((value) => Number.parseInt(value, 10)).safeParse(req.params.id);
    if (!id.success || !Number.isInteger(id.data) || id.data <= 0) {
      return res.status(400).json({ error: 'Invalid request ID' });
    }
    const parsed = overrideRequestDecisionSchema.safeParse(req.body || {});
    if (!parsed.success) return zodError(res, parsed);
    const request = await overrideRequestService.decideRequest({
      homeId: req.home.id,
      id: id.data,
      status: parsed.data.status,
      decidedBy: req.user.username,
      decisionNote: parsed.data.decisionNote,
      expectedVersion: parsed.data.expectedVersion,
    });
    res.json(request);
  } catch (err) {
    next(err);
  }
});

export default router;
