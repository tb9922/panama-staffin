import { Router } from 'express';
import { z } from 'zod';
import { zodError } from '../../errors.js';
import { requireAuth, requireHomeAccess, requireModule } from '../../middleware/auth.js';
import * as hrRepo from '../../repositories/hrRepo.js';
import * as auditService from '../../services/auditService.js';
import * as auditRepo from '../../repositories/auditRepo.js';

const router = Router();

const purgeBodySchema = z.object({
  retention_years: z.coerce.number().int().min(6).max(99).default(6),
  dry_run: z.boolean().default(true),
});

const dateParamSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

router.post('/admin/purge-expired', requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const parsed = purgeBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const { retention_years: retentionYears, dry_run: dryRun } = parsed.data;
    const counts = await hrRepo.purgeExpiredRecords(req.home.id, retentionYears, dryRun);
    // Also purge audit log entries beyond retention period
    const retentionDays = retentionYears * 365;
    counts.audit_log = dryRun
      ? await auditRepo.countOlderThan(retentionDays, req.home.slug)
      : await auditRepo.purgeOlderThan(retentionDays, req.home.slug);
    await auditService.log(dryRun ? 'hr_purge_preview' : 'hr_purge_execute', req.home.slug, req.user.username, { retentionYears, counts });
    res.json({ dry_run: dryRun, retention_years: retentionYears, counts });
  } catch (err) { next(err); }
});

router.get('/admin/audit-export', requireAuth, requireHomeAccess, requireModule('gdpr', 'read'), async (req, res, next) => {
  try {
    const from = dateParamSchema.safeParse(req.query.from).success ? req.query.from : '1970-01-01';
    const to = dateParamSchema.safeParse(req.query.to).success ? req.query.to : '9999-12-31';
    const rows = await auditRepo.exportHrByHome(req.home.slug, from, to);
    res.setHeader('Content-Disposition', `attachment; filename="hr-audit-${req.home.slug}-${from}-${to}.json"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
