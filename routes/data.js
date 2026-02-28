import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import * as homeService from '../services/homeService.js';
import * as auditService from '../services/auditService.js';
import { validateAll } from '../services/validationService.js';
import { homeConfigSchema } from '../lib/zodHelpers.js';

const staffItemSchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
}).passthrough();

const dataBodySchema = z.object({
  config: homeConfigSchema,
  staff: z.array(staffItemSchema).max(2000),
  overrides: z.object({}).passthrough(),
}).passthrough();

/** Detect data-corruption issues that MUST block the save */
function detectCriticalErrors(body) {
  const errors = [];
  // Duplicate staff IDs → data loss on round-trip
  const ids = body.staff.map(s => s.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) {
    errors.push(`Duplicate staff IDs: ${[...new Set(dupes)].join(', ')}`);
  }
  return errors;
}

const router = Router();

const saveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many save requests — try again in 15 minutes' },
});

router.get('/', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const data = await homeService.assembleData(req.home.slug, req.user.role);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, requireAdmin, requireHomeAccess, saveLimiter, async (req, res, next) => {
  try {
    const parsed = dataBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid data shape — expected { config, staff, overrides }' });
    }
    const body = req.body;

    const homeSlug = req.home.slug;

    // Optimistic locking — detect concurrent saves before writing
    // Client sends _clientUpdatedAt (the server timestamp from when it last loaded data).
    // If the DB timestamp has moved on, someone else saved in the meantime — return 409.
    const clientUpdatedAt = body._clientUpdatedAt;
    if (clientUpdatedAt && req.home.updated_at) {
      const serverUpdatedAt = req.home.updated_at.toISOString();
      if (serverUpdatedAt !== clientUpdatedAt) {
        return res.status(409).json({
          error: 'Conflict',
          message: 'This home was modified by someone else since you last loaded it.',
          serverUpdatedAt,
        });
      }
    }

    // Block save on data-corruption issues
    const criticalErrors = detectCriticalErrors(body);
    if (criticalErrors.length > 0) {
      return res.status(400).json({ error: 'Data integrity check failed', errors: criticalErrors });
    }

    const username = req.user?.username || 'unknown';
    const result = await homeService.saveData(homeSlug, body, username);

    // Respond immediately — validation is informational and doesn't block the save.
    // Run validateAll() fire-and-forget so the 17 domain validators don't add
    // latency to every save. Warning count is still logged for audit purposes.
    res.json({ ok: true, backedUp: true, _updatedAt: result?.updatedAt });

    // Fire-and-forget: validate + audit after response is sent
    try {
      const warnings = validateAll(body);
      await auditService.log('data_save', homeSlug, username, {
        staffCount: body.staff.length,
        warningCount: warnings.length,
      });
    } catch (_) { /* validation/audit failure must not surface after response */ }
  } catch (err) {
    next(err);
  }
});

export default router;
