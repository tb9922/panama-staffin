import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter } from '../lib/rateLimiter.js';
import { canAccessEvidenceHub, EVIDENCE_SOURCE_IDS } from '../shared/evidenceHub.js';
import { RECORD_ATTACHMENT_MODULE_IDS } from '../shared/recordAttachmentModules.js';
import * as evidenceHubService from '../services/evidenceHubService.js';

const router = Router();

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date');

const querySchema = z.object({
  q: z.string().max(200).optional(),
  uploadedBy: z.string().max(200).optional(),
  dateFrom: dateOnlySchema.optional(),
  dateTo: dateOnlySchema.optional(),
  modules: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function requireEvidenceHubAccess(req, res, next) {
  if (!canAccessEvidenceHub(req.homeRole)) {
    return res.status(403).json({ error: 'No evidence sources available for this role' });
  }
  next();
}

router.get(
  '/search',
  readRateLimiter,
  requireAuth,
  requireHomeAccess,
  requireModule('reports', 'read'),
  requireEvidenceHubAccess,
  async (req, res, next) => {
    try {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues?.[0]?.message || 'Invalid query' });
      }

      const sourceModules = [];
      const recordModules = [];
      if (parsed.data.modules) {
        for (const value of parsed.data.modules.split(',').map((entry) => entry.trim()).filter(Boolean)) {
          if (EVIDENCE_SOURCE_IDS.includes(value)) {
            sourceModules.push(value);
            continue;
          }
          if (value.startsWith('record:')) {
            const recordModule = value.slice('record:'.length);
            if (RECORD_ATTACHMENT_MODULE_IDS.includes(recordModule)) {
              if (!sourceModules.includes('record')) sourceModules.push('record');
              recordModules.push(recordModule);
            }
          }
        }
      }

      const result = await evidenceHubService.search(req.home, req.homeRole, {
        q: parsed.data.q || null,
        uploadedBy: parsed.data.uploadedBy || null,
        dateFrom: parsed.data.dateFrom || null,
        dateTo: parsed.data.dateTo || null,
        sourceModules: sourceModules.length > 0 ? sourceModules : null,
        recordModules: recordModules.length > 0 ? recordModules : null,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/uploaders',
  readRateLimiter,
  requireAuth,
  requireHomeAccess,
  requireModule('reports', 'read'),
  requireEvidenceHubAccess,
  async (req, res, next) => {
    try {
      const uploaders = await evidenceHubService.listUploaders(req.home.id, req.homeRole);
      res.json(uploaders);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
