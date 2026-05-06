import { Router } from 'express';
import { z } from 'zod';
import { zodError } from '../../errors.js';
import { requireAuth, requireHomeAccess, requireModule } from '../../middleware/auth.js';
import * as hrRepo from '../../repositories/hrRepo.js';
import * as auditService from '../../services/auditService.js';
import * as auditRepo from '../../repositories/auditRepo.js';
import { isValidIsoDateOnly } from '../../lib/zodHelpers.js';

const router = Router();

const purgeBodySchema = z.object({
  retention_years: z.coerce.number().int().min(6).max(99).default(6),
  dry_run: z.boolean().default(true),
});

const dateParamSchema = z.string().refine(isValidIsoDateOnly, 'Invalid calendar date');

router.post('/admin/purge-expired', requireAuth, requireHomeAccess, requireModule('gdpr', 'write'), async (req, res, next) => {
  try {
    const parsed = purgeBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const { retention_years: retentionYears, dry_run: dryRun } = parsed.data;
    const counts = await hrRepo.purgeExpiredRecords(req.home.id, retentionYears, dryRun);
    // Audit evidence is retained for at least seven years even when HR case
    // records use the six-year Limitation Act clock.
    const auditRetentionYears = Math.max(retentionYears, 7);
    const retentionDays = auditRetentionYears * 365;
    counts.audit_log = dryRun
      ? await auditRepo.countOlderThan(retentionDays, req.home.slug)
      : await auditRepo.purgeOlderThan(retentionDays, req.home.slug);
    await auditService.log(dryRun ? 'hr_purge_preview' : 'hr_purge_execute', req.home.slug, req.user.username, {
      retentionYears,
      auditRetentionYears,
      counts,
    });
    res.json({ dry_run: dryRun, retention_years: retentionYears, audit_retention_years: auditRetentionYears, counts });
  } catch (err) { next(err); }
});

router.get('/admin/audit-export', requireAuth, requireHomeAccess, requireModule('gdpr', 'read'), async (req, res, next) => {
  try {
    if (req.query.from !== undefined && !dateParamSchema.safeParse(req.query.from).success) {
      return res.status(400).json({ error: 'Invalid from date' });
    }
    if (req.query.to !== undefined && !dateParamSchema.safeParse(req.query.to).success) {
      return res.status(400).json({ error: 'Invalid to date' });
    }
    const from = req.query.from || '1970-01-01';
    const to = req.query.to || '9999-12-31';
    if (from > to) return res.status(400).json({ error: 'from must be on or before to' });
    const rows = await auditRepo.exportHrByHome(req.home.slug, from, to);
    await auditService.log('hr_audit_export_download', req.home.slug, req.user.username, {
      from,
      to,
      row_count: rows.length,
    });
    res.setHeader('Content-Disposition', `attachment; filename="hr-audit-${req.home.slug}-${from}-${to}.json"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
