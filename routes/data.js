import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import * as homeService from '../services/homeService.js';
import { validateAll } from '../services/validationService.js';
import { homeConfigSchema } from '../lib/zodHelpers.js';
import { isOwnDataOnly } from '../shared/roles.js';
import logger from '../logger.js';

const staffItemSchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  role: z.string().max(100).optional(),
  team: z.string().max(100).optional(),
  pref: z.string().max(10).nullish(),
  skill: z.number().optional(),
  hourly_rate: z.number().optional(),
  active: z.boolean().optional(),
  wtr_opt_out: z.boolean().optional(),
  start_date: z.string().max(20).nullish(),
  date_of_birth: z.string().max(20).nullish(),
  ni_number: z.string().max(20).nullish(),
  contract_hours: z.number().nullish(),
  al_entitlement: z.number().nullish(),
  al_carryover: z.number().nullish(),
  leaving_date: z.string().max(20).nullish(),
  phone: z.string().max(20).nullish(),
  address: z.string().max(500).nullish(),
  emergency_contact: z.string().max(200).nullish(),
  willing_extras: z.boolean().optional(),
  willing_other_homes: z.boolean().optional(),
  max_weekly_hours_topup: z.number().nullish(),
  max_travel_radius_km: z.number().nullish(),
  home_postcode: z.string().max(20).nullish(),
  internal_bank_status: z.string().max(50).nullish(),
  internal_bank_notes: z.string().max(1000).nullish(),
  notes: z.string().max(1000).nullish(),
}).strip();

const MAX_PAYLOAD_SIZE = 5_000_000; // 5MB cap

const overrideEntrySchema = z.object({
  shift: z.string().max(10).optional(),
  reason: z.string().max(500).nullish(),
  source: z.string().max(50).nullish(),
  sleep_in: z.boolean().nullish(),
  replaces_staff_id: z.string().max(50).nullish(),
  override_hours: z.number().nullish(),
  al_hours: z.number().nullish(),
}).strip();

const dataBodySchema = z.object({
  config: homeConfigSchema,
  staff: z.array(staffItemSchema).max(2000),
  overrides: z.record(z.string(), z.record(z.string(), overrideEntrySchema)).optional(),
  day_notes: z.record(z.string(), z.string().max(5000)).optional(),
  _clientUpdatedAt: z.string().nullish(),
}).strip().refine(
  obj => JSON.stringify(obj).length < MAX_PAYLOAD_SIZE,
  { message: 'Payload too large (max 5MB)' },
);

function detectCriticalErrors(body) {
  const errors = [];
  const ids = body.staff.map(s => s.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) {
    errors.push(`Duplicate staff IDs: ${[...new Set(dupes)].join(', ')}`);
  }
  return errors;
}

const router = Router();

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('scheduling', 'read'), async (req, res, next) => {
  try {
    logger.warn({ home: req.home.slug, user: req.user.username }, 'GET /api/data called — deprecated, use dedicated endpoints');
    res.setHeader('X-Deprecated', 'Use /api/scheduling, /api/incidents, etc.');

    if (isOwnDataOnly(req.homeRole, 'scheduling')) {
      if (!req.staffId) return res.status(403).json({ error: 'No staff link configured — contact your home manager' });
      return res.status(403).json({ error: 'Use /api/scheduling for staff member access' });
    }

    const data = await homeService.assembleData(req.home.slug, req.homeRole);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('config', 'write'), async (req, res, next) => {
  try {
    const parsed = dataBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid data shape — expected { config, staff, overrides }' });
    }
    const body = parsed.data;
    const homeSlug = req.home.slug;

    if (body.overrides && Object.keys(body.overrides).length > 0) {
      return res.status(400).json({
        error: 'Legacy /api/data no longer accepts rota overrides. Use /api/scheduling so edit-lock, agency guard, fatigue, and audit checks run.',
      });
    }
    if (body.day_notes && Object.keys(body.day_notes).length > 0) {
      return res.status(400).json({
        error: 'Legacy /api/data no longer accepts day notes. Use /api/scheduling/day-notes so edit-lock and audit checks run.',
      });
    }
    if (body.staff?.length > 0) {
      return res.status(400).json({
        error: 'Legacy /api/data no longer accepts staff writes. Use /api/staff so HR/pay/GDPR field guards and staff audit checks run.',
      });
    }

    const criticalErrors = detectCriticalErrors(body);
    if (criticalErrors.length > 0) {
      return res.status(400).json({ error: 'Data integrity check failed', errors: criticalErrors });
    }

    const username = req.user?.username || 'unknown';
    const validationBody = { ...body, overrides: {}, day_notes: {} };
    const warnings = validateAll(validationBody);
    const clientUpdatedAt = body._clientUpdatedAt || null;
    const safeBody = { ...body };
    delete safeBody.overrides;
    delete safeBody.day_notes;
    const result = await homeService.saveData(homeSlug, safeBody, username, clientUpdatedAt, {
      staffCount: body.staff.length,
      warningCount: warnings.length,
    });

    res.json({ ok: true, backedUp: true, _updatedAt: result?.updatedAt });
  } catch (err) {
    next(err);
  }
});

export default router;
