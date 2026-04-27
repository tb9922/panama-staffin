import { Router } from 'express';
import { z } from 'zod';
import { zodError } from '../errors.js';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';
import { nullableDateInput } from '../lib/zodHelpers.js';
import { definedWithoutVersion, splitVersion } from '../lib/versionedPayload.js';
import { diffFields } from '../lib/audit.js';
import {
  ACTION_ITEM_CATEGORIES,
  ACTION_ITEM_PRIORITIES,
  ACTION_ITEM_SOURCE_TYPES,
  ACTION_ITEM_STATUSES,
  calculateEscalationLevel,
} from '../lib/actionItems.js';
import * as actionItemRepo from '../repositories/actionItemRepo.js';
import * as userRepo from '../repositories/userRepo.js';
import * as auditService from '../services/auditService.js';

const router = Router();

const idSchema = z.coerce.number().int().positive();
const optionalText = max => z.string().max(max).nullable().optional();
const dateSchema = nullableDateInput.refine(Boolean, 'Due date is required');

const actionItemBodySchema = z.object({
  source_type: z.enum(ACTION_ITEM_SOURCE_TYPES).default('standalone'),
  source_id: optionalText(200),
  source_action_key: optionalText(300),
  title: z.string().trim().min(1).max(300),
  description: optionalText(5000),
  category: z.enum(ACTION_ITEM_CATEGORIES).default('operational'),
  priority: z.enum(ACTION_ITEM_PRIORITIES).default('medium'),
  owner_user_id: z.coerce.number().int().positive().nullable().optional(),
  owner_name: optionalText(200),
  owner_role: optionalText(100),
  due_date: dateSchema,
  status: z.enum(ACTION_ITEM_STATUSES).default('open'),
  evidence_required: z.coerce.boolean().default(false),
  evidence_notes: optionalText(5000),
});

const actionItemUpdateSchema = actionItemBodySchema.partial().extend({
  _version: z.number().int().nonnegative().optional(),
});

const completeSchema = z.object({
  _version: z.number().int().nonnegative().optional(),
  evidence_notes: optionalText(5000),
});

const listFilterSchema = paginationSchema.extend({
  status: z.enum(ACTION_ITEM_STATUSES).optional(),
  source_type: z.enum(ACTION_ITEM_SOURCE_TYPES).optional(),
  priority: z.enum(ACTION_ITEM_PRIORITIES).optional(),
  category: z.enum(ACTION_ITEM_CATEGORIES).optional(),
  owner_user_id: z.coerce.number().int().positive().optional(),
  overdue: z.enum(['true', 'false']).optional(),
});

function actorId(req) {
  return req.authDbUser?.id || null;
}

async function validateOwner(homeId, ownerUserId) {
  if (ownerUserId == null) return null;
  const owner = await userRepo.findByIdAtHome(ownerUserId, homeId);
  return owner?.active ? owner : null;
}

async function parseOwnerOrReject(req, res, ownerUserId) {
  if (ownerUserId == null) return true;
  const owner = await validateOwner(req.home.id, ownerUserId);
  if (!owner) {
    res.status(400).json({ error: 'Owner user must be active and assigned to this home' });
    return false;
  }
  return true;
}

function withEscalation(data) {
  const escalationLevel = calculateEscalationLevel({
    dueDate: data.due_date,
    status: data.status,
    priority: data.priority,
  });
  return {
    ...data,
    escalation_level: escalationLevel,
  };
}

router.get('/', readRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'read'), async (req, res, next) => {
  try {
    const parsed = listFilterSchema.safeParse(req.query);
    if (!parsed.success) return zodError(res, parsed);
    const filters = {
      ...parsed.data,
      overdue: parsed.data.overdue === 'true',
    };
    const result = await actionItemRepo.findByHome(req.home.id, filters);
    res.json({ actionItems: result.rows, _total: result.total });
  } catch (err) { next(err); }
});

router.get('/:id', readRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'read'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const item = await actionItemRepo.findById(idParsed.data, req.home.id);
    if (!item) return res.status(404).json({ error: 'Action item not found' });
    res.json(item);
  } catch (err) { next(err); }
});

router.post('/', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const parsed = actionItemBodySchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    if (!await parseOwnerOrReject(req, res, parsed.data.owner_user_id)) return;

    const item = await actionItemRepo.create(req.home.id, {
      ...withEscalation(parsed.data),
      created_by: actorId(req),
      updated_by: actorId(req),
    });
    await auditService.log('action_item_create', req.home.slug, req.user.username, { id: item.id, sourceType: item.source_type });
    res.status(201).json(item);
  } catch (err) { next(err); }
});

router.put('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = actionItemUpdateSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    if (!await parseOwnerOrReject(req, res, parsed.data.owner_user_id)) return;

    const existing = await actionItemRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Action item not found' });

    const { version } = splitVersion(parsed.data);
    let updates = definedWithoutVersion(parsed.data);
    if (updates.due_date || updates.status || updates.priority) {
      updates = withEscalation({
        ...existing,
        ...updates,
      });
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });

    const item = await actionItemRepo.update(idParsed.data, req.home.id, updates, version, actorId(req));
    if (item === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    const changes = diffFields(existing, item, { extraSensitive: ['description', 'evidence_notes'] });
    await auditService.log('action_item_update', req.home.slug, req.user.username, { id: item.id, changes });
    res.json(item);
  } catch (err) { next(err); }
});

router.post('/:id/complete', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);

    const existing = await actionItemRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Action item not found' });
    if (['verified', 'cancelled'].includes(existing.status)) {
      return res.status(400).json({ error: 'Verified or cancelled actions cannot be completed' });
    }

    const { version } = splitVersion(parsed.data);
    const item = await actionItemRepo.complete(
      idParsed.data,
      req.home.id,
      actorId(req),
      version,
      parsed.data.evidence_notes,
    );
    if (item === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    await auditService.log('action_item_complete', req.home.slug, req.user.username, { id: item.id });
    res.json(item);
  } catch (err) { next(err); }
});

router.post('/:id/verify', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const parsed = completeSchema.pick({ _version: true }).safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);

    const existing = await actionItemRepo.findById(idParsed.data, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Action item not found' });
    if (existing.status !== 'completed') {
      return res.status(400).json({ error: 'Only completed actions can be verified' });
    }

    const { version } = splitVersion(parsed.data);
    const item = await actionItemRepo.verify(idParsed.data, req.home.id, actorId(req), version);
    if (item === null) {
      return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    }
    await auditService.log('action_item_verify', req.home.slug, req.user.username, { id: item.id });
    res.json(item);
  } catch (err) { next(err); }
});

router.delete('/:id', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('governance', 'write'), async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.id);
    if (!idParsed.success) return res.status(400).json({ error: 'Invalid ID' });
    const deleted = await actionItemRepo.softDelete(idParsed.data, req.home.id, actorId(req));
    if (!deleted) return res.status(404).json({ error: 'Action item not found' });
    await auditService.log('action_item_delete', req.home.slug, req.user.username, { id: idParsed.data });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
