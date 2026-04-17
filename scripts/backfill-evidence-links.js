import * as homeRepo from '../repositories/homeRepo.js';
import * as incidentRepo from '../repositories/incidentRepo.js';
import * as complaintRepo from '../repositories/complaintRepo.js';
import * as supervisionRepo from '../repositories/supervisionRepo.js';
import * as appraisalRepo from '../repositories/appraisalRepo.js';
import * as fireDrillRepo from '../repositories/fireDrillRepo.js';
import * as maintenanceRepo from '../repositories/maintenanceRepo.js';
import * as riskRepo from '../repositories/riskRepo.js';
import * as onboardingRepo from '../repositories/onboardingRepo.js';
import * as careCertRepo from '../repositories/careCertRepo.js';
import * as dolsRepo from '../repositories/dolsRepo.js';
import * as handoverRepo from '../repositories/handoverRepo.js';
import * as cqcEvidenceRepo from '../repositories/cqcEvidenceRepo.js';
import * as cqcPartnerFeedbackRepo from '../repositories/cqcPartnerFeedbackRepo.js';
import * as cqcObservationRepo from '../repositories/cqcObservationRepo.js';
import * as cqcEvidenceLinksRepo from '../repositories/cqcEvidenceLinksRepo.js';
import { buildAutoLinksForRecord } from '../services/cqcAutoLinkService.js';

function flattenRows(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.rows)) return result.rows;
  if (result.rows && typeof result.rows === 'object') return Object.values(result.rows).flat();
  return [];
}

function flattenOnboardingRecords(result) {
  const rows = [];
  for (const [staffId, sections] of Object.entries(result || {})) {
    for (const [section, data] of Object.entries(sections || {})) {
      rows.push({ id: `${staffId}:${section}`, staff_id: staffId, section, ...(data || {}) });
    }
  }
  return rows;
}

function flattenCareCertificateRecords(result) {
  return Object.entries(result || {}).map(([staffId, data]) => ({
    id: staffId,
    staff_id: staffId,
    ...(data || {}),
  }));
}

async function loadModuleRecords(homeId) {
  const today = new Date().toISOString().slice(0, 10);
  const [incidents, complaints, supervisions, appraisals, fireDrills, maintenance, risks, onboarding, careCertificates, dols, mcaAssessments, handover, evidence, partnerFeedback, observations] = await Promise.all([
    incidentRepo.findByHome(homeId, { limit: 5000 }),
    complaintRepo.findByHome(homeId, { limit: 5000 }),
    supervisionRepo.findByHome(homeId, { limit: 5000 }),
    appraisalRepo.findByHome(homeId, { limit: 5000 }),
    fireDrillRepo.findByHome(homeId),
    maintenanceRepo.findByHome(homeId, { limit: 5000 }),
    riskRepo.findByHome(homeId, { limit: 5000 }),
    onboardingRepo.findByHome(homeId),
    careCertRepo.findByHome(homeId),
    dolsRepo.findByHome(homeId, { limit: 5000 }),
    dolsRepo.findMcaByHome(homeId, { limit: 5000 }),
    handoverRepo.findByHomeAndDateRange(homeId, '2000-01-01', today, { limit: 5000 }),
    cqcEvidenceRepo.findByHome(homeId, { limit: 5000 }),
    cqcPartnerFeedbackRepo.findByHome(homeId),
    cqcObservationRepo.findByHome(homeId),
  ]);

  return [
    ['incident', flattenRows(incidents)],
    ['complaint', flattenRows(complaints)],
    ['supervision', flattenRows(supervisions)],
    ['appraisal', flattenRows(appraisals)],
    ['fire_drill', flattenRows(fireDrills)],
    ['maintenance', flattenRows(maintenance)],
    ['risk', flattenRows(risks)],
    ['onboarding', flattenOnboardingRecords(onboarding)],
    ['care_certificate', flattenCareCertificateRecords(careCertificates)],
    ['dols', flattenRows(dols)],
    ['mca_assessment', flattenRows(mcaAssessments)],
    ['handover', flattenRows(handover)],
    ['cqc_evidence', flattenRows(evidence)],
    ['cqc_partner_feedback', flattenRows(partnerFeedback)],
    ['cqc_observation', flattenRows(observations)],
  ];
}

async function backfillHome(home) {
  const moduleRecords = await loadModuleRecords(home.id);
  const links = [];

  for (const [module, records] of moduleRecords) {
    for (const record of records) {
      links.push(...buildAutoLinksForRecord(home.id, module, record, 'backfill-script'));
    }
  }

  const saved = await cqcEvidenceLinksRepo.createBulkLinks(home.id, links);
  const statements = [...new Set(saved.map((link) => link.qualityStatement))];
  console.log(`Home ${home.slug}: prepared ${links.length} links, active matches ${saved.length}, statements ${statements.length}`);
}

async function main() {
  const targetSlug = process.argv[2];
  const homes = targetSlug
    ? [await homeRepo.findBySlug(targetSlug)].filter(Boolean)
    : await homeRepo.listAllWithIds();

  if (homes.length === 0) {
    console.error(targetSlug ? `Home not found: ${targetSlug}` : 'No homes found');
    process.exitCode = 1;
    return;
  }

  for (const home of homes) {
    await backfillHome(home);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
