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
import { getMinimumWageRate } from '../shared/nmw.js';
import {
  canManageSensitiveStaffFields as roleCanManageSensitiveStaffFields,
  listChangedSensitiveStaffFields,
  redactStaffForBroadReader,
} from '../shared/staffPolicy.js';
import { todayLocalISO } from '../lib/dateOnly.js';

const router = Router();
const staffIdSchema = z.string().min(1).max(20);

const STAFF_ROLES = ['Senior Carer', 'Carer', 'Team Lead', 'Night Senior', 'Night Carer', 'Float Senior', 'Float Carer'];
const STAFF_TEAMS = ['Day A', 'Day B', 'Night A', 'Night B', 'Float'];

const STAFF_PREFS = ['E', 'L', 'EL', 'N', 'ANY'];
const INTERNAL_BANK_STATUSES = ['available', 'limited', 'paused', 'not_interested'];
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
  phone:           z.string().max(20).nullable().optional(),
  address:         z.string().max(500).nullable().optional(),
  emergency_contact: z.string().max(200).nullable().optional(),
  willing_extras:  z.boolean().optional(),
  willing_other_homes: z.boolean().optional(),
  max_weekly_hours_topup: z.number().min(0).max(80).nullable().optional(),
  max_travel_radius_km: z.number().int().min(0).max(500).nullable().optional(),
  home_postcode:   z.string().trim().max(20).nullable().optional(),
  internal_bank_status: z.enum(INTERNAL_BANK_STATUSES).optional(),
  internal_bank_notes: z.string().max(1000).nullable().optional(),
  notes:           z.string().max(1000).nullable().optional(),
});
const staffUpdateSchema = staffBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});
const overrideRequestDecisionSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  decisionNote: z.string().max(1000).optional(),
  expectedVersion: z.number().int().nonnegative(),
});

function normalizeStaffPayload(payload, { config = null, defaultHourlyRate = false } = {}) {
  const normalized = { ...payload };
  if (typeof normalized.name === 'string') normalized.name = normalized.name.trim().replace(/\s+/g, ' ');
  if (defaultHourlyRate && normalized.hourly_rate == null) {
    normalized.hourly_rate = getMinimumWageRate(normalized.date_of_birth, config).rate;
  }
  return normalized;
}

function canManageSensitiveStaffFields(req) {
  return roleCanManageSensitiveStaffFields(req.homeRole, {
    isPlatformAdmin: req.user?.is_platform_admin && req.homeRole != null,
  });
}

function assertSensitiveStaffFieldAccess(req, res, payload, existing = null) {
  const requested = listChangedSensitiveStaffFields(payload, existing);
  if (requested.length > 0 && !canManageSensitiveStaffFields(req)) {
    return res.status(403).json({
      error: 'Home manager, deputy manager, or HR officer role required for sensitive staff fields',
      fields: requested,
    });
  }
  return null;
}

function assertStaffCreateAccess(req, res) {
  if (!canManageSensitiveStaffFields(req)) {
    return res.status(403).json({ error: 'Home manager, deputy manager, or HR officer role required to create staff records' });
  }
  return null;
}

function assertStaffDeleteAccess(req, res) {
  if (!canManageSensitiveStaffFields(req)) {
    return res.status(403).json({ error: 'Home manager, deputy manager, or HR officer role required to remove staff records' });
  }
  return null;
}

function shapeStaffResponse(req, staff, warnings = []) {
  const body = canManageSensitiveStaffFields(req)
    ? staff
    : redactStaffForBroadReader([staff])[0];
  return warnings.length > 0 && canManageSensitiveStaffFields(req) ? { ...body, warnings } : body;
}

// POST /api/staff?home=X — create a new staff member
// Server generates the ID inside a transaction to prevent concurrent collisions.
// Client-provided IDs are allowed for imports/backfills, but POST must never
// overwrite an existing staff row. Updates belong on PUT /api/staff/:staffId.
router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('staff', 'write'), async (req, res, next) => {
  try {
    const parsed = staffBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const createAccessError = assertStaffCreateAccess(req, res);
    if (createAccessError) return createAccessError;
    const fieldAccessError = assertSensitiveStaffFieldAccess(req, res, parsed.data);
    if (fieldAccessError) return fieldAccessError;
    const data = normalizeStaffPayload(parsed.data, { config: req.home.config, defaultHourlyRate: true });
    const staff = await withTransaction(async (client) => {
      if (!data.id) {
        data.id = await staffRepo.nextId(req.home.id, client);
      }
      const created = await staffRepo.createOne(req.home.id, data, client);
      await auditService.log('staff_create', req.home.slug, req.user.username, { staff_id: data.id }, client);
      return created;
    });
    const warnings = [];
    const nlwWarning = checkNLWViolation(staff, req.home.config);
    if (nlwWarning) warnings.push(nlwWarning);
    res.status(201).json(shapeStaffResponse(req, staff, warnings));
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
    const fieldAccessError = assertSensitiveStaffFieldAccess(req, res, parsed.data, existing);
    if (fieldAccessError) return fieldAccessError;
    const { version } = splitVersion(parsed.data);
    const staff = await withTransaction(async (client) => {
      const lockedExisting = await staffRepo.findById(req.home.id, idParsed.data, client);
      if (!lockedExisting) return undefined;
      const updated = await staffRepo.updateOne(req.home.id, idParsed.data, normalizeStaffPayload(definedWithoutVersion(parsed.data)), version, client);
      if (updated === null) return null;
      const changes = diffFields(lockedExisting, updated);
      await auditService.log('staff_update', req.home.slug, req.user.username, { staff_id: idParsed.data, changes }, client);
      return updated;
    });
    if (staff === undefined) return res.status(404).json({ error: 'Staff member not found' });
    if (staff === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const warnings = [];
    const nlwWarning = checkNLWViolation(staff, req.home.config);
    if (nlwWarning) warnings.push(nlwWarning);
    res.json(shapeStaffResponse(req, staff, warnings));
  } catch (err) { next(err); }
});

// DELETE /api/staff/:staffId?home=X — soft-delete staff + remove their overrides
router.delete('/:staffId', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('staff', 'write'), async (req, res, next) => {
  try {
    const idParsed = staffIdSchema.safeParse(req.params.staffId);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid staff ID' });
    const deleteAccessError = assertStaffDeleteAccess(req, res);
    if (deleteAccessError) return deleteAccessError;
    await withTransaction(async (client) => {
      const deleted = await staffRepo.softDeleteOne(req.home.id, idParsed.data, client);
      if (!deleted) throw Object.assign(new Error('Staff member not found'), { status: 404 });
      await overrideRepo.deleteFutureForStaff(req.home.id, idParsed.data, todayLocalISO(), client);
      await auditService.log('staff_deactivate', req.home.slug, req.user.username, { staff_id: idParsed.data }, client);
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// GET /api/staff/override-requests?home=X — pending staff self-service requests for manager review
function requireOverrideRequestReviewer(req, res, next) {
  if (!['home_manager', 'deputy_manager'].includes(req.homeRole)) {
    return res.status(403).json({ error: 'Home manager or deputy manager role required' });
  }
  next();
}

router.get('/override-requests', requireAuth, requireHomeAccess, requireModule('scheduling', 'write'), requireOverrideRequestReviewer, async (req, res, next) => {
  try {
    const rows = await overrideRequestService.findPending({ homeId: req.home.id });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/staff/override-requests/:id/decision?home=X — approve / reject a pending request
router.post('/override-requests/:id/decision', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('scheduling', 'write'), requireOverrideRequestReviewer, async (req, res, next) => {
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
