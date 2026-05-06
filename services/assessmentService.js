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
import * as cqcEvidenceLinksRepo from '../repositories/cqcEvidenceLinksRepo.js';
import * as cqcNarrativeRepo from '../repositories/cqcNarrativeRepo.js';
import * as gdprRepo from '../repositories/gdprRepo.js';
import * as ropaRepo from '../repositories/ropaRepo.js';
import * as dpiaRepo from '../repositories/dpiaRepo.js';
import { scanRetention } from './gdprService.js';

// Scoring engines — pure functions, no browser APIs.
// CONSTRAINT: these files (and their transitive imports) must remain browser-API-free.
// If any file in the chain imports window/document/fetch, server-side scoring will crash.
import { calculateComplianceScore, getDateRange } from '../src/lib/cqc.js';
import {
  buildReadinessMatrix,
  getQuestionReadiness,
  getOverallReadiness,
  getReadinessGaps,
  serialiseReadinessMatrix,
} from '../src/lib/cqcReadiness.js';
import { calculateGdprControlsScore } from '../src/lib/gdpr.js';
import { formatDate, parseDate, addDays } from '../shared/rotation.js';
import { endOfLocalMonthISO, startOfLocalMonthISO, todayLocalISO } from '../lib/dateOnly.js';

const ASSESSMENT_PAGE_SIZE = 500;
const CQC_HR_SOURCE_MODULES = new Set([
  'onboarding',
  'care_certificate',
  'whistleblowing',
  'dols',
  'mca_assessment',
  'hr_disciplinary',
  'hr_grievance',
  'hr_performance',
  'hr_rtw_interview',
  'hr_oh_referral',
  'hr_contract',
  'hr_family_leave',
  'hr_flexible_working',
  'hr_edi',
  'hr_tupe',
  'hr_renewal',
]);
const CQC_SOURCE_MODULES = [
  'incident',
  'complaint',
  'training_record',
  'supervision',
  'appraisal',
  'fire_drill',
  'ipc_audit',
  'maintenance',
  'risk',
  'policy_review',
  'whistleblowing',
  'dols',
  'mca_assessment',
  'cqc_evidence',
  'cqc_partner_feedback',
  'cqc_observation',
  'handover',
  'onboarding',
  'care_certificate',
  'hr_disciplinary',
  'hr_grievance',
  'hr_performance',
  'hr_rtw_interview',
  'hr_oh_referral',
  'hr_contract',
  'hr_family_leave',
  'hr_flexible_working',
  'hr_edi',
  'hr_tupe',
  'hr_renewal',
];
export const CQC_NON_HR_SOURCE_MODULES = CQC_SOURCE_MODULES.filter((module) => !CQC_HR_SOURCE_MODULES.has(module));

function filterCqcDataForSourceVisibility(data, { cqcEvidenceLinkSourceModules } = {}) {
  if (!cqcEvidenceLinkSourceModules) return data;
  return {
    ...data,
    whistleblowing_concerns: [],
    dols: [],
    mca_assessments: [],
    onboarding: {},
    care_certificate: {},
  };
}

function mergePagedRows(target, pageRows) {
  if (Array.isArray(pageRows)) {
    target.push(...pageRows);
    return pageRows.length;
  }
  let count = 0;
  for (const [key, value] of Object.entries(pageRows || {})) {
    if (Array.isArray(value)) {
      target[key] = [...(target[key] || []), ...value];
      count += value.length;
    } else {
      target[key] = { ...(target[key] || {}), ...(value || {}) };
      count += Object.keys(value || {}).length;
    }
  }
  return count;
}

async function loadAllPages(findPage, seed) {
  const rows = Array.isArray(seed) ? [] : {};
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const result = await findPage({ limit: ASSESSMENT_PAGE_SIZE, offset });
    const pageRows = result?.rows ?? result ?? [];
    const pageCount = mergePagedRows(rows, pageRows);
    const loadedCount = offset + pageCount;
    total = Number.isFinite(Number(result?.total)) ? Number(result.total) : loadedCount;
    if (pageCount === 0 || loadedCount >= total) break;
    offset = loadedCount;
  }
  return rows;
}

// ── CQC Data Assembly ───────────────────────────────────────────────────────
// Gathers the same data shape that CQCEvidence.jsx builds client-side.

async function gatherCqcData(homeId, windowFrom, windowTo, { cqcEvidenceLinkSourceModules } = {}) {
  const home = await homeRepo.findById(homeId);
  if (!home) return null;

  // Use snapshot window for override data if provided; otherwise default to 6 months back / 3 months forward
  const anchor = windowTo ? new Date(`${windowTo}T00:00:00Z`) : new Date();
  const from = windowFrom || startOfLocalMonthISO(anchor, -6);
  const to = windowTo || endOfLocalMonthISO(anchor, 2);

  const [
    staffResult, overrides, training, supervisions, appraisals,
    fireDrills, incidents, complaints, complaintSurveys,
    maintenance, ipcAudits, risks, policies,
    whistleblowing, dols, mcaAssessments, careCert, onboarding, cqcEvidence, cqcEvidenceLinks, cqcNarratives,
  ] = await Promise.all([
    staffRepo.findByHome(homeId, { limit: 5000 }),
    overrideRepo.findByHome(homeId, from, to),
    loadAllPages((pg) => trainingRepo.findByHome(homeId, pg), {}),
    loadAllPages((pg) => supervisionRepo.findByHome(homeId, pg), {}),
    loadAllPages((pg) => appraisalRepo.findByHome(homeId, pg), {}),
    fireDrillRepo.findByHome(homeId),
    loadAllPages((pg) => incidentRepo.findByHome(homeId, pg), []),
    loadAllPages((pg) => complaintRepo.findByHome(homeId, pg), []),
    loadAllPages((pg) => complaintSurveyRepo.findByHome(homeId, pg), []),
    loadAllPages((pg) => maintenanceRepo.findByHome(homeId, pg), []),
    loadAllPages((pg) => ipcRepo.findByHome(homeId, pg), []),
    loadAllPages((pg) => riskRepo.findByHome(homeId, pg), []),
    loadAllPages((pg) => policyRepo.findByHome(homeId, pg), []),
    loadAllPages((pg) => whistleblowingRepo.findByHome(homeId, pg), []),
    loadAllPages((pg) => dolsRepo.findByHome(homeId, pg), []),
    loadAllPages((pg) => dolsRepo.findMcaByHome(homeId, pg), []),
    careCertRepo.findByHome(homeId),
    onboardingRepo.findByHome(homeId),
    loadAllPages((pg) => cqcEvidenceRepo.findByHome(homeId, pg), []),
    cqcEvidenceLinksRepo.findAllByHome(homeId, { sourceModules: cqcEvidenceLinkSourceModules }),
    cqcNarrativeRepo.findByHome(homeId),
  ]);

  return {
    config: home.config || {},
    staff: staffResult.rows || staffResult || [],
    overrides: overrides || {},
    training: training || {},
    supervisions: supervisions || {},
    appraisals: appraisals || {},
    fire_drills: fireDrills || [],
    incidents: incidents || [],
    complaints: complaints || [],
    complaint_surveys: complaintSurveys || [],
    maintenance: maintenance || [],
    ipc_audits: ipcAudits || [],
    risk_register: risks || [],
    policy_reviews: policies || [],
    whistleblowing_concerns: whistleblowing || [],
    dols: dols || [],
    mca_assessments: mcaAssessments || [],
    care_certificate: careCert || {},
    onboarding: onboarding || {},
    cqc_evidence: cqcEvidence || [],
    cqc_evidence_links: cqcEvidenceLinks || [],
    cqc_statement_narratives: cqcNarratives || [],
  };
}

function buildReadinessPayload(data, dateRange, asOfDate) {
  const readinessMatrix = buildReadinessMatrix(data, dateRange, asOfDate);
  return {
    entries: serialiseReadinessMatrix(readinessMatrix),
    questionSummary: getQuestionReadiness(readinessMatrix),
    overall: getOverallReadiness(readinessMatrix),
    gaps: getReadinessGaps(readinessMatrix),
    computedAt: asOfDate,
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

export async function computeSnapshot(homeId, engine, windowFrom, windowTo, options = {}) {
  const today = todayLocalISO();

  if (engine === 'cqc') {
    const gatheredData = await gatherCqcData(homeId, windowFrom, windowTo, options);
    if (!gatheredData) return null;
    const data = filterCqcDataForSourceVisibility(gatheredData, options);
    // Honor explicit window dates if provided; otherwise default to 28 days ending today
    let dateRange;
    if (windowFrom && windowTo) {
      const from = parseDate(windowFrom);
      const to = parseDate(windowTo);
      const days = Math.round((to - from) / (1000 * 60 * 60 * 24)) + 1;
      dateRange = { from, to, days };
    } else {
      const to = parseDate(today);
      const from = addDays(to, -27);
      dateRange = { from, to, days: 28 };
    }
    // asOfDate = window end date (for historical snapshots) or today (for current snapshots)
    const asOfDate = windowTo || today;
    const result = calculateComplianceScore(data, dateRange, asOfDate);
    const readiness = buildReadinessPayload(data, dateRange, asOfDate);
    return {
      engine_version: result.engine_version,
      overall_score: result.overallScore,
      band: result.band.label,
      result: {
        ...result,
        evidencePackMeta: {
          window_from: formatDate(dateRange.from),
          window_to: formatDate(dateRange.to),
          date_range_days: dateRange.days,
          as_of_date: asOfDate,
        },
        evidencePackData: data,
        readiness,
      },
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

export async function computeCqcReadiness(homeId, dateRangeDays = 28, asOfDate = todayLocalISO(), options = {}) {
  const dateRange = getDateRange(dateRangeDays);
  const gatheredData = await gatherCqcData(homeId, formatDate(dateRange.from), formatDate(dateRange.to), options);
  if (!gatheredData) return null;
  const data = filterCqcDataForSourceVisibility(gatheredData, options);
  return buildReadinessPayload(data, dateRange, asOfDate);
}
