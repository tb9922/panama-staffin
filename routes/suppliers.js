import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import * as supplierService from '../services/supplierService.js';
import * as auditService from '../services/auditService.js';

const router = Router();

const idSchema = z.coerce.number().int().positive();
const listQuerySchema = z.object({
  q: z.string().max(200).optional(),
  activeOnly: z.coerce.boolean().optional(),
});
const bodySchema = z.object({
  name: z.string().min(1).max(200),
  vat_number: z.string().max(32).nullable().optional(),
  default_category: z.string().max(50).nullable().optional(),
  aliases: z.array(z.string().max(200)).optional(),
  active: z.boolean().optional(),
});
const updateSchema = bodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});
const mergeSchema = z.object({
  sourceId: z.coerce.number().int().positive(),
  targetId: z.coerce.number().int().positive(),
});

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('finance', 'read'), async (req, res, next) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query' });
    const rows = await supplierService.listSuppliers(req.home.id, parsed.data);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('finance', 'write'), async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid supplier payload' });
    const supplier = await supplierService.createSupplier(req.home.id, parsed.data, req.user.username);
    await auditService.log('supplier_create', req.home.slug, req.user.username, { supplierId: supplier.id });
    res.status(201).json(supplier);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('finance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid supplier ID' });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid supplier payload' });
    const supplier = await supplierService.updateSupplier(
      idParsed.data,
      req.home.id,
      parsed.data,
      parsed.data._version ?? null
    );
    if (supplier === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    await auditService.log('supplier_update', req.home.slug, req.user.username, { supplierId: idParsed.data });
    res.json(supplier);
  } catch (err) {
    next(err);
  }
});

router.post('/merge', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('finance', 'write'), async (req, res, next) => {
  try {
    const parsed = mergeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid merge payload' });
    const result = await supplierService.mergeSuppliers(req.home.id, parsed.data.sourceId, parsed.data.targetId, req.user.username);
    await auditService.log('supplier_merge', req.home.slug, req.user.username, {
      sourceId: parsed.data.sourceId,
      targetId: parsed.data.targetId,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('finance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid supplier ID' });
    const supplier = await supplierService.updateSupplier(idParsed.data, req.home.id, { active: false }, null);
    if (supplier === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    await auditService.log('supplier_deactivate', req.home.slug, req.user.username, { supplierId: idParsed.data });
    res.json({ ok: true, supplier });
  } catch (err) {
    next(err);
  }
});

export default router;
