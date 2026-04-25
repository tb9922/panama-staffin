import { Router } from 'express';
import { requireAuth, requireHomeAccess, requireModule } from '../../middleware/auth.js';
import * as hrRepo from '../../repositories/hrRepo.js';
import * as auditService from '../../services/auditService.js';
import { idSchema, caseTypeSchema, caseNoteBodySchema } from './schemas.js';

const router = Router();

// GET /api/hr/case-notes/:caseType/:caseId?home=X
router.get('/case-notes/:caseType/:caseId', requireAuth, requireHomeAccess, requireModule('hr', 'read'), async (req, res, next) => {
  try {
    const caseTypeP = caseTypeSchema.safeParse(req.params.caseType);
    if (!caseTypeP.success) return res.status(400).json({ error: 'Invalid case type' });
    const caseIdP = idSchema.safeParse(req.params.caseId);
    if (!caseIdP.success) return res.status(400).json({ error: 'Invalid case ID' });
    if (!await hrRepo.caseExists(req.home.id, caseTypeP.data, caseIdP.data)) return res.status(404).json({ error: 'HR case not found' });
    res.json(await hrRepo.findCaseNotes(req.home.id, caseTypeP.data, caseIdP.data));
  } catch (err) { next(err); }
});

// POST /api/hr/case-notes/:caseType/:caseId?home=X
router.post('/case-notes/:caseType/:caseId', requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
  try {
    const caseTypeP = caseTypeSchema.safeParse(req.params.caseType);
    if (!caseTypeP.success) return res.status(400).json({ error: 'Invalid case type' });
    const caseIdP = idSchema.safeParse(req.params.caseId);
    if (!caseIdP.success) return res.status(400).json({ error: 'Invalid case ID' });
    if (!await hrRepo.caseExists(req.home.id, caseTypeP.data, caseIdP.data)) return res.status(404).json({ error: 'HR case not found' });
    const parsed = caseNoteBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await hrRepo.createCaseNote(req.home.id, caseTypeP.data, caseIdP.data, {
      author: req.user.username,
      content: parsed.data.note,
    });
    await auditService.log('hr_case_note_create', req.home.slug, req.user.username, { id: result.id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

export default router;
