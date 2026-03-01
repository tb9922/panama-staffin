import { zodError } from '../errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requireHomeAccess } from '../middleware/auth.js';
import { writeRateLimiter } from '../lib/rateLimiter.js';
import * as bedService from '../services/bedService.js';
import { STATUSES, ROOM_TYPES } from '../lib/beds.js';

const router = Router();
router.use(writeRateLimiter);

const idSchema = z.coerce.number().int().positive();
const dateSchema = z.preprocess(v => v === '' ? null : v, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

const statusValues = Object.values(STATUSES);
const roomTypeValues = Object.values(ROOM_TYPES);

// ── Zod schemas ─────────────────────────────────────────────────────────────

const createBedSchema = z.object({
  room_number: z.string().min(1).max(20),
  room_name:   z.string().max(50).nullable().optional(),
  room_type:   z.enum(roomTypeValues).optional(),
  floor:       z.string().max(20).nullable().optional(),
  notes:       z.string().max(2000).nullable().optional(),
});

const setupBedSchema = createBedSchema.extend({
  status:      z.enum(statusValues).optional(),
  resident_id: z.number().int().positive().optional(),
});

const setupBedsSchema = z.array(setupBedSchema).min(1).max(200);

const transitionSchema = z.object({
  status:          z.enum(statusValues),
  residentId:      z.number().int().positive().optional(),
  holdExpires:     dateSchema.optional(),
  reservedUntil:   dateSchema.optional(),
  bookedFrom:      dateSchema.optional(),
  bookedUntil:     dateSchema.optional(),
  reason:          z.string().max(500).optional(),
  releaseReason:   z.string().optional(),
  skipReservation: z.boolean().optional(),
  notes:           z.string().max(2000).optional(),
  clientUpdatedAt: z.string(),
});

const revertSchema = z.object({
  reason: z.string().min(1).max(500),
});

const moveSchema = z.object({
  fromBedId: z.number().int().positive(),
  toBedId:   z.number().int().positive(),
});

// ── Read endpoints ──────────────────────────────────────────────────────────
// Viewers can see bed status — needed for care delivery decisions.

// GET /api/beds/summary?home=slug — occupancy summary
// MUST be defined before /:bedId to avoid "summary" matching as a bedId
router.get('/summary', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const summary = await bedService.getOccupancySummary(req.home.id);
    res.json(summary);
  } catch (err) { next(err); }
});

// GET /api/beds?home=slug — list all beds for home
router.get('/', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const beds = await bedService.getBeds(req.home.id);
    res.json({ beds });
  } catch (err) { next(err); }
});

// GET /api/beds/:bedId?home=slug — single bed detail
router.get('/:bedId', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = idSchema.safeParse(req.params.bedId);
    if (!parsed.success) return zodError(res, parsed);
    const bed = await bedService.getBed(parsed.data, req.home.id);
    res.json(bed);
  } catch (err) { next(err); }
});

// GET /api/beds/:bedId/history?home=slug — transition history
router.get('/:bedId/history', requireAuth, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = idSchema.safeParse(req.params.bedId);
    if (!parsed.success) return zodError(res, parsed);
    const transitions = await bedService.getBedHistory(parsed.data, req.home.id);
    res.json({ transitions });
  } catch (err) { next(err); }
});

// ── Write endpoints ─────────────────────────────────────────────────────────
// Admin only — all mutations require requireAdmin.

// POST /api/beds/setup?home=slug — bulk create beds
// MUST be defined before /:bedId to avoid "setup" matching as a bedId
router.post('/setup', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = setupBedsSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const result = await bedService.setupBeds(req.home.id, req.home.slug, parsed.data, req.user.username);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// POST /api/beds?home=slug — create single bed
router.post('/', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = createBedSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const bed = await bedService.createBed(req.home.id, req.home.slug, parsed.data, req.user.username);
    res.status(201).json(bed);
  } catch (err) { next(err); }
});

// PUT /api/beds/move?home=slug — move resident between beds
// MUST be defined before /:bedId to avoid "move" matching as a bedId
router.put('/move', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const result = await bedService.moveBed(parsed.data.fromBedId, parsed.data.toBedId, req.home.id, req.home.slug, req.user.username);
    res.json(result);
  } catch (err) { next(err); }
});

// PUT /api/beds/:bedId/status?home=slug — transition bed status
router.put('/:bedId/status', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.bedId);
    if (!idParsed.success) return zodError(res, idParsed);
    const parsed = transitionSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const bed = await bedService.transitionStatus(
      idParsed.data,
      req.home.id,
      req.home.slug,
      { ...parsed.data, username: req.user.username },
    );
    res.json(bed);
  } catch (err) { next(err); }
});

// PUT /api/beds/:bedId/revert?home=slug — revert last transition
router.put('/:bedId/revert', requireAuth, requireAdmin, requireHomeAccess, async (req, res, next) => {
  try {
    const idParsed = idSchema.safeParse(req.params.bedId);
    if (!idParsed.success) return zodError(res, idParsed);
    const parsed = revertSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    const bed = await bedService.revertTransition(
      idParsed.data,
      req.home.id,
      req.home.slug,
      req.user.username,
      parsed.data.reason,
    );
    res.json(bed);
  } catch (err) { next(err); }
});

export default router;
