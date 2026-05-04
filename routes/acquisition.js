import { Router } from 'express';
import { z } from 'zod';
import { zodError } from '../errors.js';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import { nullableDateInput } from '../lib/zodHelpers.js';
import { definedWithoutVersion, splitVersion } from '../lib/versionedPayload.js';
import {
  ACQUISITION_ITEM_KEYS,
  ACQUISITION_STATUSES,
  createChecklistItem,
  deleteChecklistItem,
  getChecklistItem,
  initializeChecklist,
  listChecklist,
  updateChecklistItem,
} from '../services/acquisitionService.js';

const router = Router();

const idSchema = z.coerce.number().int().positive();
const optionalText = max => z.string().trim().max(max).nullable().optional();
const optionalCount = z.preprocess(
  value => (value === '' || value == null ? undefined : value),
  z.coerce.number().int().min(0).max(1000000).optional()
);
const statusSchema = z.enum(ACQUISITION_STATUSES);

const listSchema = z.object({
  status: z.enum(ACQUISITION_STATUSES).optional(),
  item_key: z.enum(ACQUISITION_ITEM_KEYS).optional(),
});

const itemBodySchema = z.object({
  item_key: z.enum(ACQUISITION_ITEM_KEYS),
  title: z.string().trim().min(1).max(200).optional(),
  description: optionalText(1000),
  status: statusSchema.default('not_started'),
  owner_name: optionalText(200),
  due_date: nullableDateInput.optional(),
  expected_count: optionalCount,
  imported_count: optionalCount,
  issue_count: optionalCount,
  evidence_ref: optionalText(500),
  notes: optionalText(5000),
  blockers: optionalText(5000),
});

const itemUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: optionalText(1000),
  status: statusSchema.optional(),
  owner_name: optionalText(200),
  due_date: nullableDateInput.optional(),
  expected_count: optionalCount,
  imported_count: optionalCount,
  issue_count: optionalCount,
  evidence_ref: optionalText(500),
  notes: optionalText(5000),
  blockers: optionalText(5000),
  _version: z.coerce.number().int().nonnegative().optional(),
});

const versionOnlySchema = z.object({
  _version: z.coerce.number().int().nonnegative().optional(),
});

function actorFromReq(req) {
  return {
    id: req.authDbUser?.id || null,
    username: req.user?.username || 'system',
  };
}

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'read'), async (req, res, next) => {
  try {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) return zodError(res, parsed);
    const result = await listChecklist(req.home, parsed.data);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:id', readRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'read'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid checklist item ID' });
    const item = await getChecklistItem(req.home, idParsed.data);
    res.json(item);
  } catch (err) { next(err); }
});

router.post('/initialize', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const result = await initializeChecklist(req.home, actorFromReq(req));
    res.status(result.inserted.length > 0 ? 201 : 200).json(result);
  } catch (err) { next(err); }
});

router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const parsed = itemBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const item = await createChecklistItem(req.home, parsed.data, actorFromReq(req));
    res.status(201).json(item);
  } catch (err) { next(err); }
});

router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid checklist item ID' });
    const parsed = itemUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const { version } = splitVersion(parsed.data);
    const updates = definedWithoutVersion(parsed.data);
    const item = await updateChecklistItem(req.home, idParsed.data, updates, version, actorFromReq(req));
    res.json(item);
  } catch (err) { next(err); }
});

router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid checklist item ID' });
    const parsed = versionOnlySchema.safeParse(req.body || {});
    if (!parsed.success) return zodError(res, parsed);
    const { version } = splitVersion(parsed.data);
    await deleteChecklistItem(req.home, idParsed.data, version, actorFromReq(req));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
