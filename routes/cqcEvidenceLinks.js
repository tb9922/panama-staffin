import { Router } from 'express';
import { z } from 'zod';
import { zodError } from '../errors.js';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';
import { splitVersion } from '../lib/versionedPayload.js';
import * as auditService from '../services/auditService.js';
import * as cqcEvidenceLinksRepo from '../repositories/cqcEvidenceLinksRepo.js';
import { ALLOWED_CQC_EVIDENCE_CATEGORY_VALUES } from '../src/lib/cqcEvidenceCategories.js';
import { hasModuleAccess } from '../shared/roles.js';
import { pool } from '../db.js';

const router = Router();

const SOURCE_MODULES = [
  'incident',
  'complaint',
  'training_record',
  'supervision',
  'appraisal',
  'fire_drill',
  'ipc_audit',
  'maintenance',
  'risk',
  'policy_review',
  'whistleblowing',
  'dols',
  'mca_assessment',
  'cqc_evidence',
  'cqc_partner_feedback',
  'cqc_observation',
  'handover',
  'onboarding',
  'care_certificate',
  'hr_disciplinary',
  'hr_grievance',
  'hr_performance',
  'hr_rtw_interview',
  'hr_oh_referral',
  'hr_contract',
  'hr_family_leave',
  'hr_flexible_working',
  'hr_edi',
  'hr_tupe',
  'hr_renewal',
];
const SOURCE_TABLES = {
  incident: { table: 'incidents', idExpr: 'id::text', softDelete: true },
  complaint: { table: 'complaints', idExpr: 'id::text', softDelete: true },
  training_record: { table: 'training_records', idExpr: 'id::text', softDelete: true },
  supervision: { table: 'supervisions', idExpr: 'id::text', softDelete: true },
  appraisal: { table: 'appraisals', idExpr: 'id::text', softDelete: true },
  fire_drill: { table: 'fire_drills', idExpr: 'id::text', softDelete: true },
  ipc_audit: { table: 'ipc_audits', idExpr: 'id::text', softDelete: true },
  maintenance: { table: 'maintenance', idExpr: 'id::text', softDelete: true },
  risk: { table: 'risk_register', idExpr: 'id::text', softDelete: true },
  policy_review: { table: 'policy_reviews', idExpr: 'id::text', softDelete: true },
  whistleblowing: { table: 'whistleblowing_concerns', idExpr: 'id::text', softDelete: true },
  dols: { table: 'dols', idExpr: 'id::text', softDelete: true },
  mca_assessment: { table: 'mca_assessments', idExpr: 'id::text', softDelete: true },
  cqc_evidence: { table: 'cqc_evidence', idExpr: 'id::text', softDelete: true },
  cqc_partner_feedback: { table: 'cqc_partner_feedback', idExpr: 'id::text', softDelete: true },
  cqc_observation: { table: 'cqc_observations', idExpr: 'id::text', softDelete: true },
  handover: { table: 'handover_entries', idExpr: 'id::text' },
  onboarding: { table: 'onboarding', idExpr: 'staff_id', softDelete: true },
  care_certificate: { table: 'care_certificates', idExpr: 'staff_id', softDelete: true },
  hr_disciplinary: { table: 'hr_disciplinary_cases', idExpr: 'id::text', softDelete: true },
  hr_grievance: { table: 'hr_grievance_cases', idExpr: 'id::text', softDelete: true },
  hr_performance: { table: 'hr_performance_cases', idExpr: 'id::text', softDelete: true },
  hr_rtw_interview: { table: 'hr_rtw_interviews', idExpr: 'id::text', softDelete: true },
  hr_oh_referral: { table: 'hr_oh_referrals', idExpr: 'id::text', softDelete: true },
  hr_contract: { table: 'hr_contracts', idExpr: 'id::text', softDelete: true },
  hr_family_leave: { table: 'hr_family_leave', idExpr: 'id::text', softDelete: true },
  hr_flexible_working: { table: 'hr_flexible_working', idExpr: 'id::text', softDelete: true },
  hr_edi: { table: 'hr_edi_records', idExpr: 'id::text', softDelete: true },
  hr_tupe: { table: 'hr_tupe_transfers', idExpr: 'id::text', softDelete: true },
  hr_renewal: { table: 'hr_rtw_dbs_renewals', idExpr: 'id::text', softDelete: true },
};
const HR_SOURCE_MODULES = new Set(SOURCE_MODULES.filter((module) => module.startsWith('hr_')));
const NON_HR_SOURCE_MODULES = SOURCE_MODULES.filter((module) => !HR_SOURCE_MODULES.has(module));

const idSchema = z.coerce.number().int().positive();
const statementIdSchema = z.string().regex(/^(S[1-8]|E[1-6]|C[1-5]|R[1-7]|WL[1-8])$/);
const sourceModuleSchema = z.enum(SOURCE_MODULES);
const evidenceCategorySchema = z.enum(ALLOWED_CQC_EVIDENCE_CATEGORY_VALUES);
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sourceRecordedAtSchema = z.union([dateOnlySchema, z.string().datetime({ offset: true })]);

const listQuerySchema = paginationSchema.extend({
  statement: statementIdSchema.optional(),
  dateFrom: dateOnlySchema.optional(),
  dateTo: dateOnlySchema.optional(),
});

const countsQuerySchema = z.object({
  dateFrom: dateOnlySchema.optional(),
  dateTo: dateOnlySchema.optional(),
});

const createLinkSchema = z.object({
  source_module: sourceModuleSchema,
  source_id: z.string().min(1).max(50),
  quality_statement: statementIdSchema,
  evidence_category: evidenceCategorySchema,
  rationale: z.string().max(2000).nullable().optional(),
  source_recorded_at: sourceRecordedAtSchema.optional(),
});

const bulkCreateSchema = z.object({
  links: z.array(createLinkSchema).min(1).max(50),
});

const updateLinkSchema = z.object({
  rationale: z.string().max(2000).nullable().optional(),
  requires_review: z.boolean().optional(),
  source_recorded_at: sourceRecordedAtSchema.nullable().optional(),
  _version: z.number().int().nonnegative().optional(),
});

const confirmBulkSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
});

async function sourceRecordExists(homeId, sourceModule, sourceId) {
  const source = SOURCE_TABLES[sourceModule];
  if (!source) return false;
  const { rows } = await pool.query(
    `SELECT 1
       FROM ${source.table}
      WHERE home_id = $1
        AND ${source.idExpr} = $2
        ${source.softDelete ? 'AND deleted_at IS NULL' : ''}
      LIMIT 1`,
    [homeId, String(sourceId)]
  );
  return rows.length > 0;
}

function canReadHr(req) {
  return req.user?.is_platform_admin || hasModuleAccess(req.homeRole, 'hr', 'read', { includeOwn: false });
}

function isHrSourceModule(sourceModule) {
  return HR_SOURCE_MODULES.has(sourceModule);
}

function visibleSourceModulesFor(req) {
  return canReadHr(req) ? undefined : NON_HR_SOURCE_MODULES;
}

function enforceHrSourceAccess(req, res, sourceModule) {
  if (isHrSourceModule(sourceModule) && !canReadHr(req)) {
    res.status(403).json({ error: 'HR permission is required for HR evidence links' });
    return false;
  }
  return true;
}

function auditLinkSnapshot(link) {
  if (!link) return null;
  const isHr = isHrSourceModule(link.sourceModule);
  return {
    id: link.id,
    source_module: link.sourceModule,
    source_id: link.sourceId,
    quality_statement: link.qualityStatement,
    evidence_category: link.evidenceCategory,
    requires_review: link.requiresReview,
    source_recorded_at: link.sourceRecordedAt,
    rationale: isHr && link.rationale ? '[REDACTED]' : link.rationale,
    version: link.version,
  };
}

async function validateLinkSources(req, res, links) {
  for (const link of links) {
    if (!enforceHrSourceAccess(req, res, link.source_module)) {
      return false;
    }
    if (!await sourceRecordExists(req.home.id, link.source_module, link.source_id)) {
      res.status(400).json({
        error: `Source record does not exist for this home: ${link.source_module}/${link.source_id}`,
      });
      return false;
    }
  }
  return true;
}

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return zodError(res, parsed);

    const { statement, dateFrom, dateTo, limit, offset } = parsed.data;
    const sourceModules = visibleSourceModulesFor(req);
    const result = statement
      ? await cqcEvidenceLinksRepo.findByStatement(req.home.id, statement, { dateFrom, dateTo, limit, offset, sourceModules })
      : await cqcEvidenceLinksRepo.findByHome(req.home.id, { dateFrom, dateTo, limit, offset, sourceModules });

    res.json({ rows: result.rows, _total: result.total });
  } catch (err) {
    next(err);
  }
});

router.get('/source/:module/:id', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const moduleParsed = sourceModuleSchema.safeParse(req.params.module);
    if (!moduleParsed.success) return res.status(400).json({ error: 'Invalid source module' });
    if (!enforceHrSourceAccess(req, res, moduleParsed.data)) return;
    const sourceId = String(req.params.id || '');
    if (!sourceId) return res.status(400).json({ error: 'Invalid source ID' });

    const rows = await cqcEvidenceLinksRepo.findBySource(req.home.id, moduleParsed.data, sourceId);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/counts', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const parsed = countsQuerySchema.safeParse(req.query);
    if (!parsed.success) return zodError(res, parsed);
    const rows = await cqcEvidenceLinksRepo.countByStatement(req.home.id, {
      ...parsed.data,
      sourceModules: visibleSourceModulesFor(req),
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = createLinkSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    if (!await validateLinkSources(req, res, [parsed.data])) return;

    const saved = await cqcEvidenceLinksRepo.createLink(req.home.id, {
      ...parsed.data,
      auto_linked: false,
      requires_review: false,
      linked_by: req.user.username,
    });

    await auditService.log('cqc_evidence_link_create', req.home.slug, req.user.username, {
      id: saved?.id,
      source_module: saved?.sourceModule,
      source_id: saved?.sourceId,
      quality_statement: saved?.qualityStatement,
      evidence_category: saved?.evidenceCategory,
    });
    res.status(201).json(saved);
  } catch (err) {
    next(err);
  }
});

router.post('/bulk', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = bulkCreateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    if (!await validateLinkSources(req, res, parsed.data.links)) return;

    const saved = await cqcEvidenceLinksRepo.createBulkLinks(
      req.home.id,
      parsed.data.links.map((link) => ({
        ...link,
        auto_linked: false,
        requires_review: false,
        linked_by: req.user.username,
      }))
    );

    await auditService.log('cqc_evidence_link_bulk_create', req.home.slug, req.user.username, {
      count: saved.length,
      source_modules: [...new Set(saved.map((entry) => entry.sourceModule))],
    });
    res.status(201).json({ links: saved });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });

    const parsed = updateLinkSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);

    const existing = await cqcEvidenceLinksRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!enforceHrSourceAccess(req, res, existing.sourceModule)) return;

    const { version, payload } = splitVersion(parsed.data);
    const saved = await cqcEvidenceLinksRepo.updateLink(idParsed.data, req.home.id, payload, version);
    if (saved === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }

    await auditService.log('cqc_evidence_link_update', req.home.slug, req.user.username, {
      id: idParsed.data,
      before: auditLinkSnapshot(existing),
      after: auditLinkSnapshot(saved),
    });
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });

    const existing = await cqcEvidenceLinksRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!enforceHrSourceAccess(req, res, existing.sourceModule)) return;

    await cqcEvidenceLinksRepo.softDelete(idParsed.data, req.home.id);
    await auditService.log('cqc_evidence_link_delete', req.home.slug, req.user.username, {
      id: idParsed.data,
      source_module: existing.sourceModule,
      source_id: existing.sourceId,
      quality_statement: existing.qualityStatement,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/confirm', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });

    const existing = await cqcEvidenceLinksRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!enforceHrSourceAccess(req, res, existing.sourceModule)) return;

    const saved = await cqcEvidenceLinksRepo.confirmAutoLink(idParsed.data, req.home.id, req.user.username);
    await auditService.log('cqc_evidence_link_confirm', req.home.slug, req.user.username, {
      id: idParsed.data,
      source_module: existing.sourceModule,
      source_id: existing.sourceId,
      quality_statement: existing.qualityStatement,
    });
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

router.post('/confirm-bulk', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = confirmBulkSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const existing = await cqcEvidenceLinksRepo.findByIds(req.home.id, parsed.data.ids);
    if (existing.some((link) => isHrSourceModule(link.sourceModule)) && !canReadHr(req)) {
      return res.status(403).json({ error: 'HR permission is required for HR evidence links' });
    }

    const rows = await cqcEvidenceLinksRepo.confirmBulkAutoLinks(req.home.id, parsed.data.ids, req.user.username);
    await auditService.log('cqc_evidence_link_confirm_bulk', req.home.slug, req.user.username, {
      count: rows.length,
      ids: rows.map((row) => row.id),
    });
    res.json({ links: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
