// Assessment Service — Server-authoritative compliance scoring
// Gathers data from repos, runs CQC or GDPR scoring engines, returns result.

import * as homeRepo from '../repositories/homeRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import * as trainingRepo from '../repositories/trainingRepo.js';
import * as supervisionRepo from '../repositories/supervisionRepo.js';
import * as appraisalRepo from '../repositories/appraisalRepo.js';
import * as fireDrillRepo from '../repositories/fireDrillRepo.js';
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
import * as onboardingRepo from '../repositories/onboardingRepo.js';
import * as cqcEvidenceRepo from '../repositories/cqcEvidenceRepo.js';
import * as gdprRepo from '../repositories/gdprRepo.js';
import * as ropaRepo from '../repositories/ropaRepo.js';
import * as dpiaRepo from '../repositories/dpiaRepo.js';
import { scanRetention } from './gdprService.js';

// Scoring engines — pure functions, no browser APIs.
// CONSTRAINT: these files (and their transitive imports) must remain browser-API-free.
// If any file in the chain imports window/document/fetch, server-side scoring will crash.
import { calculateComplianceScore } from '../src/lib/cqc.js';
import { calculateGdprControlsScore } from '../src/lib/gdpr.js';
import { formatDate, parseDate, addDays } from '../shared/rotation.js';

// ── CQC Data Assembly ───────────────────────────────────────────────────────
// Gathers the same data shape that CQCEvidence.jsx builds client-side.

async function gatherCqcData(homeId, windowFrom, windowTo) {
  const home = await homeRepo.findById(homeId);
  if (!home) return null;

  // Use snapshot window for override data if provided; otherwise default to 6 months back / 3 months forward
  const anchor = windowTo ? new Date(windowTo + 'T00:00:00Z') : new Date();
  const from = windowFrom || new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 6, 1)).toISOString().slice(0, 10);
  const to = windowTo || new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 3, 0)).toISOString().slice(0, 10);

  const [
    staffResult, overrides, training, supervisions, appraisals,
    fireDrills, incidents, complaints, complaintSurveys,
    maintenance, ipcAudits, risks, policies,
    whistleblowing, dols, careCert, onboarding, cqcEvidence,
  ] = await Promise.all([
    staffRepo.findByHome(homeId),
    overrideRepo.findByHome(homeId, from, to),
    trainingRepo.findByHome(homeId),
    supervisionRepo.findByHome(homeId),
    appraisalRepo.findByHome(homeId),
    fireDrillRepo.findByHome(homeId),
    incidentRepo.findByHome(homeId, { limit: 500 }),
    complaintRepo.findByHome(homeId, { limit: 500 }),
    complaintSurveyRepo.findByHome(homeId),
    maintenanceRepo.findByHome(homeId),
    ipcRepo.findByHome(homeId, { limit: 500 }),
    riskRepo.findByHome(homeId),
    policyRepo.findByHome(homeId),
    whistleblowingRepo.findByHome(homeId),
    dolsRepo.findByHome(homeId),
    careCertRepo.findByHome(homeId),
    onboardingRepo.findByHome(homeId),
    cqcEvidenceRepo.findByHome(homeId, { limit: 500 }),
  ]);

  return {
    config: home.config || {},
    staff: staffResult.rows || staffResult || [],
    overrides: overrides || {},
    training: training || {},
    supervisions: supervisions?.rows || supervisions || {},
    appraisals: appraisals?.rows || appraisals || {},
    fire_drills: fireDrills || [],
    incidents: incidents?.rows || incidents || [],
    complaints: complaints?.rows || complaints || [],
    complaint_surveys: complaintSurveys?.rows || complaintSurveys || [],
    maintenance: maintenance?.rows || maintenance || [],
    ipc_audits: ipcAudits?.rows || ipcAudits || [],
    risk_register: risks?.rows || risks || [],
    policy_reviews: policies?.rows || policies || [],
    whistleblowing_concerns: whistleblowing?.rows || whistleblowing || [],
    dols: dols?.rows || dols || [],
    mca_assessments: [],
    care_certificate: careCert || {},
    onboarding: onboarding || {},
    cqc_evidence: cqcEvidence?.rows || cqcEvidence || [],
  };
}

// ── GDPR Data Assembly ──────────────────────────────────────────────────────

async function gatherGdprData(homeId) {
  const [requests, breaches, complaints, consent, retentionScanResult, ropa, dpia] = await Promise.all([
    gdprRepo.findRequests(homeId),
    gdprRepo.findBreaches(homeId),
    gdprRepo.findDPComplaints(homeId),
    gdprRepo.findConsent(homeId),
    scanRetention(homeId),
    ropaRepo.findAll(homeId),
    dpiaRepo.findAll(homeId),
  ]);

  return {
    requests: requests?.rows || [],
    breaches: breaches?.rows || [],
    complaints: complaints?.rows || [],
    consent: consent?.rows || [],
    retentionScan: retentionScanResult || [],
    ropa: ropa?.rows || [],
    dpia: dpia?.rows || [],
  };
}

// ── Compute Snapshot ────────────────────────────────────────────────────────

export async function computeSnapshot(homeId, engine, windowFrom, windowTo) {
  const today = formatDate(new Date());

  if (engine === 'cqc') {
    const data = await gatherCqcData(homeId, windowFrom, windowTo);
    if (!data) return null;
    // Honor explicit window dates if provided; otherwise default to 28 days ending today
    let dateRange;
    if (windowFrom && windowTo) {
      const from = parseDate(windowFrom);
      const to = parseDate(windowTo);
      const days = Math.round((to - from) / (1000 * 60 * 60 * 24)) + 1;
      dateRange = { from, to, days };
    } else {
      const to = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
      const from = addDays(to, -27);
      dateRange = { from, to, days: 28 };
    }
    // asOfDate = window end date (for historical snapshots) or today (for current snapshots)
    const asOfDate = windowTo || today;
    const result = calculateComplianceScore(data, dateRange, asOfDate);
    return {
      engine_version: result.engine_version,
      overall_score: result.overallScore,
      band: result.band.label,
      result,
    };
  }

  if (engine === 'gdpr') {
    const data = await gatherGdprData(homeId);
    const result = calculateGdprControlsScore(data);
    return {
      engine_version: result.engine_version,
      overall_score: result.overallScore,
      band: result.band.label,
      result,
    };
  }

  return null;
}
