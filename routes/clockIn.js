import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth, requireHomeAccess, requireModule, requireStaffSelf } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import * as clockInService from '../services/clockInService.js';

const router = Router();

const recordClockSchema = z.object({
  clockType: z.enum(['in', 'out']),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracyM: z.number().min(0).max(10000).optional(),
  clientTime: z.string().datetime().optional(),
  note: z.string().max(1000).optional(),
});

const manualClockSchema = z.object({
  staffId: z.string().min(1).max(20),
  clockType: z.enum(['in', 'out']),
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(1000).optional(),
  clientTime: z.string().datetime().optional(),
});

const approveClockSchema = z.object({
  note: z.string().max(1000).optional(),
});

function ensureStaffPortalEnabled(req, res, next) {
  if (!config.enableStaffPortal) {
    return res.status(404).json({ error: 'Staff portal is not enabled' });
  }
  return next();
}

function ensureClockInEnabled(req, res, next) {
  if (!req.home?.config?.clock_in_required) {
    return res.status(403).json({ error: 'Clock-in is not enabled for this home' });
  }
  return next();
}

router.get('/state', readRateLimiter, requireAuth, ensureStaffPortalEnabled, requireHomeAccess, requireStaffSelf, ensureClockInEnabled, async (req, res, next) => {
  try {
    const state = await clockInService.getOwnClockState({ homeId: req.home.id, staffId: req.staffId });
    res.json(state);
  } catch (err) {
    next(err);
  }
});

router.post('/', writeRateLimiter, requireAuth, ensureStaffPortalEnabled, requireHomeAccess, requireStaffSelf, ensureClockInEnabled, async (req, res, next) => {
  try {
    const body = recordClockSchema.parse(req.body || {});
    const result = await clockInService.recordClockIn({ homeId: req.home.id, staffId: req.staffId, payload: body });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/unapproved', readRateLimiter, requireAuth, ensureStaffPortalEnabled, requireHomeAccess, requireModule('payroll', 'read'), async (req, res, next) => {
  try {
    const rows = await clockInService.findUnapproved({ homeId: req.home.id });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/day', readRateLimiter, requireAuth, ensureStaffPortalEnabled, requireHomeAccess, requireModule('payroll', 'read'), async (req, res, next) => {
  try {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query.date);
    const rows = await clockInService.findByDate({ homeId: req.home.id, date });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/manual', writeRateLimiter, requireAuth, ensureStaffPortalEnabled, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const body = manualClockSchema.parse(req.body || {});
    const record = await clockInService.manualClockIn({
      homeId: req.home.id,
      staffId: body.staffId,
      clockType: body.clockType,
      shiftDate: body.shiftDate,
      note: body.note,
      clientTime: body.clientTime,
      actor: req.user.username,
    });
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/approve', writeRateLimiter, requireAuth, ensureStaffPortalEnabled, requireHomeAccess, requireModule('payroll', 'write'), async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const body = approveClockSchema.parse(req.body || {});
    const record = await clockInService.approveClockIn({
      homeId: req.home.id,
      id,
      approvedBy: req.user.username,
      note: body.note,
    });
    res.json(record);
  } catch (err) {
    next(err);
  }
});

export default router;
