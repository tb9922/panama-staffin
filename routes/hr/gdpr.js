import { Router } from 'express';
import { requireAuth, requireAdmin, requireHomeAccess } from '../../middleware/auth.js';
import * as hrRepo from '../../repositories/hrRepo.js';
import * as auditService from '../../services/auditService.js';
import * as auditRepo from '../../repositories/auditRepo.js';

const router = Router();

router.post('/admin/purge-expired', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const retentionYears = Math.max(1, parseInt(req.body.retention_years, 10) || 6);
    const dryRun = req.body.dry_run !== false;
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

router.get('/admin/audit-export', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const from = req.query.from || '1970-01-01';
    const to = req.query.to || '9999-12-31';
    const rows = await auditRepo.exportHrByHome(req.home.slug, from, to);
    res.setHeader('Content-Disposition', `attachment; filename="hr-audit-${req.home.slug}-${from}-${to}.json"`);
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
