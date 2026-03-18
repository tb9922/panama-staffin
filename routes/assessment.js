import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { requireAuth, requireHomeAccess, requireModule } from '../middleware/auth.js';
import { writeRateLimiter, readRateLimiter } from '../lib/rateLimiter.js';
import * as assessmentRepo from '../repositories/assessmentRepo.js';
import * as assessmentService from '../services/assessmentService.js';
import * as auditService from '../services/auditService.js';
import { zodError } from '../errors.js';

const router = Router();

const createSchema = z.object({
  engine: z.enum(['cqc', 'gdpr']),
  window_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  window_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const signOffSchema = z.object({
  notes: z.string().max(2000).optional(),
});

// POST /api/assessment/snapshot?home=X — server-authoritative: compute + persist a snapshot
router.post('/snapshot', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);

    // Server computes the score — client no longer sends overall_score, band, or result
    const computed = await assessmentService.computeSnapshot(
      req.home.id, parsed.data.engine, parsed.data.window_from, parsed.data.window_to
    );
    if (!computed) return res.status(500).json({ error: 'Failed to compute snapshot' });

    // Compute input_hash for deduplication — includes window dates so different periods aren't deduped
    const hashInput = JSON.stringify({ engine: parsed.data.engine, window_from: parsed.data.window_from || null, window_to: parsed.data.window_to || null, result: computed.result });
    const input_hash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 64);

    const snapshot = await assessmentRepo.create(req.home.id, {
      engine: parsed.data.engine,
      engine_version: computed.engine_version,
      window_from: parsed.data.window_from,
      window_to: parsed.data.window_to,
      overall_score: computed.overall_score,
      band: computed.band,
      result: computed.result,
      computed_by: req.user.username,
      input_hash,
    });
    await auditService.log('assessment_snapshot', req.home.slug, req.user.username, `engine=${parsed.data.engine} score=${computed.overall_score}`);
    res.status(201).json(snapshot);
  } catch (err) {
    // Unique constraint on (home_id, engine, input_hash) — duplicate snapshot
    if (err.code === '23505' && err.constraint?.includes('dedup')) {
      return res.status(409).json({ error: 'An identical snapshot already exists' });
    }
    next(err);
  }
});

// GET /api/assessment/snapshots?home=X&engine=cqc — list historical snapshots
router.get('/snapshots', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const engine = req.query.engine;
    if (!engine || !['cqc', 'gdpr'].includes(engine)) {
      return res.status(400).json({ error: 'engine query param required (cqc or gdpr)' });
    }
    const snapshots = await assessmentRepo.findByHome(req.home.id, engine);
    res.json(snapshots);
  } catch (err) { next(err); }
});

// GET /api/assessment/snapshots/:id?home=X — retrieve specific snapshot
router.get('/snapshots/:id', readRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'read'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid snapshot ID' });
    const snapshot = await assessmentRepo.findById(id, req.home.id);
    if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });
    res.json(snapshot);
  } catch (err) { next(err); }
});

// PUT /api/assessment/snapshots/:id/sign-off?home=X — manager sign-off
router.put('/snapshots/:id/sign-off', writeRateLimiter, requireAuth, requireHomeAccess, requireModule('compliance', 'write'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid snapshot ID' });
    const parsed = signOffSchema.safeParse(req.body);
    if (!parsed.success) return zodError(res, parsed);
    // Check existence + state before sign-off for specific error messages
    const existing = await assessmentRepo.findById(id, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Snapshot not found' });
    if (existing.signed_off_by) return res.status(409).json({ error: 'Already signed off' });
    if (existing.computed_by === req.user.username) return res.status(403).json({ error: 'Cannot sign off your own snapshot' });
    const snapshot = await assessmentRepo.signOff(id, req.home.id, req.user.username, parsed.data.notes);
    if (!snapshot) return res.status(409).json({ error: 'Sign-off failed' });
    await auditService.log('assessment_signoff', req.home.slug, req.user.username, `snapshot=${id} engine=${snapshot.engine} score=${snapshot.overall_score}`);
    res.json(snapshot);
  } catch (err) { next(err); }
});

export default router;
