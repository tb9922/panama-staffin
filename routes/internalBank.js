import { Router } from 'express';
import { z } from 'zod';
import { zodError } from '../errors.js';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter } from '../lib/rateLimiter.js';
import { requiredDateInput } from '../lib/zodHelpers.js';
import * as internalBankService from '../services/internalBankService.js';

const router = Router();

const candidatesQuerySchema = z.object({
  role: z.string().trim().max(100).optional(),
  shift_date: requiredDateInput,
  shift_code: z.enum(['AG-E', 'AG-L', 'AG-N']),
  hours: z.coerce.number().positive().max(24).optional().default(8),
});

router.get('/candidates', readRateLimiter, requireAuth, requireHomeAccess, requireModule('staff', 'read'), async (req, res, next) => {
  try {
    const parsed = candidatesQuerySchema.safeParse(req.query);
    if (!parsed.success) return zodError(res, parsed);
    const result = await internalBankService.findCandidates({
      targetHomeId: req.home.id,
      username: req.user.username,
      isPlatformAdmin: req.authDbUser?.is_platform_admin === true,
      role: parsed.data.role,
      shiftDate: parsed.data.shift_date,
      shiftCode: parsed.data.shift_code,
      hours: parsed.data.hours,
    });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
