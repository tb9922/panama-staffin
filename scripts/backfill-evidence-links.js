import * as homeRepo from '../repositories/homeRepo.js';
import * as incidentRepo from '../repositories/incidentRepo.js';
import * as complaintRepo from '../repositories/complaintRepo.js';
import * as supervisionRepo from '../repositories/supervisionRepo.js';
import * as fireDrillRepo from '../repositories/fireDrillRepo.js';
import * as maintenanceRepo from '../repositories/maintenanceRepo.js';
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

async function loadModuleRecords(homeId) {
  const [incidents, complaints, supervisions, fireDrills, maintenance, evidence, partnerFeedback, observations] = await Promise.all([
    incidentRepo.findByHome(homeId, { limit: 5000 }),
    complaintRepo.findByHome(homeId, { limit: 5000 }),
    supervisionRepo.findByHome(homeId, { limit: 5000 }),
    fireDrillRepo.findByHome(homeId),
    maintenanceRepo.findByHome(homeId, { limit: 5000 }),
    cqcEvidenceRepo.findByHome(homeId, { limit: 5000 }),
    cqcPartnerFeedbackRepo.findByHome(homeId),
    cqcObservationRepo.findByHome(homeId),
  ]);

  return [
    ['incident', flattenRows(incidents)],
    ['complaint', flattenRows(complaints)],
    ['supervision', flattenRows(supervisions)],
    ['fire_drill', flattenRows(fireDrills)],
    ['maintenance', flattenRows(maintenance)],
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
