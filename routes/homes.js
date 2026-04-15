import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import * as homeService from '../services/homeService.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as auditService from '../services/auditService.js';
import * as userHomeRepo from '../repositories/userHomeRepo.js';
import { diffFields } from '../lib/audit.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import { homeConfigSchema } from '../lib/zodHelpers.js';

const router = Router();

const configBodySchema = z.object({
  config: homeConfigSchema,
  _clientUpdatedAt: z.string().max(50).optional(),
}).strict();

// GET /api/homes — list homes the user can access, with per-home roleId
router.get('/', readRateLimiter, requireAuth, async (req, res, next) => {
  try {
    // Platform admins see all homes with home_manager access
    // Re-verify from DB — JWT claim may be stale (admin demoted after last login)
    if (req.user.is_platform_admin) {
      const dbUser = req.authDbUser;
      if (dbUser?.is_platform_admin && dbUser.active) {
        const homes = await homeService.listHomes();
        return res.json(homes.map(h => ({ ...h, roleId: 'home_manager', staffId: null })));
      }
      // Stale claim — clear and fall through to per-home role lookup
      req.user.is_platform_admin = false;
    }

    // Regular users: single joined query returns homes + role
    const rows = await userHomeRepo.findHomesWithRolesForUser(req.user.username);
    res.json(rows.map(r => ({
      id: r.slug,
      name: r.config?.home_name || r.name,
      beds: r.config?.registered_beds,
      type: r.config?.care_type,
      scanIntakeEnabled: Boolean(r.config?.scan_intake_enabled),
      scanIntakeTargets: Array.isArray(r.config?.scan_intake_targets) ? r.config.scan_intake_targets : [],
      scanOcrEngine: r.config?.scan_ocr_engine || 'paddleocr',
      roleId: r.role_id,
      staffId: r.staff_id || null,
    })));
  } catch (err) {
    next(err);
  }
});

// PUT /api/homes/config?home=X — update the config JSONB for a home
router.put('/config', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('config', 'write'), async (req, res, next) => {
  try {
    const parsed = configBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'config object required' });
    }

    const before = req.home.config ?? {};
    const nextConfig = { ...parsed.data.config };
    if (!Object.prototype.hasOwnProperty.call(parsed.data.config, 'edit_lock_pin') &&
        Object.prototype.hasOwnProperty.call(before, 'edit_lock_pin')) {
      nextConfig.edit_lock_pin = before.edit_lock_pin;
    }

    const updatedAt = await homeRepo.updateConfig(
      req.home.id,
      nextConfig,
      null,
      parsed.data._clientUpdatedAt
    );
    if (updatedAt === null) {
      return res.status(409).json({ error: 'Home config was modified by another user. Please refresh and try again.' });
    }

    const changes = diffFields(before, nextConfig);
    await auditService.log('home_config_update', req.home.slug, req.user.username, { changes });
    res.json({ ok: true, updated_at: updatedAt });
  } catch (err) { next(err); }
});

export default router;
