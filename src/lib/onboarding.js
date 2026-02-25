import { formatDate, parseDate, CARE_ROLES } from './rotation.js';

// ── Onboarding Sections ──────────────────────────────────────────────────────

export const ONBOARDING_SECTIONS = [
  { id: 'dbs_check', name: 'Enhanced DBS Check', category: 'pre-employment', mandatory: true, legislation: 'Care Standards Act 2000 / CQC Reg 19' },
  { id: 'right_to_work', name: 'Right to Work', category: 'pre-employment', mandatory: true, legislation: 'Immigration, Asylum & Nationality Act 2006' },
  { id: 'references', name: 'References (min 2)', category: 'pre-employment', mandatory: true, legislation: 'CQC Reg 19 Schedule 3' },
  { id: 'identity_check', name: 'Identity Verification', category: 'pre-employment', mandatory: true, legislation: 'CQC Reg 19' },
  { id: 'health_declaration', name: 'Health Declaration', category: 'pre-employment', mandatory: true, legislation: 'CQC Reg 19' },
  { id: 'qualifications', name: 'Qualifications', category: 'pre-employment', mandatory: true, legislation: 'CQC Reg 19' },
  { id: 'contract', name: 'Contract of Employment', category: 'pre-employment', mandatory: true, legislation: 'Employment Rights Act 1996 s.1' },
  { id: 'employment_history', name: 'Employment History', category: 'pre-employment', mandatory: true, legislation: 'Schedule 3 Para 7 — SI 2014/2936' },
  { id: 'day1_induction', name: 'Day 1 Induction', category: 'induction', mandatory: true, legislation: 'CQC Reg 18' },
  { id: 'policy_acknowledgement', name: 'Policy Acknowledgement', category: 'induction', mandatory: true, legislation: 'CQC Reg 18' },
];

export const ONBOARDING_STATUS = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
};

export const STATUS_DISPLAY = {
  not_started:  { label: 'Not Started',  badgeKey: 'red',   color: 'text-red-600' },
  in_progress:  { label: 'In Progress',  badgeKey: 'amber', color: 'text-amber-600' },
  completed:    { label: 'Completed',    badgeKey: 'green', color: 'text-emerald-600' },
};

export const DBS_DISCLOSURE_LEVELS = ['enhanced', 'standard', 'basic'];
export const DBS_STATUSES = ['clear', 'content', 'pending'];
export const ADULT_FIRST_STATUSES = ['clear', 'wait', 'not_used'];
export const CONTRACT_TYPES = ['permanent', 'fixed', 'bank', 'zero-hours', 'volunteer'];
export const DBS_RISK_DECISIONS = ['approved_to_work', 'pending_review', 'not_approved'];
export const ID_TYPES = ['passport', 'driving_licence', 'biometric_residence_permit', 'national_id'];
export const ADDRESS_PROOF_TYPES = ['utility_bill', 'bank_statement', 'council_tax', 'tenancy_agreement'];
export const DOC_TYPES = ['passport', 'biometric_residence_permit', 'share_code', 'national_insurance'];

export const DAY1_ITEMS = [
  { id: 'fire_safety_orientation', label: 'Fire Safety Orientation' },
  { id: 'emergency_procedures', label: 'Emergency Procedures' },
  { id: 'safeguarding_briefing', label: 'Safeguarding Briefing' },
  { id: 'moving_handling_basics', label: 'Moving & Handling Basics' },
  { id: 'infection_control', label: 'Infection Prevention & Control' },
  { id: 'building_orientation', label: 'Building Orientation' },
  { id: 'it_system_induction', label: 'IT System Induction' },
];

export const POLICY_ITEMS = [
  { id: 'safeguarding_policy', label: 'Safeguarding Adults' },
  { id: 'whistleblowing_policy', label: 'Whistleblowing' },
  { id: 'data_protection_policy', label: 'Data Protection & GDPR' },
  { id: 'social_media_policy', label: 'Social Media & Photography' },
  { id: 'code_of_conduct', label: 'Code of Conduct' },
  { id: 'complaints_procedure', label: 'Complaints Procedure' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

export function ensureOnboardingDefaults(data) {
  if (data.onboarding) return null;
  return { ...data, onboarding: {} };
}

/**
 * Get the status of a single onboarding section for a staff member.
 */
export function getOnboardingStatus(staffId, sectionId, onboardingData) {
  const record = onboardingData?.[staffId]?.[sectionId];
  if (!record) return { status: ONBOARDING_STATUS.NOT_STARTED, record: null };
  return { status: record.status || ONBOARDING_STATUS.NOT_STARTED, record };
}

/**
 * Build the full onboarding matrix: Map<staffId, Map<sectionId, { status, record }>>
 */
export function buildOnboardingMatrix(activeStaff, sections, onboardingData) {
  const matrix = new Map();
  for (const s of activeStaff) {
    const staffMap = new Map();
    for (const sec of sections) {
      staffMap.set(sec.id, getOnboardingStatus(s.id, sec.id, onboardingData));
    }
    matrix.set(s.id, staffMap);
  }
  return matrix;
}

/**
 * Aggregate stats across the full matrix.
 */
export function getOnboardingStats(matrix) {
  let total = 0, completed = 0, inProgress = 0, notStarted = 0;
  for (const [, staffMap] of matrix) {
    for (const [, result] of staffMap) {
      total++;
      if (result.status === ONBOARDING_STATUS.COMPLETED) completed++;
      else if (result.status === ONBOARDING_STATUS.IN_PROGRESS) inProgress++;
      else notStarted++;
    }
  }
  const completionPct = total > 0 ? Math.round((completed / total) * 100) : 100;
  return { total, completed, inProgress, notStarted, completionPct };
}

/**
 * Get progress for a single staff member.
 */
export function getStaffOnboardingProgress(staffId, onboardingData) {
  const sections = ONBOARDING_SECTIONS;
  let completed = 0;
  for (const sec of sections) {
    const record = onboardingData?.[staffId]?.[sec.id];
    if (record?.status === ONBOARDING_STATUS.COMPLETED) completed++;
  }
  return {
    completed,
    total: sections.length,
    pct: Math.round((completed / sections.length) * 100),
    isComplete: completed === sections.length,
  };
}

/**
 * Calculate days until a date string (positive = future, negative = past).
 */
export function getDaysUntilExpiry(dateStr) {
  if (!dateStr) return null;
  const d = parseDate(dateStr);
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Generate onboarding alerts for Dashboard and server warnings.
 */
export function getOnboardingAlerts(activeStaff, onboardingData) {
  const alerts = [];
  const todayStr = formatDate(new Date());

  for (const s of activeStaff) {
    const progress = getStaffOnboardingProgress(s.id, onboardingData);

    // DBS missing or pending
    const dbs = onboardingData?.[s.id]?.dbs_check;
    if (!dbs || dbs.status !== ONBOARDING_STATUS.COMPLETED) {
      alerts.push({ type: 'error', msg: `${s.name}: DBS check ${dbs ? 'incomplete' : 'missing'}` });
    }

    // RTW expiry approaching
    const rtw = onboardingData?.[s.id]?.right_to_work;
    if (rtw?.expiry_date) {
      const days = getDaysUntilExpiry(rtw.expiry_date);
      if (days !== null && days <= 60 && days >= 0) {
        alerts.push({ type: 'warning', msg: `${s.name}: Right to Work expires in ${days} days` });
      } else if (days !== null && days < 0) {
        alerts.push({ type: 'error', msg: `${s.name}: Right to Work EXPIRED` });
      }
    }

    // Incomplete onboarding for staff who started 14+ days ago
    if (s.start_date && !progress.isComplete) {
      const daysSinceStart = getDaysUntilExpiry(s.start_date);
      if (daysSinceStart !== null && daysSinceStart <= -14) {
        alerts.push({ type: 'warning', msg: `${s.name}: Onboarding incomplete (${progress.completed}/${progress.total}) — started ${Math.abs(daysSinceStart)} days ago` });
      }
    }

    // NMC registration expiry (Reg 19(4))
    const quals = onboardingData?.[s.id]?.qualifications;
    if (quals?.nmc_pin && quals?.nmc_expiry) {
      const nmcDays = getDaysUntilExpiry(quals.nmc_expiry);
      if (nmcDays !== null && nmcDays < 0) {
        alerts.push({ type: 'error', msg: `${s.name}: NMC registration EXPIRED (Reg 19(4))` });
      } else if (nmcDays !== null && nmcDays <= 90) {
        alerts.push({ type: 'warning', msg: `${s.name}: NMC registration expires in ${nmcDays} days` });
      }
    }
  }

  return alerts;
}

/**
 * Get blocking reasons for a staff member — if non-empty, they should not be rostered unsupervised.
 * Checks critical pre-employment items: DBS, RTW, references, identity.
 */
export function getOnboardingBlockingReasons(staffId, onboardingData) {
  const reasons = [];
  const staffOnb = onboardingData?.[staffId] || {};

  const dbs = staffOnb.dbs_check;
  if (!dbs || dbs.status !== ONBOARDING_STATUS.COMPLETED) {
    reasons.push('DBS check not completed');
  }

  const rtw = staffOnb.right_to_work;
  if (!rtw || rtw.status !== ONBOARDING_STATUS.COMPLETED) {
    reasons.push('Right to Work not verified');
  } else if (rtw.expiry_date) {
    const days = getDaysUntilExpiry(rtw.expiry_date);
    if (days !== null && days < 0) reasons.push('Right to Work expired');
  }

  const refs = staffOnb.references;
  if (!refs || refs.status !== ONBOARDING_STATUS.COMPLETED) {
    reasons.push('References not completed');
  }

  const identity = staffOnb.identity_check;
  if (!identity || identity.status !== ONBOARDING_STATUS.COMPLETED) {
    reasons.push('Identity verification not completed');
  }

  return reasons;
}
