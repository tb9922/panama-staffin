import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule, requirePlatformAdmin } from '../middleware/auth.js';
import * as auditService from '../services/auditService.js';
import * as homeRepo from '../repositories/homeRepo.js';
import { findHomeSlugsForUser, getHomeRole } from '../repositories/userHomeRepo.js';
import { hasModuleAccess } from '../shared/roles.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import { zodError } from '../errors.js';

const router = Router();

const homeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(100).optional();
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10000).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
  home: homeIdSchema,
  action: z.string().max(100).optional().default(''),
  user: z.string().max(100).optional().default(''),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().default(''),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().default(''),
});

function isVerifiedPlatformAdmin(req) {
  const dbUser = req.authDbUser;
  return !!(dbUser?.active && dbUser.role === 'admin' && dbUser.is_platform_admin);
}

async function userCanReadAuditForHome(username, homeId, isPlatformAdmin) {
  if (isPlatformAdmin) return true;
  const assignment = await getHomeRole(username, homeId);
  if (!assignment) return false;
  return hasModuleAccess(assignment.role_id, 'config', 'read');
}

async function getAuditHomeSlugs(username, isPlatformAdmin) {
  if (isPlatformAdmin) {
    const homes = await homeRepo.listAllWithIds();
    return homes.map((home) => home.slug);
  }

  const slugs = await findHomeSlugsForUser(username);
  const eligibleSlugs = [];
  for (const slug of slugs) {
    const home = await homeRepo.findBySlug(slug);
    if (!home) continue;
    if (await userCanReadAuditForHome(username, home.id, false)) {
      eligibleSlugs.push(slug);
    }
  }
  return eligibleSlugs;
}

router.get('/', readRateLimiter, requireAuth, async (req, res, next) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const isPlatformAdmin = isVerifiedPlatformAdmin(req);

    if (parsed.data.home) {
      const home = await homeRepo.findBySlug(parsed.data.home);
      if (!home) return res.status(404).json({ error: 'Home not found' });
      const allowed = await userCanReadAuditForHome(req.user.username, home.id, isPlatformAdmin);
      if (!allowed) return res.status(403).json({ error: 'You do not have audit read access for this home' });
      const result = await auditService.search({
        homeSlug: parsed.data.home,
        action: parsed.data.action,
        userName: parsed.data.user,
        dateFrom: parsed.data.dateFrom,
        dateTo: parsed.data.dateTo,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });
      return res.json(result);
    }

    const slugs = await getAuditHomeSlugs(req.user.username, isPlatformAdmin);
    if (!isPlatformAdmin && slugs.length === 0) {
      return res.status(403).json({ error: 'No audit-read permission on any accessible home' });
    }
    const result = await auditService.search({
      homeSlugs: slugs,
      action: parsed.data.action,
      userName: parsed.data.user,
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/audit/purge — remove audit entries older than N days (default 2555 = ~7 years)
const purgeSchema = z.object({
  days: z.coerce.number().int().min(2555).max(3650).default(2555),
});

router.delete('/purge', writeRateLimiter, requireAuth, requirePlatformAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = purgeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const deleted = await auditService.purgeOlderThan(parsed.data.days, req.home.slug);
    res.json({ deleted, days: parsed.data.days, home: req.home.slug });
  } catch (err) {
    next(err);
  }
});

// POST /api/audit/report-download — log report PDF generation
const reportDownloadSchema = z.object({
  reportType: z.enum(['roster', 'cost', 'coverage', 'staff', 'boardpack', 'cqc-evidence']),
  dateRange: z.string().max(100).optional().default(''),
});

router.post('/report-download', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('reports', 'read'), async (req, res, next) => {
  try {
    const parsed = reportDownloadSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    await auditService.log('report_download', req.home.slug, req.user.username, parsed.data);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
