// Care Certificate — Constants, Helpers, CQC Metric Calculators
// Maps to QS6 (Competent Staff) — CQC Regulation 18

import { parseDate } from './rotation.js';
import { isCareRole } from '../../shared/rotation.js';

// ── Care Certificate Standards (2025 update incl. Oliver McGowan) ──────────

export const CARE_CERTIFICATE_STANDARDS = [
  { id: 'std-1',  name: 'Understand Your Role',                                    category: 'core' },
  { id: 'std-2',  name: 'Personal Development',                                    category: 'core' },
  { id: 'std-3',  name: 'Duty of Care',                                            category: 'core' },
  { id: 'std-4',  name: 'Equality & Diversity',                                    category: 'core' },
  { id: 'std-5',  name: 'Work in a Person-Centred Way',                            category: 'core' },
  { id: 'std-6',  name: 'Communication',                                           category: 'core' },
  { id: 'std-7',  name: 'Privacy & Dignity',                                       category: 'core' },
  { id: 'std-8',  name: 'Fluids & Nutrition',                                      category: 'clinical' },
  { id: 'std-9',  name: 'Mental Health, Dementia & Learning Disability Awareness', category: 'specialist' },
  { id: 'std-10', name: 'Safeguarding Adults',                                     category: 'safety' },
  { id: 'std-11', name: 'Safeguarding Children',                                   category: 'safety' },
  { id: 'std-12', name: 'Basic Life Support',                                      category: 'clinical' },
  { id: 'std-13', name: 'Health & Safety',                                         category: 'safety' },
  { id: 'std-14', name: 'Handling Information',                                    category: 'core' },
  { id: 'std-15', name: 'Infection Prevention & Control',                          category: 'clinical' },
  { id: 'std-16', name: 'Learning Disability & Autism (Oliver McGowan)',           category: 'specialist' },
];

export const CC_CATEGORIES = [
  { id: 'core',       name: 'Core' },
  { id: 'clinical',   name: 'Clinical' },
  { id: 'safety',     name: 'Safety' },
  { id: 'specialist', name: 'Specialist' },
];

export const TOTAL_STANDARDS = 16;
export const CC_COMPLETION_WEEKS = 12;

// ── Statuses ────────────────────────────────────────────────────────────────

export const CC_STATUSES = {
  not_started: { label: 'Not Started', badgeKey: 'gray' },
  in_progress: { label: 'In Progress', badgeKey: 'blue' },
  completed:   { label: 'Completed',   badgeKey: 'green' },
  overdue:     { label: 'Overdue',     badgeKey: 'red' },
};

export const CC_STANDARD_STATUSES = {
  not_started: { label: 'Not Started', badgeKey: 'gray' },
  in_progress: { label: 'In Progress', badgeKey: 'amber' },
  passed:      { label: 'Passed',      badgeKey: 'green' },
  failed:      { label: 'Failed',      badgeKey: 'red' },
};

// ── Ensure Defaults ─────────────────────────────────────────────────────────

export function ensureCareCertDefaults(data) {
  if (data.care_certificate) return null;
  return { ...data, care_certificate: {} };
}

// ── Status Calculation ──────────────────────────────────────────────────────

export function getCareCertStatus(staffId, careCertData, startDate, asOfDate) {
  const record = careCertData?.[staffId];
  if (!record) {
    return {
      status: 'not_started',
      progressPct: 0,
      completedCount: 0,
      totalStandards: TOTAL_STANDARDS,
      weeksElapsed: 0,
      isOverdue: false,
    };
  }

  const standards = record.standards || {};
  let completedCount = 0;
  for (const std of CARE_CERTIFICATE_STANDARDS) {
    if (standards[std.id]?.status === 'passed') completedCount++;
  }
  const progressPct = Math.round((completedCount / TOTAL_STANDARDS) * 100);

  const effectiveStart = record.start_date || startDate;
  let weeksElapsed = 0;
  if (effectiveStart) {
    const start = parseDate(effectiveStart);
    const now = typeof asOfDate === 'string' ? parseDate(asOfDate) : (asOfDate instanceof Date ? asOfDate : new Date());
    const diffMs = now.getTime() - start.getTime();
    weeksElapsed = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7)));
  }

  // Determine status
  if (record.status === 'completed' || completedCount === TOTAL_STANDARDS) {
    return { status: 'completed', progressPct: 100, completedCount: TOTAL_STANDARDS, totalStandards: TOTAL_STANDARDS, weeksElapsed, isOverdue: false };
  }

  const isOverdue = weeksElapsed > CC_COMPLETION_WEEKS && completedCount < TOTAL_STANDARDS;
  if (isOverdue) {
    return { status: 'overdue', progressPct, completedCount, totalStandards: TOTAL_STANDARDS, weeksElapsed, isOverdue: true };
  }

  return { status: 'in_progress', progressPct, completedCount, totalStandards: TOTAL_STANDARDS, weeksElapsed, isOverdue: false };
}

// ── Aggregate Stats ─────────────────────────────────────────────────────────

export function getCareCertStats(careCertData, activeStaff, asOfDate) {
  let inProgress = 0, completed = 0, onTrack = 0, overdue = 0, notStarted = 0, totalTracked = 0;

  const trackedIds = Object.keys(careCertData || {});
  totalTracked = trackedIds.length;

  for (const staffId of trackedIds) {
    const record = careCertData[staffId];
    const result = getCareCertStatus(staffId, careCertData, record?.start_date, asOfDate);
    if (result.status === 'completed') {
      completed++;
    } else if (result.status === 'overdue') {
      overdue++;
    } else if (result.status === 'in_progress') {
      inProgress++;
      if (result.weeksElapsed <= CC_COMPLETION_WEEKS) onTrack++;
    }
  }

  // Staff with no CC record at all
  for (const s of activeStaff) {
    if (!careCertData?.[s.id]) notStarted++;
  }

  return { inProgress, completed, onTrack, overdue, notStarted, totalTracked };
}

// ── Alerts ──────────────────────────────────────────────────────────────────

export function getCareCertAlerts(careCertData, activeStaff, config, asOfDate) {
  const alerts = [];
  const cc = careCertData || {};
  const staffMap = new Map(activeStaff.map(s => [s.id, s]));

  for (const [staffId, record] of Object.entries(cc)) {
    const staff = staffMap.get(staffId);
    if (!staff || !record) continue;

    const result = getCareCertStatus(staffId, cc, record.start_date, asOfDate);

    // Overdue: >12 weeks and not completed
    if (result.isOverdue) {
      alerts.push({ type: 'error', msg: `${staff.name}: Care Certificate overdue (${result.weeksElapsed} weeks, ${result.completedCount}/${TOTAL_STANDARDS} completed)` });
      continue;
    }

    // Approaching 8 weeks with <50% completion
    if (result.status === 'in_progress' && result.weeksElapsed >= 8 && result.progressPct < 50) {
      alerts.push({ type: 'warning', msg: `${staff.name}: Care Certificate at ${result.weeksElapsed} weeks with only ${result.completedCount}/${TOTAL_STANDARDS} standards completed` });
    }
  }

  return alerts;
}

// ── CQC Metric ──────────────────────────────────────────────────────────────

export function calculateCareCertCompletionPct(data, asOfDate) {
  const cc = data.care_certificate || {};
  const eligibleStaff = (data.staff || []).filter((staff) => staff?.active !== false && isCareRole(staff.role));
  const eligibleStaffIds = eligibleStaff.map((staff) => staff.id);

  if (eligibleStaffIds.length === 0) {
    return { score: 100, completed: 0, total: 0, detail: 'No eligible care staff' };
  }

  let completed = 0;
  for (const staffId of eligibleStaffIds) {
    const record = cc[staffId];
    const result = getCareCertStatus(staffId, cc, record?.start_date, asOfDate);
    if (result.status === 'completed') completed++;
  }

  const score = Math.round((completed / eligibleStaffIds.length) * 100);
  return { score, completed, total: eligibleStaffIds.length };
}
