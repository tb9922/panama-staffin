import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, requireHomeAccess, requireModule } from '../../middleware/auth.js';
import { perUserKey, readRateLimiter } from '../../lib/rateLimiter.js';
import { PostgresRateLimitStore } from '../../lib/postgresRateLimitStore.js';
import * as staffRepo from '../../repositories/staffRepo.js';
import * as hrRepo from '../../repositories/hrRepo.js';
import * as actionItemRepo from '../../repositories/actionItemRepo.js';
import * as auditService from '../../services/auditService.js';
import { withTransaction } from '../../db.js';
import { calculateEscalationLevel } from '../../lib/actionItems.js';
import { definedWithoutVersion, splitVersion } from '../../lib/versionedPayload.js';
import {
  diffFields, mapDisciplinaryFields, mapGrievanceFields, mapPerformanceFields,
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

const EDI_AUDIT_SENSITIVE_FIELDS = [
  'harassment_category',
  'respondent_name',
  'reasonable_steps_evidence',
  'condition_description',
  'adjustments',
  'access_to_work_reference',
  'description',
  'outcome',
  'notes',
  'category',
];
const HR_ACTION_AUDIT_SENSITIVE_FIELDS = ['description'];

function hrActionItemTitle(action) {
  return `HR grievance action due ${action.due_date}`;
}

function actorId(req) {
  return req.authDbUser?.id || null;
}

async function cancelGrievanceLinkedRecords({ req, id, client }) {
  return actionItemRepo.cancelAllBySource(
    req.home.id,
    'hr_grievance',
    String(id),
    actorId(req),
    client,
  );
}

function normalizeActionItemStatus(status) {
  return status === 'completed' ? 'completed' : 'open';
}

async function syncGrievanceActionItem(req, grievanceId, action, client) {
  const sourceActionKey = `grievance_action:${action.id}`;
  if (!action?.due_date || action.status === 'cancelled') {
    return actionItemRepo.cancelBySource(
      req.home.id,
      'hr_grievance',
      String(grievanceId),
      sourceActionKey,
      actorId(req),
      client,
    );
  }
  const status = normalizeActionItemStatus(action.status);
  const priority = 'medium';
  const { item } = await actionItemRepo.syncBySource(req.home.id, {
    source_type: 'hr_grievance',
    source_id: String(grievanceId),
    source_action_key: sourceActionKey,
    title: hrActionItemTitle(action),
    description: 'Restricted HR grievance action. Open the HR grievance case for details.',
    category: 'hr',
    priority,
    owner_name: action.responsible || null,
    due_date: action.due_date,
    status,
    escalation_level: calculateEscalationLevel({ dueDate: action.due_date, status, priority }),
  }, actorId(req), client);

  if (item && status === 'completed' && item.status !== 'completed') {
    return actionItemRepo.update(item.id, req.home.id, { status: 'completed', escalation_level: 0 }, null, actorId(req), client);
  }
  return item;
}

// Staff picker data is used by many pages during normal SPA navigation. Keep it
// protected by the shared read limiter without burning the stricter HR case bucket.
router.get('/staff', readRateLimiter, requireAuth, requireHomeAccess, requireModule('hr', 'read'), async (req, res, next) => {
  try {
    const staffResult = await staffRepo.findByHome(req.home.id);
    res.json(staffResult.rows.map(s => ({ id: s.id, name: s.name, role: s.role, team: s.team, active: s.active })));
  } catch (err) { next(err); }
});

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

// ── Case Type Registrations ─────────────────────────────────────────────────

registerCaseRoutes(router, {
  type: 'disciplinary', path: '/cases/disciplinary',
  bodySchema: disciplinaryBodySchema, updateSchema: disciplinaryUpdateSchema,
  mapFields: mapDisciplinaryFields,
  filters: { staff_id: 'staffId', status: 'status' },
  repoFind: hrRepo.findDisciplinary, repoFindById: hrRepo.findDisciplinaryById,
  repoCreate: hrRepo.createDisciplinary, repoUpdate: hrRepo.updateDisciplinary,
  table: 'hr_disciplinary_cases',
  cqcSourceModule: 'hr_disciplinary',
});

registerCaseRoutes(router, {
  type: 'grievance', path: '/cases/grievance',
  bodySchema: grievanceBodySchema, updateSchema: grievanceUpdateSchema,
  mapFields: mapGrievanceFields,
  filters: { staff_id: 'staffId', status: 'status' },
  repoFind: hrRepo.findGrievance, repoFindById: hrRepo.findGrievanceById,
  repoCreate: hrRepo.createGrievance, repoUpdate: hrRepo.updateGrievance,
  table: 'hr_grievance_cases',
  auditSensitiveFields: ['description'],
  cqcSourceModule: 'hr_grievance',
  beforeDelete: cancelGrievanceLinkedRecords,
});

// ── Grievance Actions ───────────────────────────────────────────────────────

// GET /api/hr/cases/grievance/:id/actions?home=X
router.get('/cases/grievance/:id/actions', requireAuth, requireHomeAccess, requireModule('hr', 'read'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid case ID' });
    const grievance = await hrRepo.findGrievanceById(idP.data, req.home.id);
    if (!grievance) return res.status(404).json({ error: 'Grievance case not found' });
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
    if (!parsed.data.due_date) return res.status(400).json({ error: 'Due date is required for accountable actions' });
    const result = await withTransaction(async (client) => {
      const action = await hrRepo.createGrievanceAction(idP.data, req.home.id, parsed.data, client);
      if (!action) return null;
      const actionItem = await syncGrievanceActionItem(req, idP.data, action, client);
      await auditService.log('hr_grievance_action_create', req.home.slug, req.user.username, {
        id: action.id,
        action_item_id: actionItem?.id || actionItem?.item?.id || null,
        changes: diffFields(null, action, { extraSensitive: HR_ACTION_AUDIT_SENSITIVE_FIELDS }),
      }, client);
      return action;
    });
    if (!result) return res.status(404).json({ error: 'Grievance case not found' });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// PUT /api/hr/grievance-actions/:id?home=X
router.put('/grievance-actions/:id', requireAuth, requireHomeAccess, requireModule('hr', 'write'), async (req, res, next) => {
  try {
    const idP = idSchema.safeParse(req.params.id);
    if (!idP.success) return res.status(400).json({ error: 'Invalid action ID' });
    const parsed = grievanceActionUpdateSchema.extend({ _version: z.number().int().positive() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { version } = splitVersion(parsed.data);
    const result = await withTransaction(async (client) => {
      const existing = await hrRepo.findGrievanceActionById(idP.data, req.home.id, client);
      if (!existing) return null;
      const action = await hrRepo.updateGrievanceAction(idP.data, req.home.id, definedWithoutVersion(parsed.data), client, version);
      if (!action) return null;
      const actionItem = await syncGrievanceActionItem(req, action.grievance_id, action, client);
      await auditService.log('hr_grievance_action_update', req.home.slug, req.user.username, {
        id: action.id,
        action_item_id: actionItem?.id || actionItem?.item?.id || null,
        changes: diffFields(existing, action, { extraSensitive: HR_ACTION_AUDIT_SENSITIVE_FIELDS }),
      }, client);
      return action;
    });
    if (!result) return res.status(404).json({ error: 'Grievance action not found' });
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
  auditSensitiveFields: ['description'],
  cqcSourceModule: 'hr_performance',
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
  cqcSourceModule: 'hr_rtw_interview',
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
  cqcSourceModule: 'hr_oh_referral',
});

registerCaseRoutes(router, {
  type: 'contract', path: '/contracts',
  bodySchema: contractBodySchema, updateSchema: contractUpdateSchema,
  mapFields: mapContractFields,
  repoFind: hrRepo.findContracts, repoFindById: hrRepo.findContractById,
  repoCreate: hrRepo.createContract, repoUpdate: hrRepo.updateContract,
  filters: { staff_id: 'staffId', status: 'status', contract_type: 'contractType' },
  table: 'hr_contracts',
  cqcSourceModule: 'hr_contract',
});

registerCaseRoutes(router, {
  type: 'family_leave', path: '/family-leave',
  bodySchema: familyLeaveBodySchema, updateSchema: familyLeaveUpdateSchema,
  mapFields: mapFamilyLeaveFields,
  filters: { staff_id: 'staffId', type: 'type' },
  repoFind: hrRepo.findFamilyLeave, repoFindById: hrRepo.findFamilyLeaveById,
  repoCreate: hrRepo.createFamilyLeave, repoUpdate: hrRepo.updateFamilyLeave,
  table: 'hr_family_leave',
  cqcSourceModule: 'hr_family_leave',
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
  cqcSourceModule: 'hr_flexible_working',
});

registerCaseRoutes(router, {
  type: 'edi', path: '/edi',
  bodySchema: ediBodySchema, updateSchema: ediUpdateSchema,
  mapFields: mapEdiFields,
  filters: { record_type: 'recordType', staff_id: 'staffId' },
  repoFind: hrRepo.findEdi, repoFindById: hrRepo.findEdiById,
  repoCreate: hrRepo.createEdi, repoUpdate: hrRepo.updateEdi,
  auditSensitiveFields: EDI_AUDIT_SENSITIVE_FIELDS,
  table: 'hr_edi_records',
  cqcSourceModule: 'hr_edi',
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
  cqcSourceModule: 'hr_tupe',
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
  cqcSourceModule: 'hr_renewal',
});

// ── Mount remaining sub-routers ─────────────────────────────────────────────
router.use(caseNotesRouter);
router.use(attachmentsRouter);
router.use(meetingsRouter);
router.use(gdprRouter);

export default router;
