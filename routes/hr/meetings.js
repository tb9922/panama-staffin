import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../../middleware/auth.js';
import * as hrRepo from '../../repositories/hrRepo.js';
import * as auditService from '../../services/auditService.js';
import { meetingBodySchema, meetingCaseTypeSchema } from './schemas.js';
import { definedWithoutVersion, splitVersion } from '../../lib/versionedPayload.js';
import { withTransaction } from '../../db.js';

const router = Router();

// GET /api/hr/meetings/:caseType/:caseId?home=X
router.get('/meetings/:caseType/:caseId', requireAuth, requireHomeAccess, requireModule('hr', 'read'), async (req, res, next) => {
  try {
    const parsed = meetingCaseTypeSchema.safeParse(req.params.caseType);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid case type' });
    const caseId = Number(req.params.caseId);
    if (!Number.isInteger(caseId) || caseId < 1) return res.status(400).json({ error: 'Invalid case ID' });
    const meetings = await hrRepo.findMeetings(parsed.data, caseId, req.home.id);
    res.json(meetings);
  } catch (err) { next(err); }
});

// POST /api/hr/meetings/:caseType/:caseId?home=X
router.post('/meetings/:caseType/:caseId', requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
  try {
    const ctParsed = meetingCaseTypeSchema.safeParse(req.params.caseType);
    if (!ctParsed.success) return res.status(400).json({ error: 'Invalid case type' });
    const caseId = Number(req.params.caseId);
    if (!Number.isInteger(caseId) || caseId < 1) return res.status(400).json({ error: 'Invalid case ID' });
    const parsed = meetingBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const meeting = await withTransaction(async (client) => {
      const created = await hrRepo.createMeeting(req.home.id, ctParsed.data, caseId, {
        ...parsed.data,
        recorded_by: req.user.username,
      }, client);
      if (!created) return null;
      await auditService.log(`hr_${ctParsed.data}_meeting_create`, req.home.slug, req.user.username, { id: created.id }, client);
      return created;
    });
    if (!meeting) return res.status(404).json({ error: 'Case not found' });
    res.status(201).json(meeting);
  } catch (err) { next(err); }
});

// PUT /api/hr/meetings/:id?home=X
router.put('/meetings/:id', requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid meeting ID' });
    const versionedSchema = meetingBodySchema.partial().extend({ _version: z.number().int().nonnegative() });
    const parsed = versionedSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { version } = splitVersion(parsed.data);
    const outcome = await withTransaction(async (client) => {
      const existing = await hrRepo.findMeetingById(id, req.home.id, client);
      if (!existing) return { status: 'not_found' };
      const meeting = await hrRepo.updateMeeting(id, req.home.id, definedWithoutVersion(parsed.data), client, version);
      if (!meeting) return { status: 'conflict' };
      await auditService.log(`hr_${meeting.case_type}_meeting_update`, req.home.slug, req.user.username, { id: meeting.id }, client);
      return { status: 'ok', meeting };
    });
    if (outcome.status === 'not_found') return res.status(404).json({ error: 'Meeting not found' });
    if (outcome.status === 'conflict') return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    const { meeting } = outcome;
    res.json(meeting);
  } catch (err) { next(err); }
});

// DELETE /api/hr/meetings/:id?home=X
router.delete('/meetings/:id', requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid meeting ID' });
    const parsed = z.object({ _version: z.number().int().nonnegative() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const outcome = await withTransaction(async (client) => {
      const existing = await hrRepo.findMeetingById(id, req.home.id, client);
      if (!existing) return { status: 'not_found' };
      const deleted = await hrRepo.deleteMeeting(id, req.home.id, client, parsed.data._version);
      if (!deleted) return { status: 'conflict' };
      await auditService.log(`hr_${existing.case_type}_meeting_delete`, req.home.slug, req.user.username, { id }, client);
      return { status: 'deleted' };
    });
    if (outcome.status === 'not_found') return res.status(404).json({ error: 'Meeting not found' });
    if (outcome.status === 'conflict') return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
