import { Router } from 'express';
import { z } from 'zod';
import { zodError } from '../errors.js';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js';
import { readRateLimiter, writeRateLimiter } from '../lib/rateLimiter.js';
import { paginationSchema } from '../lib/pagination.js';
import { nullableDateInput } from '../lib/zodHelpers.js';
import {
  ACCESS_REVIEW_ASSIGNMENT_STATUSES,
  ACCESS_REVIEW_CADENCES,
  ACCESS_REVIEW_STATUSES,
  completeAccessReview,
  getAccessReview,
  listAccessReviews,
  startAccessReview,
  updateAccessReviewAssignment,
} from '../services/accessReviewService.js';

const router = Router();

const cadenceSchema = z.enum(ACCESS_REVIEW_CADENCES);
const reviewStatusSchema = z.enum(ACCESS_REVIEW_STATUSES);
const assignmentStatusSchema = z.enum(ACCESS_REVIEW_ASSIGNMENT_STATUSES);
const booleanQuerySchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === true || value === false) return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
}, z.boolean().optional());

const listQuerySchema = paginationSchema.extend({
  status: reviewStatusSchema.optional(),
  cadence: cadenceSchema.optional(),
});

const detailQuerySchema = paginationSchema.extend({
  status: assignmentStatusSchema.optional(),
  exception_only: booleanQuerySchema,
});

const startBodySchema = z.object({
  cadence: cadenceSchema.default('quarterly'),
  period_start: nullableDateInput.optional(),
  period_end: nullableDateInput.optional(),
}).refine(data => (data.period_start && data.period_end) || (!data.period_start && !data.period_end), {
  message: 'Provide both period_start and period_end, or neither',
  path: ['period_start'],
});

const updateAssignmentSchema = z.object({
  status: assignmentStatusSchema,
  notes: z.string().max(2000).optional().default(''),
});

function actor(req) {
  return {
    username: req.user.username,
    isPlatformAdmin: req.authDbUser?.is_platform_admin === true,
  };
}

router.get('/', readRateLimiter, requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return zodError(res, parsed);
    const result = await listAccessReviews({ actor: actor(req), filters: parsed.data });
    return res.json(result);
  } catch (err) { return next(err); }
});

router.post('/', writeRateLimiter, requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const parsed = startBodySchema.safeParse(req.body || {});
    if (!parsed.success) return zodError(res, parsed);
    const result = await startAccessReview({
      actor: actor(req),
      cadence: parsed.data.cadence,
      periodStart: parsed.data.period_start || undefined,
      periodEnd: parsed.data.period_end || undefined,
    });
    return res.status(201).json(result);
  } catch (err) { return next(err); }
});

router.get('/:id', readRateLimiter, requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const parsed = detailQuerySchema.safeParse(req.query);
    if (!parsed.success) return zodError(res, parsed);
    const result = await getAccessReview({
      actor: actor(req),
      reviewId: Number(req.params.id),
      filters: {
        ...parsed.data,
        exceptionOnly: parsed.data.exception_only === true,
      },
    });
    return res.json(result);
  } catch (err) { return next(err); }
});

router.patch('/:id/assignments/:assignmentId', writeRateLimiter, requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const parsed = updateAssignmentSchema.safeParse(req.body || {});
    if (!parsed.success) return zodError(res, parsed);
    const result = await updateAccessReviewAssignment({
      actor: actor(req),
      reviewId: Number(req.params.id),
      assignmentId: Number(req.params.assignmentId),
      status: parsed.data.status,
      notes: parsed.data.notes,
    });
    return res.json(result);
  } catch (err) { return next(err); }
});

router.post('/:id/complete', writeRateLimiter, requireAuth, requirePlatformAdmin, async (req, res, next) => {
  try {
    const result = await completeAccessReview({
      actor: actor(req),
      reviewId: Number(req.params.id),
    });
    return res.json(result);
  } catch (err) { return next(err); }
});

export default router;
