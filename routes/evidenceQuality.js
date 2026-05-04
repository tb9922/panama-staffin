import { Router } from 'express';
import { z } from 'zod';
import { zodError } from '../errors.js';
import { readRateLimiter } from '../lib/rateLimiter.js';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { getEvidenceQuality } from '../services/evidenceQualityService.js';

const router = Router();

const querySchema = z.object({
  domain: z.enum(['safe', 'effective', 'caring', 'responsive', 'well-led']).optional(),
  statement: z.string().regex(/^(S[1-8]|E[1-6]|C[1-5]|R[1-7]|WL[1-8])$/).optional(),
});

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return zodError(res, parsed);
    const payload = await getEvidenceQuality(req.home.id, parsed.data);
    res.setHeader('Cache-Control', 'no-store');
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
