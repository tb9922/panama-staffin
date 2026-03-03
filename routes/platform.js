import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import { withTransaction } from '../db.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as userHomeRepo from '../repositories/userHomeRepo.js';
import * as auditService from '../services/auditService.js';

const router = Router();

const idSchema = z.coerce.number().int().positive();

const createHomeSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/, 'Slug must be lowercase alphanumeric with _ or -').optional(),
  registered_beds: z.coerce.number().int().min(1).max(200).default(30),
  care_type: z.string().max(100).default('residential'),
  cycle_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
});

const updateHomeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  registered_beds: z.coerce.number().int().min(1).max(200).optional(),
  care_type: z.string().max(100).optional(),
});

function buildDefaultConfig(name, beds, careType, cycleStartDate) {
  return {
    home_name: name,
    registered_beds: beds,
    care_type: careType,
    cycle_start_date: cycleStartDate,
    shifts: { E: { hours: 8 }, L: { hours: 8 }, EL: { hours: 12 }, N: { hours: 10 } },
    minimum_staffing: {
      early:  { heads: 3, skill_points: 3 },
      late:   { heads: 3, skill_points: 3 },
      night:  { heads: 2, skill_points: 2 },
    },
    agency_rate_day: 18, agency_rate_night: 22, ot_premium: 5, bh_premium_multiplier: 1.5,
    max_consecutive_days: 6, max_al_same_day: 2, al_entitlement_days: 28,
    leave_year_start: '04-01', al_carryover_max: 8,
    training_types: [],
    bank_holidays: [],
    nlw_rate: 12.21,
  };
}

function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// GET /api/platform/homes — list all homes with stats
router.get('/homes', readRateLimiter, requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const homes = await homeRepo.listAllWithStats(false);
    res.json({ homes });
  } catch (err) { next(err); }
});

// POST /api/platform/homes — create a new home
router.post('/homes', writeRateLimiter, requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const parsed = createHomeSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);

    const { name, registered_beds, care_type, cycle_start_date } = parsed.data;
    const slug = parsed.data.slug || generateSlug(name);

    if (slug.length < 2) {
      return res.status(400).json({ error: 'Generated slug is too short — provide an explicit slug' });
    }

    const exists = await homeRepo.slugExistsActive(slug);
    if (exists) {
      return res.status(409).json({ error: `A home with slug "${slug}" already exists` });
    }

    const config = buildDefaultConfig(name, registered_beds, care_type, cycle_start_date);

    const home = await withTransaction(async (client) => {
      const created = await homeRepo.create(slug, name, config, client);
      await userHomeRepo.grantAccess(req.user.username, created.id);
      await auditService.log('home_create', slug, req.user.username, { name });
      return created;
    });

    res.status(201).json({ id: home.id, slug: home.slug, name });
  } catch (err) { next(err); }
});

// PUT /api/platform/homes/:id — update a home
router.put('/homes/:id', writeRateLimiter, requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid home ID' });

    const parsed = updateHomeSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);

    const { name, registered_beds, care_type } = parsed.data;

    await withTransaction(async (client) => {
      const home = await homeRepo.findByIdIncludingDeleted(id.data, client);
      if (!home) return res.status(404).json({ error: 'Home not found' });
      if (home.deleted_at) return res.status(410).json({ error: 'Home has been deleted' });

      if (name) await homeRepo.updateName(id.data, name, client);

      const currentConfig = home.config || {};
      const mergedConfig = { ...currentConfig };
      if (name) mergedConfig.home_name = name;
      if (registered_beds !== undefined) mergedConfig.registered_beds = registered_beds;
      if (care_type !== undefined) mergedConfig.care_type = care_type;

      await homeRepo.updateConfig(id.data, mergedConfig, client);
      await auditService.log('home_update', home.slug, req.user.username, {
        changes: { name, registered_beds, care_type },
      });

      res.json({ ok: true });
    });
  } catch (err) { next(err); }
});

// DELETE /api/platform/homes/:id — soft-delete a home
router.delete('/homes/:id', writeRateLimiter, requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid home ID' });

    await withTransaction(async (client) => {
      // Lock the row to prevent concurrent delete race
      const { rows } = await client.query(
        'SELECT * FROM homes WHERE id = $1 FOR UPDATE',
        [id.data]
      );
      const home = rows[0];
      if (!home) return res.status(404).json({ error: 'Home not found' });
      if (home.deleted_at) return res.status(400).json({ error: 'Home is already deleted' });

      // Count active homes inside transaction — prevents last-home race
      const count = await homeRepo.countActive(client);
      if (count <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last home' });
      }

      // Capture affected users before revoking
      const revokedUsers = await userHomeRepo.findUsernamesForHome(id.data);

      await homeRepo.softDelete(id.data, client);
      await userHomeRepo.revokeAllForHome(id.data, client);
      await auditService.log('home_delete', home.slug, req.user.username, {
        usersRevoked: revokedUsers,
      });

      res.json({ ok: true });
    });
  } catch (err) { next(err); }
});

export default router;
