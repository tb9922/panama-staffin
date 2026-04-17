import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireHomeAccess, requireModule } from '../../middleware/auth.js';
import { perUserKey } from '../../lib/rateLimiter.js';
import { PostgresRateLimitStore } from '../../lib/postgresRateLimitStore.js';
import * as staffRepo from '../../repositories/staffRepo.js';
import * as hrRepo from '../../repositories/hrRepo.js';
import * as auditService from '../../services/auditService.js';
import { definedWithoutVersion, splitVersion } from '../../lib/versionedPayload.js';
import {
  mapDisciplinaryFields, mapGrievanceFields, mapPerformanceFields,
  mapRtwFields, mapOhFields, mapContractFields, mapFamilyLeaveFields,
  mapFlexFields, mapEdiFields, mapTupeFields, mapRenewalFields,
} from '../../lib/hrFieldMappers.js';

import { registerCaseRoutes } from './factory.js';
import {
  idSchema,
  disciplinaryBodySchema, disciplinaryUpdateSchema,
  grievanceBodySchema, grievanceUpdateSchema,
  grievanceActionBodySchema, grievanceActionUpdateSchema,
  performanceBodySchema, performanceUpdateSchema,
  rtwInterviewBodySchema, rtwInterviewUpdateSchema,
  ohReferralBodySchema, ohReferralUpdateSchema,
  contractBodySchema, contractUpdateSchema,
  familyLeaveBodySchema, familyLeaveUpdateSchema,
  flexWorkingBodySchema, flexWorkingUpdateSchema,
  ediBodySchema, ediUpdateSchema,
  tupeBodySchema, tupeUpdateSchema,
  renewalBodySchema, renewalUpdateSchema,
} from './schemas.js';

import caseNotesRouter from './caseNotes.js';
import attachmentsRouter from './attachments.js';
import meetingsRouter from './meetings.js';
import statsRouter from './stats.js';
import gdprRouter from './gdpr.js';

const router = Router();

// ── Rate limiting — all HR endpoints (GDPR special category data) ─────────
if (process.env.NODE_ENV !== 'test') {
  router.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    keyGenerator: perUserKey,
    store: new PostgresRateLimitStore({ prefix: 'hr:' }),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  }));
}

// ── Staff List (for picker dropdown) ────────────────────────────────────────
router.get('/staff', requireAuth, requireHomeAccess, requireModule('hr', 'read'), async (req, res, next) => {
  try {
    const staffResult = await staffRepo.findByHome(req.home.id);
    res.json(staffResult.rows.map(s => ({ id: s.id, name: s.name, role: s.role, team: s.team, active: s.active })));
  } catch (err) { next(err); }
});

// ── Case Type Registrations ─────────────────────────────────────────────────

registerCaseRoutes(router, {
  type: 'disciplinary', path: '/cases/disciplinary',
  bodySchema: disciplinaryBodySchema, updateSchema: disciplinaryUpdateSchema,
  mapFields: mapDisciplinaryFields,
  filters: { staff_id: 'staffId', status: 'status' },
  repoFind: hrRepo.findDisciplinary, repoFindById: hrRepo.findDisciplinaryById,
  repoCreate: hrRepo.createDisciplinary, repoUpdate: hrRepo.updateDisciplinary,
  table: 'hr_disciplinary_cases',
});

registerCaseRoutes(router, {
  type: 'grievance', path: '/cases/grievance',
  bodySchema: grievanceBodySchema, updateSchema: grievanceUpdateSchema,
  mapFields: mapGrievanceFields,
  filters: { staff_id: 'staffId', status: 'status' },
  repoFind: hrRepo.findGrievance, repoFindById: hrRepo.findGrievanceById,
  repoCreate: hrRepo.createGrievance, repoUpdate: hrRepo.updateGrievance,
  table: 'hr_grievance_cases',
});

// ── Grievance Actions ───────────────────────────────────────────────────────

// GET /api/hr/cases/grievance/:id/actions?home=X
router.get('/cases/grievance/:id/actions', requireAuth, requireHomeAccess, requireModule('hr', 'read'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid case ID' });
    res.json(await hrRepo.findGrievanceActions(idP.data, req.home.id));
  } catch (err) { next(err); }
});

// POST /api/hr/cases/grievance/:id/actions?home=X
router.post('/cases/grievance/:id/actions', requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid case ID' });
    const parsed = grievanceActionBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await hrRepo.createGrievanceAction(idP.data, req.home.id, parsed.data);
    await auditService.log('hr_grievance_action_create', req.home.slug, req.user.username, { id: result.id });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// PUT /api/hr/grievance-actions/:id?home=X
router.put('/grievance-actions/:id', requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid action ID' });
    const parsed = grievanceActionUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { version } = splitVersion(parsed.data);
    const result = await hrRepo.updateGrievanceAction(idP.data, req.home.id, definedWithoutVersion(parsed.data), null, version);
    if (!result) return res.status(404).json({ error: 'Grievance action not found' });
    await auditService.log('hr_grievance_action_update', req.home.slug, req.user.username, { id: result.id });
    res.json(result);
  } catch (err) { next(err); }
});

registerCaseRoutes(router, {
  type: 'performance', path: '/cases/performance',
  bodySchema: performanceBodySchema, updateSchema: performanceUpdateSchema,
  mapFields: mapPerformanceFields,
  filters: { staff_id: 'staffId', status: 'status', type: 'type' },
  repoFind: hrRepo.findPerformance, repoFindById: hrRepo.findPerformanceById,
  repoCreate: hrRepo.createPerformance, repoUpdate: hrRepo.updatePerformance,
  table: 'hr_performance_cases',
});

// ── Mount sub-routers (stats/absence routes BEFORE case registrations that use path params) ──
router.use(statsRouter);

registerCaseRoutes(router, {
  type: 'rtw_interview', path: '/rtw-interviews',
  bodySchema: rtwInterviewBodySchema, updateSchema: rtwInterviewUpdateSchema,
  mapFields: mapRtwFields,
  filters: { staff_id: 'staffId' },
  repoFind: hrRepo.findRtwInterviews, repoFindById: hrRepo.findRtwInterviewById,
  repoCreate: hrRepo.createRtwInterview, repoUpdate: hrRepo.updateRtwInterview,
  auditPrefix: 'rtw',
  table: 'hr_rtw_interviews',
});

registerCaseRoutes(router, {
  type: 'oh_referral', path: '/oh-referrals',
  bodySchema: ohReferralBodySchema, updateSchema: ohReferralUpdateSchema,
  mapFields: mapOhFields,
  filters: { staff_id: 'staffId', status: 'status' },
  repoFind: hrRepo.findOhReferrals, repoFindById: hrRepo.findOhReferralById,
  repoCreate: hrRepo.createOhReferral, repoUpdate: hrRepo.updateOhReferral,
  auditPrefix: 'oh_referral',
  table: 'hr_oh_referrals',
});

registerCaseRoutes(router, {
  type: 'contract', path: '/contracts',
  bodySchema: contractBodySchema, updateSchema: contractUpdateSchema,
  mapFields: mapContractFields,
  filters: { staff_id: 'staffId', status: 'status' },
  repoFind: hrRepo.findContracts, repoFindById: hrRepo.findContractById,
  repoCreate: hrRepo.createContract, repoUpdate: hrRepo.updateContract,
  table: 'hr_contracts',
});

registerCaseRoutes(router, {
  type: 'family_leave', path: '/family-leave',
  bodySchema: familyLeaveBodySchema, updateSchema: familyLeaveUpdateSchema,
  mapFields: mapFamilyLeaveFields,
  filters: { staff_id: 'staffId', type: 'type' },
  repoFind: hrRepo.findFamilyLeave, repoFindById: hrRepo.findFamilyLeaveById,
  repoCreate: hrRepo.createFamilyLeave, repoUpdate: hrRepo.updateFamilyLeave,
  table: 'hr_family_leave',
});

registerCaseRoutes(router, {
  type: 'flexible_working', path: '/flexible-working',
  bodySchema: flexWorkingBodySchema, updateSchema: flexWorkingUpdateSchema,
  mapFields: mapFlexFields,
  filters: { staff_id: 'staffId', status: 'status' },
  repoFind: hrRepo.findFlexWorking, repoFindById: hrRepo.findFlexWorkingById,
  repoCreate: hrRepo.createFlexWorking, repoUpdate: hrRepo.updateFlexWorking,
  auditPrefix: 'flex_working',
  table: 'hr_flexible_working',
});

registerCaseRoutes(router, {
  type: 'edi', path: '/edi',
  bodySchema: ediBodySchema, updateSchema: ediUpdateSchema,
  mapFields: mapEdiFields,
  filters: { record_type: 'recordType', staff_id: 'staffId' },
  repoFind: hrRepo.findEdi, repoFindById: hrRepo.findEdiById,
  repoCreate: hrRepo.createEdi, repoUpdate: hrRepo.updateEdi,
  table: 'hr_edi_records',
});

registerCaseRoutes(router, {
  type: 'tupe', path: '/tupe',
  bodySchema: tupeBodySchema, updateSchema: tupeUpdateSchema,
  mapFields: mapTupeFields,
  filters: {},
  repoFind: (homeId, _f, client, pag) => hrRepo.findTupe(homeId, client, pag),
  repoFindById: hrRepo.findTupeById,
  repoCreate: hrRepo.createTupe, repoUpdate: hrRepo.updateTupe,
  table: 'hr_tupe_transfers',
});

registerCaseRoutes(router, {
  type: 'renewal', path: '/renewals',
  bodySchema: renewalBodySchema, updateSchema: renewalUpdateSchema,
  mapFields: mapRenewalFields,
  filters: { staff_id: 'staffId', check_type: 'checkType', status: 'status' },
  repoFind: hrRepo.findRenewals, repoFindById: hrRepo.findRenewalById,
  repoCreate: hrRepo.createRenewal, repoUpdate: hrRepo.updateRenewal,
  auditPrefix: 'dbs_renewal',
  table: 'hr_rtw_dbs_renewals',
});

// ── Mount remaining sub-routers ─────────────────────────────────────────────
router.use(caseNotesRouter);
router.use(attachmentsRouter);
router.use(meetingsRouter);
router.use(gdprRouter);

export default router;
