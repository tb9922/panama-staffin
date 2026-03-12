import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../../middleware/auth.js';
import * as hrRepo from '../../repositories/hrRepo.js';
import * as auditService from '../../services/auditService.js';
import { meetingBodySchema, meetingCaseTypeSchema } from './schemas.js';

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
    const meeting = await hrRepo.createMeeting(req.home.id, ctParsed.data, caseId, {
      ...parsed.data,
      recorded_by: req.user.username,
    });
    await auditService.log(`hr_${ctParsed.data}_meeting_create`, req.home.slug, req.user.username, { id: meeting.id });
    res.status(201).json(meeting);
  } catch (err) { next(err); }
});

// PUT /api/hr/meetings/:id?home=X
router.put('/meetings/:id', requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid meeting ID' });
    const versionedSchema = meetingBodySchema.partial().extend({ _version: z.number().int().nonnegative().optional() });
    const parsed = versionedSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const version = parsed.data._version != null ? parsed.data._version : null;
    const existing = await hrRepo.findMeetingById(id, req.home.id);
    if (!existing) return res.status(404).json({ error: 'Meeting not found' });
    const meeting = await hrRepo.updateMeeting(id, req.home.id, parsed.data, null, version);
    if (!meeting) return res.status(409).json({ error: 'Record was modified by another user. Please refresh and try again.' });
    await auditService.log(`hr_${meeting.case_type}_meeting_update`, req.home.slug, req.user.username, { id: meeting.id });
    res.json(meeting);
  } catch (err) { next(err); }
});

export default router;
