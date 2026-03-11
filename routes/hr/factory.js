import { requireAuth, requireAdmin, requireHomeAccess } from '../../middleware/auth.js';
import * as hrRepo from '../../repositories/hrRepo.js';
import * as auditService from '../../services/auditService.js';
import { diffFields } from '../../lib/hrFieldMappers.js';
import { zodError } from '../../errors.js';
import { z } from 'zod';
import { idSchema } from './schemas.js';

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ── Case Route Factory ──────────────────────────────────────────────────────

export function registerCaseRoutes(router, { type, path, bodySchema, updateSchema, mapFields, filters, hasGetById = true, repoFind, repoFindById, repoCreate, repoUpdate, auditPrefix, table }) {
  const prefix = auditPrefix || type;

  // GET list
  router.get(path, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
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
  router.post(path, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
    try {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return zodError(res, parsed);
      const mapped = mapFields ? mapFields(parsed.data) : parsed.data;
      const result = await repoCreate(req.home.id, { ...mapped, created_by: req.user.username });
      await auditService.log(`hr_${prefix}_create`, req.home.slug, req.user.username, { id: result.id });
      res.status(201).json(result);
    } catch (err) { next(err); }
  });

  // GET by ID
  if (hasGetById) {
    router.get(`${path}/:id`, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
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
  router.put(`${path}/:id`, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
    try {
      const idParsed = idSchema.safeParse(req.params.id);
      if (!idParsed.success) return res.status(400).json({ error: 'Invalid case ID' });
      const versionedSchema = updateSchema.extend({ _version: z.number().int().nonnegative().optional() });
      const parsed = versionedSchema.safeParse(req.body);
      if (!parsed.success) return zodError(res, parsed);

      const version = parsed.data._version != null ? parsed.data._version : null;
      const existing = repoFindById ? await repoFindById(idParsed.data, req.home.id) : null;
      if (repoFindById && !existing) return res.status(404).json({ error: `${type} case not found` });

      const mapped = mapFields ? mapFields(parsed.data) : parsed.data;
      const result = await repoUpdate(idParsed.data, req.home.id, mapped, null, version);
      if (result === null) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });

      const changes = existing ? diffFields(existing, result) : [];
      await auditService.log(`hr_${prefix}_update`, req.home.slug, req.user.username, { id: result.id, changes });
      res.json(result);
    } catch (err) { next(err); }
  });

  // DELETE soft-delete
  if (table) {
    router.delete(`${path}/:id`, requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
      try {
        const idParsed = idSchema.safeParse(req.params.id);
        if (!idParsed.success) return res.status(400).json({ error: 'Invalid case ID' });
        const deleted = await hrRepo.softDeleteCase(table, idParsed.data, req.home.id);
        if (!deleted) return res.status(404).json({ error: `${type} case not found` });
        await auditService.log(`hr_${prefix}_delete`, req.home.slug, req.user.username, { id: idParsed.data });
        res.status(204).end();
      } catch (err) { next(err); }
    });
  }
}
