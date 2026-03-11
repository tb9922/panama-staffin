#!/usr/bin/env node
/**
 * scripts/import-homes.js
 *
 * One-time JSON → PostgreSQL import. Reads all files in homes/*.json and
 * inserts each domain using the repository layer. Safe to run multiple times
 * (all operations are upserts). Logs counts per domain per home.
 *
 * Usage:
 *   node scripts/import-homes.js
 *   node scripts/import-homes.js --home Oakwood_Care_Home   # single home only
 *
 * Prerequisite: docker compose up -d && node scripts/migrate.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { pool, withTransaction } from '../db.js';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'homes');

function count(val) {
  if (!val) return 0;
  if (Array.isArray(val)) return val.length;
  if (typeof val === 'object') return Object.keys(val).length;
  return 0;
}

async function importHome(jsonFile) {
  const slug = path.basename(jsonFile, '.json');
  console.log(`\nImporting ${slug}...`);

  let data;
  try {
    data = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
  } catch (err) {
    console.error(`  ERROR reading ${jsonFile}: ${err.message}`);
    return;
  }

  const homeName = data.config?.home_name || slug;

  await withTransaction(async (client) => {
    // 1. Upsert the home row
    const home = await homeRepo.upsert(slug, homeName, data.config || {}, data.annual_leave || {}, client);
    const homeId = home.id;
    console.log(`  home:              OK (id=${homeId})`);

    // 2. Staff
    await staffRepo.sync(homeId, data.staff || [], client);
    console.log(`  staff:             ${count(data.staff)} records`);

    // 3. Overrides (hot path — delete+insert)
    await overrideRepo.replace(homeId, data.overrides || {}, client);
    const overrideDays = count(data.overrides);
    const overrideEntries = Object.values(data.overrides || {}).reduce((s, d) => s + count(d), 0);
    console.log(`  overrides:         ${overrideDays} days, ${overrideEntries} entries`);

    // 4. Training
    await trainingRepo.sync(homeId, data.training || {}, client);
    const trainingCount = Object.values(data.training || {}).reduce((s, r) => s + count(r), 0);
    console.log(`  training:          ${trainingCount} records`);

    // 5. Supervisions
    await supervisionRepo.sync(homeId, data.supervisions || {}, client);
    const supCount = Object.values(data.supervisions || {}).reduce((s, a) => s + a.length, 0);
    console.log(`  supervisions:      ${supCount} records`);

    // 6. Appraisals
    await appraisalRepo.sync(homeId, data.appraisals || {}, client);
    const aprCount = Object.values(data.appraisals || {}).reduce((s, a) => s + a.length, 0);
    console.log(`  appraisals:        ${aprCount} records`);

    // 7. Fire drills
    await fireDrillRepo.sync(homeId, data.fire_drills || [], client);
    console.log(`  fire_drills:       ${count(data.fire_drills)} records`);

    // 8. Day notes
    await dayNoteRepo.replace(homeId, data.day_notes || {}, client);
    console.log(`  day_notes:         ${count(data.day_notes)} records`);

    // 9. Onboarding
    await onboardingRepo.sync(homeId, data.onboarding || {}, client);
    console.log(`  onboarding:        ${count(data.onboarding)} staff`);

    // 10. Incidents
    await incidentRepo.sync(homeId, data.incidents || [], client);
    console.log(`  incidents:         ${count(data.incidents)} records`);

    // 11. Complaints
    await complaintRepo.sync(homeId, data.complaints || [], client);
    console.log(`  complaints:        ${count(data.complaints)} records`);

    // 12. Complaint surveys
    await complaintSurveyRepo.sync(homeId, data.complaint_surveys || [], client);
    console.log(`  complaint_surveys: ${count(data.complaint_surveys)} records`);

    // 13. Maintenance
    await maintenanceRepo.sync(homeId, data.maintenance || [], client);
    console.log(`  maintenance:       ${count(data.maintenance)} records`);

    // 14. IPC audits
    await ipcRepo.sync(homeId, data.ipc_audits || [], client);
    console.log(`  ipc_audits:        ${count(data.ipc_audits)} records`);

    // 15. Risk register
    await riskRepo.sync(homeId, data.risk_register || [], client);
    console.log(`  risk_register:     ${count(data.risk_register)} records`);

    // 16. Policy reviews
    await policyRepo.sync(homeId, data.policy_reviews || [], client);
    console.log(`  policy_reviews:    ${count(data.policy_reviews)} records`);

    // 17. Whistleblowing
    await whistleblowingRepo.sync(homeId, data.whistleblowing_concerns || [], client);
    console.log(`  whistleblowing:    ${count(data.whistleblowing_concerns)} records`);

    // 18. DoLS + MCA
    await dolsRepo.syncDols(homeId, data.dols || [], client);
    await dolsRepo.syncMca(homeId, data.mca_assessments || [], client);
    console.log(`  dols:              ${count(data.dols)} records`);
    console.log(`  mca_assessments:   ${count(data.mca_assessments)} records`);

    // 19. Care certificate
    await careCertRepo.sync(homeId, data.care_certificate || {}, client);
    console.log(`  care_certificate:  ${count(data.care_certificate)} staff`);

    // 20. CQC evidence
    await cqcEvidenceRepo.sync(homeId, data.cqc_evidence || [], client);
    console.log(`  cqc_evidence:      ${count(data.cqc_evidence)} records`);
  });

  console.log(`  DONE: ${slug}`);
}

async function main() {
  const homeFilter = process.argv.includes('--home')
    ? process.argv[process.argv.indexOf('--home') + 1]
    : null;

  if (!fs.existsSync(DATA_DIR)) {
    console.error(`homes/ directory not found at ${DATA_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .filter(f => !homeFilter || f === `${homeFilter}.json`)
    .map(f => path.join(DATA_DIR, f));

  if (files.length === 0) {
    console.log(homeFilter
      ? `No file found for home: ${homeFilter}`
      : 'No .json files found in homes/ directory.'
    );
    process.exit(0);
  }

  console.log(`Found ${files.length} home(s) to import.`);

  for (const file of files) {
    await importHome(file);
  }

  console.log(`\nImport complete. ${files.length} home(s) imported.`);
  await pool.end();
}

main().catch(err => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
