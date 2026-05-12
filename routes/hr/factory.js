import { requireAuth, requireHomeAccess, requireModule } from '../../middleware/auth.js';
import * as hrRepo from '../../repositories/hrRepo.js';
import * as cqcEvidenceLinksRepo from '../../repositories/cqcEvidenceLinksRepo.js';
import * as auditService from '../../services/auditService.js';
import { diffFields } from '../../lib/hrFieldMappers.js';
import { zodError } from '../../errors.js';
import { z } from 'zod';
import { idSchema } from './schemas.js';
import { splitVersion } from '../../lib/versionedPayload.js';
import { withTransaction } from '../../db.js';
import { readRateLimiter, writeRateLimiter } from '../../lib/rateLimiter.js';

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ── Case Route Factory ──────────────────────────────────────────────────────

export function registerCaseRoutes(router, {
  type,
  path,
  bodySchema,
  updateSchema,
  mapFields,
  filters,
  hasGetById = true,
  repoFind,
  repoFindById,
  repoCreate,
  repoUpdate,
  auditPrefix,
  table,
  auditSensitiveFields = [],
  cqcSourceModule = null,
  beforeDelete = null,
}) {
  const prefix = auditPrefix || type;

  // GET list
  router.get(path, readRateLimiter, requireAuth, requireHomeAccess, requireModule('hr', 'read'), async (req, res, next) => {
    try {
      const f = {};
      for (const [queryParam, filterKey] of Object.entries(filters || {})) {
        if (req.query[queryParam]) f[filterKey] = req.query[queryParam];
      }
      const pagParsed = paginationSchema.safeParse(req.query);
      const pag = pagParsed.success ? pagParsed.data : {};
      const result = await repoFind(req.home.id, f, null, pag);
      res.json(result);
    } catch (err) { next(err); }
  });

  // POST create
  router.post(path, writeRateLimiter, requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
    try {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return zodError(res, parsed);
      const mapped = mapFields ? mapFields(parsed.data, null) : parsed.data;
      const result = await withTransaction(async (client) => {
        const created = await repoCreate(req.home.id, { ...mapped, created_by: req.user.username }, client);
        await auditService.log(`hr_${prefix}_create`, req.home.slug, req.user.username, { id: created.id }, client);
        return created;
      });
      res.status(201).json(result);
    } catch (err) { next(err); }
  });

  // GET by ID
  if (hasGetById) {
    router.get(`${path}/:id`, readRateLimiter, requireAuth, requireHomeAccess, requireModule('hr', 'read'), async (req, res, next) => {
      try {
        const parsed = idSchema.safeParse(req.params.id);
        if (!parsed.success) return res.status(400).json({ error: 'Invalid case ID' });
        const row = await repoFindById(parsed.data, req.home.id);
        if (!row) return res.status(404).json({ error: `${type} case not found` });
        res.json(row);
      } catch (err) { next(err); }
    });
  }

  // PUT update — with optimistic locking + field-diff audit
  router.put(`${path}/:id`, writeRateLimiter, requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
    try {
      const idParsed = idSchema.safeParse(req.params.id);
      if (!idParsed.success) return res.status(400).json({ error: 'Invalid case ID' });
      const versionedSchema = updateSchema.extend({ _version: z.number().int().nonnegative() });
      const parsed = versionedSchema.safeParse(req.body);
      if (!parsed.success) return zodError(res, parsed);

      const { version, payload } = splitVersion(parsed.data);
      const outcome = await withTransaction(async (client) => {
        const existing = repoFindById ? await repoFindById(idParsed.data, req.home.id, client) : null;
        if (repoFindById && !existing) return { status: 'not_found' };

        const mapped = mapFields ? mapFields(payload, existing) : payload;
        const result = await repoUpdate(idParsed.data, req.home.id, mapped, client, version);
        if (result === null) return { status: 'conflict' };

        const changes = existing
          ? diffFields(existing, result, auditSensitiveFields.length ? { extraSensitive: auditSensitiveFields } : undefined)
          : [];
        await auditService.log(`hr_${prefix}_update`, req.home.slug, req.user.username, { id: result.id, changes }, client);
        return { status: 'ok', result };
      });
      if (outcome.status === 'not_found') return res.status(404).json({ error: `${type} case not found` });
      if (outcome.status === 'conflict') return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
      const { result } = outcome;
      res.json(result);
    } catch (err) { next(err); }
  });

  // DELETE soft-delete
  if (table) {
    router.delete(`${path}/:id`, writeRateLimiter, requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
      try {
        const idParsed = idSchema.safeParse(req.params.id);
        if (!idParsed.success) return res.status(400).json({ error: 'Invalid case ID' });
        const parsed = z.object({ _version: z.number().int().nonnegative() }).safeParse(req.body || {});
        if (!parsed.success) return res.status(400).json({ error: '_version is required' });
        const outcome = await withTransaction(async (client) => {
          const existing = repoFindById ? await repoFindById(idParsed.data, req.home.id, client) : null;
          if (repoFindById && !existing) return { status: 'not_found' };
          const deleted = await hrRepo.softDeleteCase(table, idParsed.data, req.home.id, client, parsed.data._version);
          if (!deleted) return { status: 'conflict' };
          if (beforeDelete) {
            await beforeDelete({ req, id: idParsed.data, existing: deleted || existing, client });
          }
          const retiredCqcLinks = cqcSourceModule
            ? await cqcEvidenceLinksRepo.softDeleteBySource(req.home.id, cqcSourceModule, idParsed.data, client)
            : [];
          await auditService.log(`hr_${prefix}_delete`, req.home.slug, req.user.username, { id: idParsed.data }, client);
          if (retiredCqcLinks.length > 0) {
            await auditService.log('hr_cqc_links_retired', req.home.slug, req.user.username, {
              source_module: cqcSourceModule,
              source_id: String(idParsed.data),
              link_ids: retiredCqcLinks,
            }, client);
          }
          return { status: 'deleted' };
        });
        if (outcome.status === 'not_found') return res.status(404).json({ error: `${type} case not found` });
        if (outcome.status === 'conflict') return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
        res.status(204).end();
      } catch (err) { next(err); }
    });
  }
}
