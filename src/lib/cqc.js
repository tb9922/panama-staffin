// CQC Compliance Evidence — Scoring Engine & Evidence Aggregation

import { formatDate, parseDate, addDays, getStaffForDay, isCareRole, isWorkingShift } from './rotation.js';
import { getDayCoverageStatus, calculateDayCost, checkFatigueRisk } from './escalation.js';
import { getTrainingTypes, buildComplianceMatrix, getComplianceStats, TRAINING_STATUS, calculateSupervisionCompletionPct, getAppraisalStats, getFireDrillStatus } from './training.js';
import { ONBOARDING_SECTIONS, buildOnboardingMatrix, getOnboardingStats } from './onboarding.js';
import {
  calculateIncidentResponseTime, calculateCqcNotificationsPct,
  getSafeguardingIncidentStats, getIncidentTrendData, calculateActionCompletionRate,
} from './incidents.js';
import { calculateComplaintResolutionRate, calculateSatisfactionScore } from './complaints.js';
import { calculateMaintenanceCompliancePct } from './maintenance.js';
import { calculateIpcAuditCompliance } from './ipc.js';
import { calculateRiskManagementScore } from './riskRegister.js';
import { calculatePolicyCompliancePct } from './policyReview.js';
import { calculateSpeakUpCulture } from './whistleblowing.js';
import { calculateDolsCompliancePct } from './dols.js';
import { calculateCareCertCompletionPct } from './careCertificate.js';

// ── Engine Version ──────────────────────────────────────────────────────────
// Bump when the scoring model changes materially (metric weights, banding thresholds,
// aggregation method). Embedded in calculateComplianceScore return value so snapshots
// record which engine produced them.
export const ENGINE_VERSION = 'v2';

// ── Quality Statements ──────────────────────────────────────────────────────

// Aligned to CQC Single Assessment Framework (November 2023, operational April 2024).
// IDs use CQC's per-category numbering: S1-S8, E1-E6, C1-C5, R1-R5, WL1-WL10.
// QS references in cqcRef are the sequential CQC quality statement numbers (QS1-QS34).
// autoMetrics reference IDs handled by getEvidenceForStatement().
export const QUALITY_STATEMENTS = [
  // ── Safe (S1-S8) — Regulation 12, 13, 15, 18, 19 ──────────────────────────
  {
    id: 'S1', category: 'safe', name: 'Learning Culture',
    cqcRef: 'Regulation 12 — Safe Care & Treatment (QS1)',
    description: 'Learning from incidents, near misses, and safety events to improve safety',
    autoMetrics: ['incidentTrends', 'actionCompletionRate', 'incidentResponseTime', 'cqcNotifications'],
    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  },
  {
    id: 'S2', category: 'safe', name: 'Safe Systems, Pathways & Transitions',
    cqcRef: 'Regulation 12 — Safe Care & Treatment (QS2)',
    description: 'Safe admission, transfer, discharge, and referral processes',
    autoMetrics: [],
    icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
  },
  {
    id: 'S3', category: 'safe', name: 'Safeguarding',
    cqcRef: 'Regulation 13 — Safeguarding (QS3)',
    description: 'Safeguarding training, DBS checks, pre-employment vetting, referrals',
    autoMetrics: ['safeguardingTraining', 'dbsCompliance', 'incidentSafeguarding'],
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  },
  {
    id: 'S4', category: 'safe', name: 'Involving People to Manage Risks',
    cqcRef: 'Regulation 12 — Safe Care & Treatment (QS4)',
    description: 'Co-produced risk assessments, person-centred risk management',
    autoMetrics: ['riskManagementScore'],
    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  },
  {
    id: 'S5', category: 'safe', name: 'Safe Environments',
    cqcRef: 'Regulation 15 — Premises & Equipment (QS5)',
    description: 'Premises safety, fire drills, maintenance, equipment checks',
    autoMetrics: ['fireDrillCompliance', 'maintenanceCompliancePct'],
    icon: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z',
  },
  {
    id: 'S6', category: 'safe', name: 'Safe & Effective Staffing',
    cqcRef: 'Regulation 18 — Staffing / Regulation 19 — Fit & Proper Persons (QS6)',
    description: 'Staffing levels, training compliance, supervision, agency dependency, DBS, onboarding',
    autoMetrics: ['staffingFillRate', 'agencyDependency', 'trainingCompliance', 'supervisionCompletion', 'onboardingCompletion', 'careCertCompletion'],
    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0',
  },
  {
    id: 'S7', category: 'safe', name: 'Infection Prevention & Control',
    cqcRef: 'Regulation 12 — Safe Care & Treatment (QS7)',
    description: 'IPC audit scores, corrective actions, outbreak management',
    autoMetrics: ['ipcAuditCompliance'],
    icon: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z',
  },
  {
    id: 'S8', category: 'safe', name: 'Medicines Optimisation',
    cqcRef: 'Regulation 12 — Safe Care & Treatment (QS8)',
    description: 'Medicines management processes — requires eMAR clinical system',
    autoMetrics: [],
    icon: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z',
  },
  // ── Effective (E1-E6) — Regulation 9, 11, 12, 18 ──────────────────────────
  {
    id: 'E1', category: 'effective', name: 'Assessing Needs',
    cqcRef: 'Regulation 9 — Person-Centred Care (QS9)',
    description: 'Comprehensive needs assessment and care planning — requires DSCR',
    autoMetrics: [],
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  },
  {
    id: 'E2', category: 'effective', name: 'Delivering Evidence-Based Care',
    cqcRef: 'Regulation 12 — Safe Care & Treatment (QS10)',
    description: 'Evidence-based clinical practices and NICE guideline adherence',
    autoMetrics: [],
    icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  },
  {
    id: 'E3', category: 'effective', name: 'Staff Teams Working Together',
    cqcRef: 'Regulation 18 — Staffing (QS11)',
    description: 'Multi-disciplinary teamwork, supervision, appraisals, training development',
    autoMetrics: ['supervisionCompletion', 'appraisalCompletion', 'trainingCompliance'],
    icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  },
  {
    id: 'E4', category: 'effective', name: 'Supporting Healthier Lives',
    cqcRef: 'Regulation 9 — Person-Centred Care (QS12)',
    description: 'Health promotion and wellbeing support — requires clinical integration',
    autoMetrics: [],
    icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
  },
  {
    id: 'E5', category: 'effective', name: 'Monitoring & Improving Outcomes',
    cqcRef: 'Regulation 17 — Good Governance (QS13)',
    description: 'Quality monitoring, KPI tracking, outcome measurement',
    autoMetrics: ['sickRate', 'staffTurnover', 'trainingTrend'],
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  },
  {
    id: 'E6', category: 'effective', name: 'Consent to Care & Treatment',
    cqcRef: 'Regulation 11 — Need for Consent / MCA 2005 — DoLS (QS14)',
    description: 'DoLS/LPS authorisations, MCA assessments, consent processes',
    autoMetrics: ['dolsCompliancePct', 'mcaTrainingCompliance'],
    icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  },
  // ── Caring (C1-C5) — Regulation 9, 10 ─────────────────────────────────────
  {
    id: 'C1', category: 'caring', name: 'Kindness, Compassion & Dignity',
    cqcRef: 'Regulation 10 — Dignity & Respect (QS15)',
    description: 'Compassionate care, equality training, privacy, data protection',
    autoMetrics: ['equalityTrainingCompliance', 'dataProtectionTrainingCompliance'],
    icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
  },
  {
    id: 'C2', category: 'caring', name: 'Treating People as Individuals',
    cqcRef: 'Regulation 9 — Person-Centred Care (QS16)',
    description: 'Personalised care approaches — requires DSCR care plans',
    autoMetrics: [],
    icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  },
  {
    id: 'C3', category: 'caring', name: 'Independence, Choice & Control',
    cqcRef: 'Regulation 9 — Person-Centred Care (QS17)',
    description: 'Supporting people to make choices and maintain independence',
    autoMetrics: [],
    icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  },
  {
    id: 'C4', category: 'caring', name: 'Responding to People\'s Immediate Needs',
    cqcRef: 'Regulation 9 — Person-Centred Care (QS18)',
    description: 'Prompt response to changes in condition, pain, discomfort, and unmet needs',
    autoMetrics: [],
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
  },
  {
    id: 'C5', category: 'caring', name: 'Workforce Wellbeing & Enablement',
    cqcRef: 'Regulation 18 — Staffing (QS19)',
    description: 'Staff health and wellbeing support, supervision, appraisals, fatigue management',
    autoMetrics: ['supervisionCompletion', 'appraisalCompletion', 'sickRate', 'fatigueBreaches', 'staffTurnover'],
    icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
  },
  // ── Responsive (R1-R5) — Regulation 9, 10, 16 ─────────────────────────────
  {
    id: 'R1', category: 'responsive', name: 'Person-Centred Care',
    cqcRef: 'Regulation 9 — Person-Centred Care (QS20)',
    description: 'Evidence of individualised care planning and personal preference accommodation',
    autoMetrics: [],
    icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  },
  {
    id: 'R2', category: 'responsive', name: 'Care Provision, Integration & Continuity',
    cqcRef: 'Regulation 9 — Person-Centred Care (QS21)',
    description: 'Continuity of care, staff consistency, handover processes',
    autoMetrics: ['staffingFillRate'],
    icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  },
  {
    id: 'R3', category: 'responsive', name: 'Providing Information',
    cqcRef: 'Regulation 10 — Dignity & Respect (QS22)',
    description: 'Accessible information standard compliance',
    autoMetrics: [],
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    id: 'R4', category: 'responsive', name: 'Listening to & Involving People',
    cqcRef: 'Regulation 16 — Complaints (QS23)',
    description: 'Complaints handling, feedback mechanisms, response times, satisfaction',
    autoMetrics: ['complaintResolutionRate', 'satisfactionScore'],
    icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  },
  {
    id: 'R5', category: 'responsive', name: 'Equity in Access',
    cqcRef: 'Regulation 9 — Person-Centred Care (QS24)',
    description: 'Fair access to care regardless of protected characteristics',
    autoMetrics: ['equalityTrainingCompliance'],
    icon: 'M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3',
  },
  // ── Well-Led (WL1-WL10) — Regulation 17, 18 ───────────────────────────────
  {
    id: 'WL1', category: 'well-led', name: 'Shared Direction & Culture',
    cqcRef: 'Regulation 17 — Good Governance (QS25)',
    description: 'Organisational vision, values, and shared culture evidence',
    autoMetrics: [],
    icon: 'M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z',
  },
  {
    id: 'WL2', category: 'well-led', name: 'Capable, Compassionate & Inclusive Leaders',
    cqcRef: 'Regulation 17 — Good Governance (QS26)',
    description: 'Leadership competency, management development, appraisals',
    autoMetrics: ['appraisalCompletion'],
    icon: 'M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    id: 'WL3', category: 'well-led', name: 'Freedom to Speak Up',
    cqcRef: 'Regulation 17 — Good Governance (QS27)',
    description: 'Whistleblowing concern handling, investigation, and protection rates',
    autoMetrics: ['speakUpCulture'],
    icon: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z',
  },
  {
    id: 'WL4', category: 'well-led', name: 'Workforce Equality, Diversity & Inclusion',
    cqcRef: 'Regulation 18 — Staffing (QS28)',
    description: 'EDI training, staff engagement, sickness, fatigue, turnover',
    autoMetrics: ['equalityTrainingCompliance', 'sickRate', 'fatigueBreaches', 'staffTurnover'],
    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0',
  },
  {
    id: 'WL5', category: 'well-led', name: 'Governance, Management & Sustainability',
    cqcRef: 'Regulation 17 — Good Governance (QS29)',
    description: 'Governance frameworks, policy compliance, risk management, onboarding, audits',
    autoMetrics: ['policyCompliancePct', 'riskManagementScore', 'onboardingCompletion', 'actionCompletionRate'],
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  },
  {
    id: 'WL6', category: 'well-led', name: 'Partnerships & Communities',
    cqcRef: 'Regulation 17 — Good Governance (QS30)',
    description: 'Partnership working with other providers and local community',
    autoMetrics: [],
    icon: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9',
  },
  {
    id: 'WL7', category: 'well-led', name: 'Learning, Improvement & Innovation',
    cqcRef: 'Regulation 17 — Good Governance (QS31)',
    description: 'Continuous improvement, training trends, corrective actions',
    autoMetrics: ['trainingTrend', 'incidentTrends'],
    icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  },
  {
    id: 'WL8', category: 'well-led', name: 'Environmental Sustainability',
    cqcRef: 'Regulation 17 — Good Governance (QS32)',
    description: 'Environmental sustainability strategy, energy efficiency, waste reduction',
    autoMetrics: [],
    icon: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    id: 'WL9', category: 'well-led', name: 'Equity in Experiences & Outcomes',
    cqcRef: 'Regulation 9 — Person-Centred Care / Regulation 17 — Good Governance (QS33)',
    description: 'Equitable outcomes regardless of protected characteristics, reducing health inequalities',
    autoMetrics: ['equalityTrainingCompliance', 'satisfactionScore'],
    icon: 'M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3',
  },
  {
    id: 'WL10', category: 'well-led', name: 'Financial Sustainability & Business Continuity',
    cqcRef: 'Regulation 17 — Good Governance (QS34)',
    description: 'Financial oversight, viability planning, and business continuity for sustained care delivery',
    autoMetrics: [],
    icon: 'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z',
  },
];

// ── Metric Definitions ──────────────────────────────────────────────────────

// Each metric is assigned to a CQC key question. Per-question scores are computed
// as weighted averages within the question, then the overall band uses CQC's
// limiting-judgement aggregation rules (see applyLimitingJudgement below).
export const METRIC_DEFINITIONS = [
  // ── Safe (Reg 12, 13, 15, 18, 19) ──────────────────────────────────────────
  { id: 'staffingFillRate',        label: 'Staffing Fill Rate %',         weight: 0.12, question: 'safe',       available: true },
  { id: 'agencyDependency',        label: 'Agency Dependency %',          weight: 0.08, question: 'safe',       available: true },
  { id: 'incidentResponseTime',    label: 'Incident Response Time',       weight: 0.07, question: 'safe',       available: true },
  { id: 'cqcNotifications',        label: 'CQC Notifications on Time',    weight: 0.07, question: 'safe',       available: true },
  { id: 'fireDrillCompliance',     label: 'Fire Drill Compliance',        weight: 0.04, question: 'safe',       available: true },
  { id: 'maintenanceCompliancePct',label: 'Maintenance Compliance %',     weight: 0.05, question: 'safe',       available: true },
  { id: 'ipcAuditCompliance',      label: 'IPC Audit Compliance %',       weight: 0.05, question: 'safe',       available: true },
  // ── Effective (Reg 9, 17, 18) ───────────────────────────────────────────────
  { id: 'trainingCompliance',      label: 'Training Compliance %',        weight: 0.12, question: 'effective',  available: true },
  { id: 'supervisionCompletion',   label: 'Supervision Completion %',     weight: 0.07, question: 'effective',  available: true },
  { id: 'careCertCompletion',      label: 'Care Certificate Completion',  weight: 0.05, question: 'effective',  available: true },
  { id: 'appraisalCompletion',     label: 'Appraisal Completion %',       weight: 0.04, question: 'effective',  available: true },
  // ── Caring (Reg 9, 10, 11, 13) ─────────────────────────────────────────────
  { id: 'dolsCompliancePct',       label: 'DoLS Compliance %',            weight: 0.03, question: 'caring',     available: true },
  { id: 'satisfactionScore',       label: 'Satisfaction Score',           weight: 0.03, question: 'caring',     available: true },
  // ── Responsive (Reg 9, 16) ─────────────────────────────────────────────────
  { id: 'complaintResolutionRate', label: 'Complaint Resolution Rate',    weight: 0.05, question: 'responsive', available: true },
  // ── Well-Led (Reg 17) ──────────────────────────────────────────────────────
  { id: 'staffTurnover',           label: 'Staff Turnover Rate %',        weight: 0.05, question: 'well-led',   available: true },
  { id: 'riskManagementScore',     label: 'Risk Management Score',        weight: 0.03, question: 'well-led',   available: true },
  { id: 'policyCompliancePct',     label: 'Policy Compliance %',          weight: 0.03, question: 'well-led',   available: true },
  { id: 'speakUpCulture',          label: 'Speak Up Culture',             weight: 0.02, question: 'well-led',   available: true },
];

// CQC key questions for grouping
export const KEY_QUESTIONS = ['safe', 'effective', 'caring', 'responsive', 'well-led'];

// ── Score Banding ───────────────────────────────────────────────────────────

// CQC 4-point rating scale. Used for both per-question and overall scores.
export const SCORE_BANDS = [
  { min: 90, label: 'Outstanding',            color: 'green',  badgeKey: 'green'  },
  { min: 75, label: 'Good',                   color: 'blue',   badgeKey: 'blue'   },
  { min: 50, label: 'Requires Improvement',   color: 'amber',  badgeKey: 'amber'  },
  { min: 0,  label: 'Inadequate',             color: 'red',    badgeKey: 'red'    },
];

// ── Limiting Judgement ──────────────────────────────────────────────────────
// CQC overall rating aggregation rules (confirmed from CQC guidance):
// - Outstanding:          2+ Outstanding + remaining all Good
// - Good:                 No Inadequate AND max 1 Requires Improvement
// - Requires Improvement: 2+ Requires Improvement
// - Inadequate:           2+ Inadequate

export function applyLimitingJudgement(questionBands) {
  const counts = { Outstanding: 0, Good: 0, 'Requires Improvement': 0, Inadequate: 0 };
  for (const qb of Object.values(questionBands)) {
    counts[qb.label] = (counts[qb.label] || 0) + 1;
  }
  const total = Object.values(questionBands).length;

  // Inadequate: 2+ key questions rated Inadequate
  if (counts.Inadequate >= 2) return SCORE_BANDS[3]; // Inadequate
  // Requires Improvement: 2+ key questions rated RI, OR 1 Inadequate + 1+ RI
  if (counts['Requires Improvement'] >= 2 || (counts.Inadequate >= 1 && counts['Requires Improvement'] >= 1)) return SCORE_BANDS[2];
  // Outstanding: 2+ Outstanding AND rest all Good
  if (counts.Outstanding >= 2 && counts.Outstanding + counts.Good === total) return SCORE_BANDS[0];
  // Good: no Inadequate AND max 1 RI
  if (counts.Inadequate === 0 && counts['Requires Improvement'] <= 1) return SCORE_BANDS[1];
  // Default: Requires Improvement
  return SCORE_BANDS[2];
}

export function getScoreBand(score) {
  return SCORE_BANDS.find(b => score >= b.min) || SCORE_BANDS[SCORE_BANDS.length - 1];
}

// ── Date Range Helper ───────────────────────────────────────────────────────

export function getDateRange(days = 28) {
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = addDays(to, -(days - 1));
  return { from, to, days };
}

function dateRangeToDates(dateRange) {
  const dates = [];
  let d = new Date(dateRange.from);
  while (d <= dateRange.to) {
    dates.push(new Date(d));
    d = addDays(d, 1);
  }
  return dates;
}

// ── Data Defaults ───────────────────────────────────────────────────────────

export function ensureCqcDefaults(data) {
  if (data.cqc_evidence) return null;
  return { ...data, cqc_evidence: [] };
}

// ── Metric Calculations ─────────────────────────────────────────────────────

export function calculateTrainingCompliancePct(data, asOfDate) {
  const activeStaff = (data.staff || []).filter(s => s.active !== false);
  if (activeStaff.length === 0) return 100;
  const types = getTrainingTypes(data.config).filter(t => t.active);
  const matrix = buildComplianceMatrix(activeStaff, types, data.training || {}, asOfDate);
  const stats = getComplianceStats(matrix);
  return stats.compliancePct;
}

export function calculateTrainingBreakdown(data, asOfDate) {
  const activeStaff = (data.staff || []).filter(s => s.active !== false);
  const types = getTrainingTypes(data.config).filter(t => t.active);
  const matrix = buildComplianceMatrix(activeStaff, types, data.training || {}, asOfDate);
  const stats = getComplianceStats(matrix);

  // Per-type breakdown
  const perType = types.map(t => {
    let compliant = 0, expired = 0, notStarted = 0, total = 0;
    for (const s of activeStaff) {
      const result = matrix.get(s.id)?.get(t.id);
      if (!result || result.status === TRAINING_STATUS.NOT_REQUIRED) continue;
      total++;
      if (result.status === TRAINING_STATUS.COMPLIANT) compliant++;
      else if (result.status === TRAINING_STATUS.EXPIRED) expired++;
      else if (result.status === TRAINING_STATUS.NOT_STARTED) notStarted++;
    }
    return { id: t.id, name: t.name, legislation: t.legislation, compliant, expired, notStarted, total };
  });

  // Non-compliant staff list
  const nonCompliant = [];
  for (const s of activeStaff) {
    const staffMap = matrix.get(s.id);
    if (!staffMap) continue;
    for (const t of types) {
      const result = staffMap.get(t.id);
      if (!result) continue;
      if (result.status === TRAINING_STATUS.EXPIRED || result.status === TRAINING_STATUS.URGENT) {
        nonCompliant.push({
          staffName: s.name, staffRole: s.role,
          trainingName: t.name, status: result.status,
          daysUntilExpiry: result.daysUntilExpiry,
        });
      }
    }
  }

  return { stats, perType, nonCompliant, matrix };
}

export function calculateStaffingFillRate(data, dateRange) {
  const dates = dateRangeToDates(dateRange);
  let totalRequired = 0, totalFilled = 0, shortfallDays = 0;

  for (const date of dates) {
    const staffForDay = getStaffForDay(data.staff || [], date, data.overrides || {}, data.config);
    const status = getDayCoverageStatus(staffForDay, data.config);
    let dayShort = false;

    for (const period of ['early', 'late', 'night']) {
      const cov = status[period].coverage;
      const required = cov.required.heads;
      const actual = Math.min(cov.headCount, required);
      totalRequired += required;
      totalFilled += actual;
      if (cov.headGap > 0) dayShort = true;
    }
    if (dayShort) shortfallDays++;
  }

  const pct = totalRequired > 0 ? Math.round((totalFilled / totalRequired) * 100) : 100;
  return { pct, totalSlots: totalRequired, filledSlots: totalFilled, shortfallDays };
}

export function calculateAgencyDependencyPct(data, dateRange) {
  const dates = dateRangeToDates(dateRange);
  let totalCost = 0, agencyCost = 0;

  for (const date of dates) {
    const staffForDay = getStaffForDay(data.staff || [], date, data.overrides || {}, data.config);
    const cost = calculateDayCost(staffForDay, data.config);
    totalCost += cost.total;
    agencyCost += cost.agency;
  }

  const pct = totalCost > 0 ? Math.round((agencyCost / totalCost) * 1000) / 10 : 0;
  return { pct, agencyCost: Math.round(agencyCost), totalCost: Math.round(totalCost) };
}

export function calculateSafeguardingTrainingPct(data, asOfDate) {
  const activeStaff = (data.staff || []).filter(s => s.active !== false);
  if (activeStaff.length === 0) return 100;
  const allTypes = getTrainingTypes(data.config).filter(t => t.active);
  const sgTypes = allTypes.filter(t => t.id === 'safeguarding-adults' || t.id === 'safeguarding-children');
  if (sgTypes.length === 0) return 100;
  const matrix = buildComplianceMatrix(activeStaff, sgTypes, data.training || {}, asOfDate);
  const stats = getComplianceStats(matrix);
  return stats.compliancePct;
}

export function calculateDbsCompliancePct(data) {
  const activeStaff = (data.staff || []).filter(s => s.active !== false && isCareRole(s.role));
  if (activeStaff.length === 0) return 100;
  const onboarding = data.onboarding || {};
  let completed = 0;
  for (const s of activeStaff) {
    if (onboarding[s.id]?.dbs_check?.status === 'completed') completed++;
  }
  return Math.round((completed / activeStaff.length) * 100);
}

export function calculateOnboardingCompletionPct(data) {
  const activeStaff = (data.staff || []).filter(s => s.active !== false);
  if (activeStaff.length === 0) return 100;
  const matrix = buildOnboardingMatrix(activeStaff, ONBOARDING_SECTIONS, data.onboarding || {});
  const stats = getOnboardingStats(matrix);
  return stats.completionPct;
}

export function calculateSickRate(data, dateRange) {
  const dates = dateRangeToDates(dateRange);
  const activeStaff = (data.staff || []).filter(s => s.active !== false && isCareRole(s.role));
  let sickDays = 0, totalWorkingDays = 0;

  for (const date of dates) {
    const staffForDay = getStaffForDay(data.staff || [], date, data.overrides || {}, data.config);
    for (const s of activeStaff) {
      const entry = staffForDay.find(e => e.id === s.id);
      if (!entry) continue;
      // Count this as a scheduled working day if they were supposed to work or are sick
      if (isWorkingShift(entry.scheduledShift) || entry.shift === 'SICK') {
        totalWorkingDays++;
        if (entry.shift === 'SICK') sickDays++;
      }
    }
  }

  const pct = totalWorkingDays > 0 ? Math.round((sickDays / totalWorkingDays) * 1000) / 10 : 0;
  return { pct, sickDays, totalWorkingDays };
}

// ── New Metric Calculations ─────────────────────────────────────────────────

export function calculateFireDrillCompliancePct(data, asOfDate) {
  const status = getFireDrillStatus(data.fire_drills || [], asOfDate);
  // Score: 100 if up_to_date, 60 if due_soon, 30 if overdue, 0 if no records
  if (status.status === 'up_to_date') return 100;
  if (status.status === 'due_soon') return 60;
  if (status.status === 'overdue') return 30;
  return 0;
}

export function calculateAppraisalCompletionPct(data, asOfDate) {
  const activeStaff = (data.staff || []).filter(s => s.active !== false);
  if (activeStaff.length === 0) return 100;
  const stats = getAppraisalStats(activeStaff, data.appraisals || {}, asOfDate);
  return stats.completionPct;
}

export function calculateMcaTrainingCompliancePct(data, asOfDate) {
  const activeStaff = (data.staff || []).filter(s => s.active !== false);
  if (activeStaff.length === 0) return 100;
  const allTypes = getTrainingTypes(data.config).filter(t => t.active);
  const mcaTypes = allTypes.filter(t => t.id === 'mca-dols');
  if (mcaTypes.length === 0) return 100;
  const matrix = buildComplianceMatrix(activeStaff, mcaTypes, data.training || {}, asOfDate);
  const stats = getComplianceStats(matrix);
  return stats.compliancePct;
}

export function calculateEqualityTrainingPct(data, asOfDate) {
  const activeStaff = (data.staff || []).filter(s => s.active !== false);
  if (activeStaff.length === 0) return 100;
  const allTypes = getTrainingTypes(data.config).filter(t => t.active);
  const eqTypes = allTypes.filter(t => t.id === 'equality-diversity');
  if (eqTypes.length === 0) return 100;
  const matrix = buildComplianceMatrix(activeStaff, eqTypes, data.training || {}, asOfDate);
  const stats = getComplianceStats(matrix);
  return stats.compliancePct;
}

export function calculateDataProtectionTrainingPct(data, asOfDate) {
  const activeStaff = (data.staff || []).filter(s => s.active !== false);
  if (activeStaff.length === 0) return 100;
  const allTypes = getTrainingTypes(data.config).filter(t => t.active);
  const dpTypes = allTypes.filter(t => t.id === 'data-protection');
  if (dpTypes.length === 0) return 100;
  const matrix = buildComplianceMatrix(activeStaff, dpTypes, data.training || {}, asOfDate);
  const stats = getComplianceStats(matrix);
  return stats.compliancePct;
}

export function calculateFatigueBreachesPct(data, dateRange) {
  const dates = dateRangeToDates(dateRange);
  const activeStaff = (data.staff || []).filter(s => s.active !== false && isCareRole(s.role));
  if (activeStaff.length === 0) return 0;
  let breachCount = 0;
  // Check fatigue on last date of range
  const checkDate = dates[dates.length - 1] || new Date();
  for (const s of activeStaff) {
    const result = checkFatigueRisk(s, checkDate, data.overrides || {}, data.config);
    if (result.atRisk) breachCount++;
  }
  return Math.round((breachCount / activeStaff.length) * 100);
}

export function calculateStaffTurnover(data, dateRange) {
  const staff = data.staff || [];
  const fromStr = formatDate(dateRange.from);
  const toStr = formatDate(dateRange.to);
  const leavers = staff.filter(s => s.leaving_date && s.leaving_date >= fromStr && s.leaving_date <= toStr);
  const activeAtStart = staff.filter(s => s.active !== false || (s.leaving_date && s.leaving_date >= fromStr));
  const avgHeadcount = activeAtStart.length || 1;
  // Annualise: raw count over a short window (e.g. 28 days) is not comparable to CQC benchmarks
  // which use annual turnover figures. Multiply by (365 / periodDays) to get annualised rate.
  const fromDate = new Date(fromStr + 'T00:00:00Z');
  const toDate = new Date(toStr + 'T00:00:00Z');
  const periodDays = Math.max(1, Math.round((toDate - fromDate) / 86400000) + 1);
  const annualisedPct = Math.round((leavers.length / avgHeadcount) * (365 / periodDays) * 100);
  return { pct: annualisedPct, leavers: leavers.length, avgHeadcount, periodDays };
}

export function calculateTrainingTrend(data, asOfDate) {
  const currentPct = calculateTrainingCompliancePct(data, asOfDate);
  // Compare against 90 days ago
  const d = typeof asOfDate === 'string' ? parseDate(asOfDate) : new Date(asOfDate);
  const past = addDays(d, -90);
  const pastPct = calculateTrainingCompliancePct(data, past);
  const trend = currentPct - pastPct;
  return { currentPct, pastPct, trend };
}

// ── Per-metric Provenance, Confidence, and Evidence Summaries ────────────────

const METRIC_PROVENANCE = {
  trainingCompliance:      { source_modules: ['training'], evidence_category: 'management_info', assumptions: ['Training types from config trusted'], exclusions: [] },
  staffingFillRate:        { source_modules: ['rotation', 'escalation'], evidence_category: 'management_info', assumptions: ['minimum_staffing config trusted'], exclusions: ['Agency skill level not assessed'] },
  agencyDependency:        { source_modules: ['rotation', 'escalation'], evidence_category: 'management_info', assumptions: ['Agency rates from config'], exclusions: [] },
  incidentResponseTime:    { source_modules: ['incidents'], evidence_category: 'management_info', assumptions: ['Notification time based on date-only field'], exclusions: [] },
  cqcNotifications:        { source_modules: ['incidents'], evidence_category: 'management_info', assumptions: ['Deadline interpretation per Reg 18'], exclusions: [] },
  supervisionCompletion:   { source_modules: ['training'], evidence_category: 'management_info', assumptions: ['Supervision frequency from config'], exclusions: [] },
  staffTurnover:           { source_modules: ['rotation'], evidence_category: 'management_info', assumptions: ['Leaving date set on deactivation'], exclusions: [] },
  appraisalCompletion:     { source_modules: ['training'], evidence_category: 'management_info', assumptions: ['Annual cycle assumed'], exclusions: [] },
  fireDrillCompliance:     { source_modules: ['training'], evidence_category: 'management_info', assumptions: ['Quarterly = 91 days'], exclusions: [] },
  careCertCompletion:      { source_modules: ['careCertificate'], evidence_category: 'outcomes', assumptions: ['12-week completion target'], exclusions: [] },
  complaintResolutionRate: { source_modules: ['complaints'], evidence_category: 'outcomes', assumptions: ['Resolution = status closed/resolved'], exclusions: [] },
  maintenanceCompliancePct:{ source_modules: ['maintenance'], evidence_category: 'processes', assumptions: ['Frequency from check config'], exclusions: [] },
  ipcAuditCompliance:      { source_modules: ['ipc'], evidence_category: 'processes', assumptions: ['Quarterly audits expected'], exclusions: [] },
  dolsCompliancePct:       { source_modules: ['dols'], evidence_category: 'management_info', assumptions: ['Expiry dates accurate'], exclusions: [] },
  riskManagementScore:     { source_modules: ['riskRegister'], evidence_category: 'processes', assumptions: ['Review dates maintained'], exclusions: [] },
  policyCompliancePct:     { source_modules: ['policyReview'], evidence_category: 'processes', assumptions: ['Review frequency from policy config'], exclusions: [] },
  satisfactionScore:       { source_modules: ['complaints'], evidence_category: 'peoples_experience', assumptions: ['Survey responses representative'], exclusions: ['Response rate not factored'] },
  speakUpCulture:          { source_modules: ['whistleblowing'], evidence_category: 'feedback', assumptions: ['Anonymous concerns included'], exclusions: ['Protection rate N/A when all anonymous'] },
};

function deriveConfidence(metricId, raw, detail, data) {
  if (raw == null || (typeof raw === 'number' && isNaN(raw))) return 'not_evidenced';
  const activeStaff = (data?.staff || []).filter(s => s.active !== false);
  switch (metricId) {
    case 'trainingCompliance':
    case 'supervisionCompletion':
    case 'appraisalCompletion':
      return activeStaff.length === 0 ? 'not_evidenced' : 'high';
    case 'staffingFillRate':
      return (detail?.totalSlots || 0) > 0 ? 'high' : 'not_evidenced';
    case 'incidentResponseTime':
    case 'cqcNotifications':
      return (detail?.total || 0) > 0 ? 'high' : 'medium';
    case 'complaintResolutionRate':
      return (detail?.total || 0) > 0 ? 'high' : 'medium';
    case 'satisfactionScore':
      return (detail?.totalSent || detail?.responses || 0) > 0 ? 'high' : 'not_evidenced';
    case 'fireDrillCompliance':
      return (data?.fire_drills || []).length > 0 ? 'high' : 'not_evidenced';
    case 'ipcAuditCompliance':
      return (detail?.totalAudits || 0) >= 4 ? 'high' : (detail?.totalAudits || 0) > 0 ? 'medium' : 'not_evidenced';
    case 'maintenanceCompliancePct':
    case 'riskManagementScore':
    case 'policyCompliancePct':
      return (detail?.total || 0) > 0 ? 'high' : 'not_evidenced';
    case 'dolsCompliancePct':
      return (detail?.active || detail?.total || 0) > 0 ? 'high' : 'medium';
    case 'speakUpCulture':
      return (detail?.totalConcerns || 0) > 0 ? 'high' : 'medium';
    default:
      return raw > 0 ? 'medium' : 'low';
  }
}

function buildEvidenceSummary(metricId, raw, detail, dateRange) {
  const days = dateRange?.days || 28;
  switch (metricId) {
    case 'staffingFillRate': return `${detail?.filledSlots || 0}/${detail?.totalSlots || 0} slots filled over ${days} days; ${detail?.shortfallDays || 0} shortfall days`;
    case 'agencyDependency': return `Agency cost ${detail?.pct || 0}% of total staffing cost over ${days} days`;
    case 'incidentResponseTime': return `${detail?.onTime || 0}/${detail?.total || 0} notified on time`;
    case 'cqcNotifications': return `${detail?.onTime || 0}/${detail?.total || 0} within CQC deadline`;
    case 'staffTurnover': return `${detail?.leavers || 0} leavers, avg headcount ${detail?.avgHeadcount || 0} over ${days} days`;
    case 'complaintResolutionRate': return `${detail?.resolved || 0}/${detail?.total || 0} complaints resolved`;
    case 'ipcAuditCompliance': return `${detail?.totalAudits || 0} audits, avg score ${detail?.avgScore || 0}%`;
    case 'careCertCompletion': return `${detail?.completed || 0}/${detail?.total || 0} certificates completed`;
    default: return `${raw ?? 0}%`;
  }
}

// ── Composite Compliance Score ──────────────────────────────────────────────

export function calculateComplianceScore(data, dateRange, asOfDate) {
  const metrics = {};

  // Training compliance: direct %
  const trainingPct = calculateTrainingCompliancePct(data, asOfDate);
  metrics.trainingCompliance = { raw: trainingPct, score: trainingPct };

  // Staffing fill rate: direct %
  const fill = calculateStaffingFillRate(data, dateRange);
  metrics.staffingFillRate = { raw: fill.pct, score: fill.pct, detail: fill };

  // Agency dependency: inverse (lower is better)
  const agency = calculateAgencyDependencyPct(data, dateRange);
  metrics.agencyDependency = { raw: agency.pct, score: Math.max(0, Math.round(100 - agency.pct * 5)), detail: agency };

  // Incident response time: % notified within deadline
  const fromStr = formatDate(dateRange.from);
  const toStr = formatDate(dateRange.to);
  const irt = calculateIncidentResponseTime(data.incidents || [], fromStr, toStr);
  metrics.incidentResponseTime = { raw: irt.avgHours, score: irt.score, detail: irt };

  // CQC notifications on time: % notified within deadline
  const cqcn = calculateCqcNotificationsPct(data.incidents || [], fromStr, toStr);
  metrics.cqcNotifications = { raw: cqcn.score, score: cqcn.score, detail: cqcn };

  // Supervision completion: direct %
  const supPct = calculateSupervisionCompletionPct(data, asOfDate);
  metrics.supervisionCompletion = { raw: supPct, score: supPct };

  // Staff turnover: inverse (lower is better)
  const turnover = calculateStaffTurnover(data, dateRange);
  metrics.staffTurnover = { raw: turnover.pct, score: Math.max(0, 100 - turnover.pct * 5), detail: turnover };

  // Appraisal completion: direct %
  const aprPct = calculateAppraisalCompletionPct(data, asOfDate);
  metrics.appraisalCompletion = { raw: aprPct, score: aprPct };

  // Fire drill compliance: scored 0-100
  const firePct = calculateFireDrillCompliancePct(data, asOfDate);
  metrics.fireDrillCompliance = { raw: firePct, score: firePct };

  // Care Certificate completion: direct %
  const ccResult = calculateCareCertCompletionPct(data, asOfDate);
  metrics.careCertCompletion = { raw: ccResult.score, score: ccResult.score, detail: ccResult };

  // Complaint resolution rate: direct %
  const crr = calculateComplaintResolutionRate(data.complaints || [], fromStr, toStr);
  metrics.complaintResolutionRate = { raw: crr.score, score: crr.score, detail: crr };

  // Maintenance compliance: direct %
  const maint = calculateMaintenanceCompliancePct(data, asOfDate);
  metrics.maintenanceCompliancePct = { raw: maint.score, score: maint.score, detail: maint };

  // IPC audit compliance: direct %
  const ipc = calculateIpcAuditCompliance(data, asOfDate);
  metrics.ipcAuditCompliance = { raw: ipc.score, score: ipc.score, detail: ipc };

  // DoLS compliance: direct %
  const dols = calculateDolsCompliancePct(data, asOfDate);
  metrics.dolsCompliancePct = { raw: dols.score, score: dols.score, detail: dols };

  // Risk management score: direct %
  const risk = calculateRiskManagementScore(data, asOfDate);
  metrics.riskManagementScore = { raw: risk.score, score: risk.score, detail: risk };

  // Policy compliance: direct %
  const pol = calculatePolicyCompliancePct(data, asOfDate);
  metrics.policyCompliancePct = { raw: pol.score, score: pol.score, detail: pol };

  // Satisfaction score: direct %. null when no surveys — do not default to 100
  // (a false "perfect score" would inflate CQC caring scores when no data exists)
  const sat = calculateSatisfactionScore(data.complaint_surveys || [], fromStr, toStr);
  metrics.satisfactionScore = { raw: sat.score ?? null, score: sat.score ?? null, detail: sat };

  // Speak up culture: direct %
  const speakUp = calculateSpeakUpCulture(data, fromStr, toStr);
  metrics.speakUpCulture = { raw: speakUp.score, score: speakUp.score, detail: speakUp };

  // Enrich every metric with provenance, evidence summary, and confidence
  for (const [id, metric] of Object.entries(metrics)) {
    const prov = METRIC_PROVENANCE[id] || {};
    const metricDef = METRIC_DEFINITIONS.find(m => m.id === id);
    metric.weight = metricDef?.weight || 0;
    metric.source_modules = prov.source_modules || [];
    metric.evidence_category = prov.evidence_category || 'management_info';
    metric.evidence_summary = buildEvidenceSummary(id, metric.raw, metric.detail, dateRange);
    metric.assumptions = prov.assumptions || [];
    metric.exclusions = prov.exclusions || [];
    metric.confidence = deriveConfidence(id, metric.raw, metric.detail, data);
  }

  // ── Per-question scoring ─────────────────────────────────────────────────
  const availableMetrics = METRIC_DEFINITIONS.filter(m => m.available);
  const unavailableMetrics = METRIC_DEFINITIONS.filter(m => !m.available);
  const totalWeight = availableMetrics.reduce((s, m) => s + m.weight, 0);

  // Compute weighted average per key question.
  // Metrics with null scores (e.g. satisfactionScore when no surveys exist) are excluded
  // and their weight is redistributed among the scored metrics in that question.
  const questionScores = {};
  for (const q of KEY_QUESTIONS) {
    const qMetrics = availableMetrics.filter(m => m.question === q);
    if (qMetrics.length === 0) { questionScores[q] = { score: 0, band: SCORE_BANDS[3], metrics: [] }; continue; }
    const qScoredMetrics = qMetrics.filter(m => metrics[m.id]?.score != null);
    if (qScoredMetrics.length === 0) { questionScores[q] = { score: 0, band: SCORE_BANDS[3], metrics: qMetrics.map(m => m.id) }; continue; }
    const qScoredWeight = qScoredMetrics.reduce((s, m) => s + m.weight, 0);
    let qSum = 0;
    for (const m of qScoredMetrics) {
      qSum += metrics[m.id].score * (m.weight / qScoredWeight);
    }
    const qScore = Math.round(qSum);
    questionScores[q] = { score: qScore, band: getScoreBand(qScore), metrics: qMetrics.map(m => m.id) };
  }

  // Overall weighted score (kept for backward compat + numerical display).
  // Null-scored metrics are excluded and their weight redistributed.
  const scoredMetrics = availableMetrics.filter(m => metrics[m.id]?.score != null);
  const scoredWeight = scoredMetrics.reduce((s, m) => s + m.weight, 0);
  let weightedSum = 0;
  if (scoredWeight > 0) {
    for (const m of scoredMetrics) {
      weightedSum += metrics[m.id].score * (m.weight / scoredWeight);
    }
  }
  const overallScore = Math.round(weightedSum);

  // CQC limiting-judgement: overall band determined by key question band distribution
  const questionBands = {};
  for (const q of KEY_QUESTIONS) questionBands[q] = questionScores[q].band;
  const band = applyLimitingJudgement(questionBands);

  // Identify the limiting question(s) — which question(s) pulled the overall band down
  const limitingQuestions = KEY_QUESTIONS.filter(q => {
    const qBand = SCORE_BANDS.indexOf(questionScores[q].band);
    const overallBand = SCORE_BANDS.indexOf(band);
    return qBand >= overallBand && questionScores[q].band.label !== 'Outstanding';
  }).filter(q => questionScores[q].band.label === band.label || SCORE_BANDS.indexOf(questionScores[q].band) > SCORE_BANDS.indexOf(band));

  // Overall confidence: worst confidence across all metrics
  const CONFIDENCE_ORDER = ['not_evidenced', 'low', 'medium', 'high'];
  const overallConfidence = Object.values(metrics).reduce((worst, m) => {
    const idx = CONFIDENCE_ORDER.indexOf(m.confidence);
    const worstIdx = CONFIDENCE_ORDER.indexOf(worst);
    return idx !== -1 && idx < worstIdx ? m.confidence : worst;
  }, 'high');

  return {
    engine_version: ENGINE_VERSION, overallScore, band, confidence: overallConfidence,
    metrics, questionScores, limitingQuestions, availableMetrics, unavailableMetrics,
    availableWeight: totalWeight,
  };
}

// ── Evidence Aggregation Per Statement ──────────────────────────────────────

export function getEvidenceForStatement(statementId, data, dateRange, asOfDate) {
  const statement = QUALITY_STATEMENTS.find(q => q.id === statementId);
  if (!statement) return null;

  const autoEvidence = [];

  if (statement.autoMetrics.includes('trainingCompliance')) {
    autoEvidence.push({
      label: 'Training Compliance', value: calculateTrainingCompliancePct(data, asOfDate),
      unit: '%', source: 'Training Matrix',
    });
  }
  if (statement.autoMetrics.includes('staffingFillRate')) {
    const fill = calculateStaffingFillRate(data, dateRange);
    autoEvidence.push({
      label: 'Staffing Fill Rate', value: fill.pct, unit: '%',
      detail: `${fill.filledSlots}/${fill.totalSlots} slots filled, ${fill.shortfallDays} shortfall days`,
      source: 'Daily Coverage',
    });
  }
  if (statement.autoMetrics.includes('agencyDependency')) {
    const ag = calculateAgencyDependencyPct(data, dateRange);
    autoEvidence.push({
      label: 'Agency Cost Ratio', value: ag.pct, unit: '%',
      detail: `£${ag.agencyCost.toLocaleString()} of £${ag.totalCost.toLocaleString()} total`,
      source: 'Cost Tracker', lowerIsBetter: true,
    });
  }
  if (statement.autoMetrics.includes('safeguardingTraining')) {
    autoEvidence.push({
      label: 'Safeguarding Training Compliance', value: calculateSafeguardingTrainingPct(data, asOfDate),
      unit: '%', source: 'Training Matrix',
    });
  }
  if (statement.autoMetrics.includes('dbsCompliance')) {
    autoEvidence.push({
      label: 'DBS Check Completion', value: calculateDbsCompliancePct(data),
      unit: '%', source: 'Onboarding Tracker',
    });
  }
  if (statement.autoMetrics.includes('onboardingCompletion')) {
    autoEvidence.push({
      label: 'Staff Onboarding Completion', value: calculateOnboardingCompletionPct(data),
      unit: '%', source: 'Onboarding Tracker',
    });
  }
  if (statement.autoMetrics.includes('incidentSafeguarding')) {
    const sg = getSafeguardingIncidentStats(data.incidents || [], formatDate(dateRange.from), formatDate(dateRange.to));
    autoEvidence.push({
      label: 'Safeguarding Incidents', value: sg.total, unit: ' incidents',
      detail: `${sg.withReferral} referrals made (${sg.referralPct}%)`,
      source: 'Incident Tracker',
    });
  }
  if (statement.autoMetrics.includes('incidentTrends')) {
    const trends = getIncidentTrendData(data.incidents || [], formatDate(dateRange.from), formatDate(dateRange.to));
    const totalInPeriod = trends.monthlyTrend.reduce((s, m) => s + m.count, 0);
    autoEvidence.push({
      label: 'Incident Volume', value: totalInPeriod, unit: ' incidents',
      detail: `${trends.monthlyTrend.length} months tracked`,
      source: 'Incident Tracker', lowerIsBetter: true,
    });
  }
  if (statement.autoMetrics.includes('supervisionCompletion')) {
    const supPct = calculateSupervisionCompletionPct(data, asOfDate);
    autoEvidence.push({
      label: 'Supervision Completion', value: supPct,
      unit: '%', source: 'Training Matrix',
    });
  }
  if (statement.autoMetrics.includes('sickRate')) {
    const sick = calculateSickRate(data, dateRange);
    autoEvidence.push({
      label: 'Sickness Rate', value: sick.pct, unit: '%',
      detail: `${sick.sickDays} sick days / ${sick.totalWorkingDays} scheduled`,
      source: 'Sick Trends', lowerIsBetter: true,
    });
  }
  if (statement.autoMetrics.includes('fireDrillCompliance')) {
    const fdPct = calculateFireDrillCompliancePct(data, asOfDate);
    const fdStatus = getFireDrillStatus(data.fire_drills || [], asOfDate);
    autoEvidence.push({
      label: 'Fire Drill Compliance', value: fdPct, unit: '%',
      detail: `${fdStatus.drillsThisYear || 0} drills this year, avg ${fdStatus.avgEvacTime || '-'}s evacuation`,
      source: 'Fire Drills',
    });
  }
  if (statement.autoMetrics.includes('actionCompletionRate')) {
    const fromStr = formatDate(dateRange.from);
    const toStr = formatDate(dateRange.to);
    const acr = calculateActionCompletionRate(data.incidents || [], fromStr, toStr);
    autoEvidence.push({
      label: 'Action Completion Rate', value: acr.completionPct, unit: '%',
      detail: `${acr.completed}/${acr.total} actions completed, ${acr.overdue} overdue`,
      source: 'Incident Tracker',
    });
  }
  if (statement.autoMetrics.includes('appraisalCompletion')) {
    const aprPct = calculateAppraisalCompletionPct(data, asOfDate);
    autoEvidence.push({
      label: 'Appraisal Completion', value: aprPct, unit: '%',
      source: 'Training Matrix',
    });
  }
  if (statement.autoMetrics.includes('mcaTrainingCompliance')) {
    const mcaPct = calculateMcaTrainingCompliancePct(data, asOfDate);
    autoEvidence.push({
      label: 'MCA/DoLS Training Compliance', value: mcaPct, unit: '%',
      source: 'Training Matrix',
    });
  }
  if (statement.autoMetrics.includes('equalityTrainingCompliance')) {
    const eqPct = calculateEqualityTrainingPct(data, asOfDate);
    autoEvidence.push({
      label: 'Equality & Diversity Training', value: eqPct, unit: '%',
      source: 'Training Matrix',
    });
  }
  if (statement.autoMetrics.includes('dataProtectionTrainingCompliance')) {
    const dpPct = calculateDataProtectionTrainingPct(data, asOfDate);
    autoEvidence.push({
      label: 'Data Protection Training', value: dpPct, unit: '%',
      source: 'Training Matrix',
    });
  }
  if (statement.autoMetrics.includes('fatigueBreaches')) {
    const fbPct = calculateFatigueBreachesPct(data, dateRange);
    autoEvidence.push({
      label: 'Staff at Fatigue Risk', value: fbPct, unit: '%',
      source: 'Fatigue Tracker', lowerIsBetter: true,
    });
  }
  if (statement.autoMetrics.includes('staffTurnover')) {
    const to = calculateStaffTurnover(data, dateRange);
    autoEvidence.push({
      label: 'Staff Turnover', value: to.pct, unit: '%',
      detail: `${to.leavers} leavers / ${to.avgHeadcount} headcount`,
      source: 'Staff Register', lowerIsBetter: true,
    });
  }
  if (statement.autoMetrics.includes('trainingTrend')) {
    const tt = calculateTrainingTrend(data, asOfDate);
    autoEvidence.push({
      label: 'Training Trend (90-day)', value: tt.trend >= 0 ? `+${tt.trend}` : `${tt.trend}`, unit: 'pp',
      detail: `${tt.pastPct}% → ${tt.currentPct}%`,
      source: 'Training Matrix',
    });
  }
  if (statement.autoMetrics.includes('ipcAuditCompliance')) {
    const ipc = calculateIpcAuditCompliance(data, asOfDate);
    autoEvidence.push({
      label: 'IPC Audit Compliance', value: ipc.score, unit: '%',
      detail: `${ipc.totalAudits} audits in last 12 months`,
      source: 'IPC Audits',
    });
  }
  if (statement.autoMetrics.includes('dolsCompliancePct')) {
    const dols = calculateDolsCompliancePct(data, asOfDate);
    autoEvidence.push({
      label: 'DoLS/LPS Compliance', value: dols.score, unit: '%',
      detail: `${dols.active} active, ${dols.expired} expired of ${dols.total}`,
      source: 'DoLS Tracker',
    });
  }
  if (statement.autoMetrics.includes('complaintResolutionRate')) {
    const fromStr2 = formatDate(dateRange.from);
    const toStr2 = formatDate(dateRange.to);
    const crr = calculateComplaintResolutionRate(data.complaints || [], fromStr2, toStr2);
    autoEvidence.push({
      label: 'Complaint Resolution Rate', value: crr.score, unit: '%',
      detail: `${crr.resolved}/${crr.total} resolved`,
      source: 'Complaints Tracker',
    });
  }
  if (statement.autoMetrics.includes('satisfactionScore')) {
    const fromStr2 = formatDate(dateRange.from);
    const toStr2 = formatDate(dateRange.to);
    const sat = calculateSatisfactionScore(data.complaint_surveys || [], fromStr2, toStr2);
    autoEvidence.push({
      label: 'Satisfaction Score', value: sat.avgScore ?? 'N/A', unit: sat.avgScore ? '/5' : '',
      detail: `${sat.totalSurveys} surveys`,
      source: 'Complaints Tracker',
    });
  }
  if (statement.autoMetrics.includes('speakUpCulture')) {
    const fromStr2 = formatDate(dateRange.from);
    const toStr2 = formatDate(dateRange.to);
    const su = calculateSpeakUpCulture(data, fromStr2, toStr2);
    autoEvidence.push({
      label: 'Speak Up Culture Score', value: su.score, unit: '%',
      detail: `${su.totalConcerns} concerns, ${su.resolutionRate}% resolved${su.protectionRate != null ? `, ${su.protectionRate}% protected` : ''}`,
      source: 'Whistleblowing Tracker',
    });
  }
  if (statement.autoMetrics.includes('maintenanceCompliancePct')) {
    const maint = calculateMaintenanceCompliancePct(data, asOfDate);
    autoEvidence.push({
      label: 'Maintenance Compliance', value: maint.score, unit: '%',
      detail: `${maint.compliant} compliant, ${maint.overdue} overdue of ${maint.total}`,
      source: 'Maintenance Tracker',
    });
  }
  if (statement.autoMetrics.includes('incidentResponseTime')) {
    const fromStr = formatDate(dateRange.from);
    const toStr = formatDate(dateRange.to);
    const irt = calculateIncidentResponseTime(data.incidents || [], fromStr, toStr);
    autoEvidence.push({
      label: 'Incident Response Time', value: irt.score, unit: '%',
      detail: `${irt.onTime}/${irt.total} notified on time`,
      source: 'Incident Tracker',
    });
  }
  if (statement.autoMetrics.includes('cqcNotifications')) {
    const fromStr = formatDate(dateRange.from);
    const toStr = formatDate(dateRange.to);
    const cqcn = calculateCqcNotificationsPct(data.incidents || [], fromStr, toStr);
    autoEvidence.push({
      label: 'CQC Notifications on Time', value: cqcn.score, unit: '%',
      detail: `${cqcn.onTime}/${cqcn.total} within deadline`,
      source: 'Incident Tracker',
    });
  }
  if (statement.autoMetrics.includes('careCertCompletion')) {
    const ccScore = calculateCareCertCompletionPct(data, asOfDate);
    autoEvidence.push({
      label: 'Care Certificate Completion', value: typeof ccScore === 'object' ? ccScore.score : ccScore, unit: '%',
      source: 'Care Certificate Tracker',
    });
  }
  if (statement.autoMetrics.includes('riskManagementScore')) {
    const risk = calculateRiskManagementScore(data, asOfDate);
    autoEvidence.push({
      label: 'Risk Management Score', value: risk.score, unit: '%',
      source: 'Risk Register',
    });
  }
  if (statement.autoMetrics.includes('policyCompliancePct')) {
    const pol = calculatePolicyCompliancePct(data, asOfDate);
    autoEvidence.push({
      label: 'Policy Compliance', value: pol.score, unit: '%',
      source: 'Policy Review Tracker',
    });
  }

  const manualEvidence = (data.cqc_evidence || []).filter(e => e.quality_statement === statementId);

  return { statement, autoEvidence, manualEvidence };
}

// ── Coverage Detail for PDF ─────────────────────────────────────────────────

export function getCoverageSummary(data, dateRange) {
  const dates = dateRangeToDates(dateRange);
  const rows = [];
  for (const date of dates) {
    const staffForDay = getStaffForDay(data.staff || [], date, data.overrides || {}, data.config);
    const status = getDayCoverageStatus(staffForDay, data.config);
    rows.push({
      date: formatDate(date),
      early: { actual: status.early.coverage.headCount, required: status.early.coverage.required.heads, level: status.early.escalation.level },
      late: { actual: status.late.coverage.headCount, required: status.late.coverage.required.heads, level: status.late.escalation.level },
      night: { actual: status.night.coverage.headCount, required: status.night.coverage.required.heads, level: status.night.escalation.level },
      worst: status.overallLevel,
    });
  }
  return rows;
}

// ── DBS Status for PDF ──────────────────────────────────────────────────────

export function getDbsStatusList(data) {
  const activeStaff = (data.staff || []).filter(s => s.active !== false && isCareRole(s.role));
  const onboarding = data.onboarding || {};
  return activeStaff.map(s => {
    const dbs = onboarding[s.id]?.dbs_check;
    const rtw = onboarding[s.id]?.right_to_work;
    return {
      name: s.name, role: s.role,
      dbsStatus: dbs?.status === 'completed' ? 'Clear' : dbs?.status === 'in_progress' ? 'In Progress' : 'Missing',
      dbsNumber: dbs?.dbs_number ? '***' + dbs.dbs_number.slice(-4) : '-',
      barredListChecked: dbs?.afl_status === 'clear' ? 'Yes' : 'No',
      rtwExpiry: rtw?.expiry_date || '-',
    };
  });
}

// ── Fatigue Summary for PDF ─────────────────────────────────────────────────

export function getFatigueSummary(data) {
  const activeStaff = (data.staff || []).filter(s => s.active !== false && isCareRole(s.role));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const atRisk = [];
  for (const s of activeStaff) {
    const result = checkFatigueRisk(s, today, data.overrides || {}, data.config);
    if (result.atRisk) {
      atRisk.push({ name: s.name, role: s.role, consecutive: result.consecutive, exceeded: result.exceeded });
    }
  }
  return atRisk;
}
