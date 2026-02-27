import { withTransaction } from '../db.js';
import { NotFoundError } from '../errors.js';
import * as homeRepo from '../repositories/homeRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import * as trainingRepo from '../repositories/trainingRepo.js';
import * as supervisionRepo from '../repositories/supervisionRepo.js';
import * as appraisalRepo from '../repositories/appraisalRepo.js';
import * as fireDrillRepo from '../repositories/fireDrillRepo.js';
import * as dayNoteRepo from '../repositories/dayNoteRepo.js';
import * as onboardingRepo from '../repositories/onboardingRepo.js';
import * as incidentRepo from '../repositories/incidentRepo.js';
import * as complaintRepo from '../repositories/complaintRepo.js';
import * as complaintSurveyRepo from '../repositories/complaintSurveyRepo.js';
import * as maintenanceRepo from '../repositories/maintenanceRepo.js';
import * as ipcRepo from '../repositories/ipcRepo.js';
import * as riskRepo from '../repositories/riskRepo.js';
import * as policyRepo from '../repositories/policyRepo.js';
import * as whistleblowingRepo from '../repositories/whistleblowingRepo.js';
import * as dolsRepo from '../repositories/dolsRepo.js';
import * as careCertRepo from '../repositories/careCertRepo.js';
import * as cqcEvidenceRepo from '../repositories/cqcEvidenceRepo.js';
import * as auditRepo from '../repositories/auditRepo.js';

export async function listHomes() {
  return homeRepo.listAll();
}

// Assemble the full home data object in the same shape the frontend expects.
// All repo queries run in parallel — P50 latency target < 50ms on 1 home.
export async function assembleData(homeSlug, userRole) {
  const home = await homeRepo.findBySlug(homeSlug);
  if (!home) throw new NotFoundError(`Home not found: ${homeSlug}`);

  const [
    staff, overrides, training, supervisions, appraisals,
    fireDrills, dayNotes, onboarding,
    incidents, complaints, complaintSurveys,
    maintenance, ipcAudits, risks, policies,
    whistleblowing, dols, mca,
    careCert, cqcEvidence,
  ] = await Promise.all([
    staffRepo.findByHome(home.id),
    overrideRepo.findByHome(home.id),
    trainingRepo.findByHome(home.id),
    supervisionRepo.findByHome(home.id),
    appraisalRepo.findByHome(home.id),
    fireDrillRepo.findByHome(home.id),
    dayNoteRepo.findByHome(home.id),
    onboardingRepo.findByHome(home.id),
    incidentRepo.findByHome(home.id),
    complaintRepo.findByHome(home.id),
    complaintSurveyRepo.findByHome(home.id),
    maintenanceRepo.findByHome(home.id),
    ipcRepo.findByHome(home.id),
    riskRepo.findByHome(home.id),
    policyRepo.findByHome(home.id),
    whistleblowingRepo.findByHome(home.id),
    dolsRepo.findByHome(home.id),
    dolsRepo.findMcaByHome(home.id),
    careCertRepo.findByHome(home.id),
    cqcEvidenceRepo.findByHome(home.id),
  ]);

  const payload = {
    _updatedAt: home.updated_at?.toISOString() || null,
    config: home.config,
    annual_leave: home.annual_leave,
    staff,
    overrides,
    training,
    supervisions,
    appraisals,
    fire_drills: fireDrills,
    day_notes: dayNotes,
    onboarding,
    incidents,
    complaints,
    complaint_surveys: complaintSurveys,
    maintenance,
    ipc_audits: ipcAudits,
    risk_register: risks,
    policy_reviews: policies,
    whistleblowing_concerns: whistleblowing,
    care_certificate: careCert,
    cqc_evidence: cqcEvidence,
  };

  // Viewer role: strip GDPR special category data
  if (userRole === 'admin') {
    payload.dols = dols;
    payload.mca_assessments = mca;
  } else {
    // Strip staff PII (NI numbers, dates of birth) from non-admin responses
    payload.staff = staff.map(s => ({ ...s, date_of_birth: null, ni_number: null }));
  }

  return payload;
}

// Save all domains in a single transaction.
// On any failure the whole transaction rolls back — no partial saves.
export async function saveData(homeSlug, body, username) {
  const home = await homeRepo.findBySlug(homeSlug);
  if (!home) throw new NotFoundError(`Home not found: ${homeSlug}`);

  return withTransaction(async (client) => {
    await homeRepo.updateConfig(home.id, body.config, client);
    await homeRepo.updateAnnualLeave(home.id, body.annual_leave, client);
    await staffRepo.sync(home.id, body.staff || [], client);
    await overrideRepo.replace(home.id, body.overrides || {}, client);
    await trainingRepo.sync(home.id, body.training || {}, client);
    await supervisionRepo.sync(home.id, body.supervisions || {}, client);
    await appraisalRepo.sync(home.id, body.appraisals || {}, client);
    await fireDrillRepo.sync(home.id, body.fire_drills || [], client);
    await dayNoteRepo.replace(home.id, body.day_notes || {}, client);
    await onboardingRepo.sync(home.id, body.onboarding || {}, client);
    await incidentRepo.sync(home.id, body.incidents || [], client);
    await complaintRepo.sync(home.id, body.complaints || [], client);
    await complaintSurveyRepo.sync(home.id, body.complaint_surveys || [], client);
    await maintenanceRepo.sync(home.id, body.maintenance || [], client);
    await ipcRepo.sync(home.id, body.ipc_audits || [], client);
    await riskRepo.sync(home.id, body.risk_register || [], client);
    await policyRepo.sync(home.id, body.policy_reviews || [], client);
    await whistleblowingRepo.sync(home.id, body.whistleblowing_concerns || [], client);
    await dolsRepo.syncDols(home.id, body.dols || [], client);
    await dolsRepo.syncMca(home.id, body.mca_assessments || [], client);
    await careCertRepo.sync(home.id, body.care_certificate || {}, client);
    await cqcEvidenceRepo.sync(home.id, body.cqc_evidence || [], client);
    await auditRepo.log('save', homeSlug, username, null, client);
  });

  // Return the new updated_at so the client can track the server's timestamp
  const fresh = await homeRepo.findBySlug(homeSlug);
  return { updatedAt: fresh?.updated_at?.toISOString() || null };
}

// Ensure a home row exists for the given slug. Used by the import script.
export async function upsertHome(slug, name, configData, annualLeave) {
  return homeRepo.upsert(slug, name, configData, annualLeave);
}
