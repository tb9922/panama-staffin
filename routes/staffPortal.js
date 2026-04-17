import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth, requireHomeAccess, requireStaffSelf } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import * as overrideRequestService from '../services/overrideRequestService.js';
import * as staffPortalService from '../services/staffPortalService.js';
import * as clockInService from '../services/clockInService.js';

const router = Router();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const scheduleQuerySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

const accrualQuerySchema = z.object({
  asOfDate: dateSchema.optional(),
});

const leaveRequestSchema = z.object({
  date: dateSchema,
  reason: z.string().max(1000).optional().default(''),
});

const cancelRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});

const profilePatchSchema = z.object({
  phone: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  emergency_contact: z.string().max(200).optional(),
});

const reportSickSchema = z.object({
  date: dateSchema,
  reason: z.string().max(1000).optional().default(''),
});

function ensureStaffPortalEnabled(req, res, next) {
  if (!config.enableStaffPortal) {
    return res.status(404).json({ error: 'Staff portal is not enabled' });
  }
  return next();
}

function defaultWindow() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 27);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

const staffReadChain = [readRateLimiter, requireAuth, ensureStaffPortalEnabled, requireHomeAccess, requireStaffSelf];
const staffWriteChain = [writeRateLimiter, requireAuth, ensureStaffPortalEnabled, requireHomeAccess, requireStaffSelf];

router.get('/dashboard', ...staffReadChain, async (req, res, next) => {
  try {
    const { from, to } = defaultWindow();
    const asOfDate = new Date().toISOString().slice(0, 10);
    const [schedule, accrual, training, payslips, requests, profile, clockState] = await Promise.all([
      staffPortalService.getStaffScheduleWindow({ homeId: req.home.id, staffId: req.staffId, from, to }),
      staffPortalService.getStaffAccrualSummary({ homeId: req.home.id, staffId: req.staffId, asOfDate }),
      staffPortalService.getStaffTrainingStatus({ homeId: req.home.id, staffId: req.staffId }),
      staffPortalService.getStaffPayslipRuns({ homeId: req.home.id, staffId: req.staffId }),
      overrideRequestService.findByStaff({ homeId: req.home.id, staffId: req.staffId }),
      staffPortalService.getOwnProfile({ homeId: req.home.id, staffId: req.staffId }),
      req.home.config?.clock_in_required
        ? clockInService.getOwnClockState({ homeId: req.home.id, staffId: req.staffId })
        : Promise.resolve(null),
    ]);
    res.json({ schedule, accrual, training, payslips, requests, profile, clockState });
  } catch (err) {
    next(err);
  }
});

router.get('/schedule', ...staffReadChain, async (req, res, next) => {
  try {
    const parsed = scheduleQuerySchema.parse(req.query || {});
    const range = defaultWindow();
    const data = await staffPortalService.getStaffScheduleWindow({
      homeId: req.home.id,
      staffId: req.staffId,
      from: parsed.from || range.from,
      to: parsed.to || range.to,
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/accrual', ...staffReadChain, async (req, res, next) => {
  try {
    const parsed = accrualQuerySchema.parse(req.query || {});
    const summary = await staffPortalService.getStaffAccrualSummary({
      homeId: req.home.id,
      staffId: req.staffId,
      asOfDate: parsed.asOfDate || new Date().toISOString().slice(0, 10),
    });
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

router.get('/requests', ...staffReadChain, async (req, res, next) => {
  try {
    const rows = await overrideRequestService.findByStaff({ homeId: req.home.id, staffId: req.staffId });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/leave-requests', ...staffWriteChain, async (req, res, next) => {
  try {
    const body = leaveRequestSchema.parse(req.body || {});
    const created = await overrideRequestService.submitALRequest({
      homeId: req.home.id,
      staffId: req.staffId,
      date: body.date,
      reason: body.reason,
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.post('/requests/:id/cancel', ...staffWriteChain, async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const body = cancelRequestSchema.parse(req.body || {});
    const updated = await overrideRequestService.cancelByStaff({
      homeId: req.home.id,
      staffId: req.staffId,
      id,
      expectedVersion: body.expectedVersion,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.get('/payslips', ...staffReadChain, async (req, res, next) => {
  try {
    const rows = await staffPortalService.getStaffPayslipRuns({ homeId: req.home.id, staffId: req.staffId });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/training', ...staffReadChain, async (req, res, next) => {
  try {
    const data = await staffPortalService.getStaffTrainingStatus({ homeId: req.home.id, staffId: req.staffId });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/training/:typeId/acknowledge', ...staffWriteChain, async (req, res, next) => {
  try {
    const typeId = z.string().min(1).max(100).parse(req.params.typeId);
    const result = await staffPortalService.acknowledgeTrainingByStaff({
      homeId: req.home.id,
      staffId: req.staffId,
      typeId,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/profile', ...staffReadChain, async (req, res, next) => {
  try {
    const profile = await staffPortalService.getOwnProfile({ homeId: req.home.id, staffId: req.staffId });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

router.patch('/profile', ...staffWriteChain, async (req, res, next) => {
  try {
    const patch = profilePatchSchema.parse(req.body || {});
    const profile = await staffPortalService.updateOwnProfile({
      homeId: req.home.id,
      staffId: req.staffId,
      patch,
      actorUsername: req.user.username,
    });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

router.post('/report-sick', ...staffWriteChain, async (req, res, next) => {
  try {
    const body = reportSickSchema.parse(req.body || {});
    const result = await staffPortalService.reportSick({
      homeId: req.home.id,
      staffId: req.staffId,
      date: body.date,
      reason: body.reason,
      actorUsername: req.user.username,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
