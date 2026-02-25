// Whistleblowing / Freedom to Speak Up — Constants, Helpers, CQC Metric Calculators
// Maps to QS29 (Freedom to Speak Up) — CQC Regulation 17

import { formatDate, parseDate, addDays } from './rotation.js';

// ── Concern Categories ───────────────────────────────────────────────────────

export const CONCERN_CATEGORIES = [
  { id: 'malpractice',  name: 'Malpractice' },
  { id: 'bullying',     name: 'Bullying / Harassment' },
  { id: 'safety',       name: 'Safety Concern' },
  { id: 'compliance',   name: 'Regulatory / Compliance' },
  { id: 'other',        name: 'Other' },
];

// ── Concern Severities ───────────────────────────────────────────────────────

export const CONCERN_SEVERITIES = [
  { id: 'low',    name: 'Low',    badgeKey: 'green' },
  { id: 'medium', name: 'Medium', badgeKey: 'amber' },
  { id: 'high',   name: 'High',   badgeKey: 'red' },
  { id: 'urgent', name: 'Urgent', badgeKey: 'purple' },
];

// ── Concern Statuses ─────────────────────────────────────────────────────────

export const CONCERN_STATUSES = [
  { id: 'registered',    name: 'Registered',    badgeKey: 'blue' },
  { id: 'investigating', name: 'Investigating', badgeKey: 'amber' },
  { id: 'resolved',      name: 'Resolved',      badgeKey: 'green' },
  { id: 'closed',        name: 'Closed',        badgeKey: 'gray' },
];

// ── Concern Outcomes ─────────────────────────────────────────────────────────

export const CONCERN_OUTCOMES = [
  { id: 'no_action',       name: 'No Action Required' },
  { id: 'training',        name: 'Training Provided' },
  { id: 'disciplinary',    name: 'Disciplinary Action' },
  { id: 'process_change',  name: 'Process Change' },
  { id: 'escalated',       name: 'Externally Escalated' },
];

// ── Reporter Roles ───────────────────────────────────────────────────────────

export const REPORTER_ROLES = [
  { id: 'carer',   name: 'Carer' },
  { id: 'senior',  name: 'Senior Carer' },
  { id: 'nurse',   name: 'Nurse' },
  { id: 'manager', name: 'Manager' },
  { id: 'other',   name: 'Other' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

export function ensureWhistleblowingDefaults(data) {
  let changed = false;
  let result = data;
  if (!data.whistleblowing_concerns) {
    result = { ...result, whistleblowing_concerns: [] };
    changed = true;
  }
  return changed ? result : null;
}

// ── Date Range Filter ────────────────────────────────────────────────────────

function filterByDateRange(concerns, fromDate, toDate) {
  if (!fromDate || !toDate) return concerns;
  return concerns.filter(c => c.date_raised >= fromDate && c.date_raised <= toDate);
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function getWhistleblowingStats(concerns, fromDate, toDate) {
  const filtered = filterByDateRange(concerns || [], fromDate, toDate);

  const open = filtered.filter(c => c.status !== 'resolved' && c.status !== 'closed').length;

  // Average investigation days for resolved/closed with both dates
  let totalDays = 0;
  let resolvedCount = 0;
  for (const c of filtered) {
    if ((c.status === 'resolved' || c.status === 'closed') && c.date_raised && c.resolution_date) {
      const raised = parseDate(c.date_raised);
      const resolved = parseDate(c.resolution_date);
      const days = Math.max(0, Math.floor((resolved - raised) / (1000 * 60 * 60 * 24)));
      totalDays += days;
      resolvedCount++;
    }
  }
  const avgInvestigationDays = resolvedCount > 0 ? Math.round(totalDays / resolvedCount * 10) / 10 : null;

  // Protection rate: % with reporter_protected === true out of non-anonymous
  const nonAnonymous = filtered.filter(c => !c.anonymous);
  const protectedCount = nonAnonymous.filter(c => c.reporter_protected === true).length;
  const protectionRate = nonAnonymous.length > 0 ? Math.round((protectedCount / nonAnonymous.length) * 100) : null;

  return {
    total: filtered.length,
    open,
    avgInvestigationDays,
    protectionRate,
  };
}

// ── Dashboard Alerts ─────────────────────────────────────────────────────────

export function getWhistleblowingAlerts(concerns) {
  const alerts = [];
  const now = new Date();
  const todayStr = formatDate(now);

  for (const c of (concerns || [])) {
    if (c.status === 'resolved' || c.status === 'closed') continue;

    // Not acknowledged within 3 days
    if (!c.acknowledgement_date && c.date_raised) {
      const raised = parseDate(c.date_raised);
      const deadline = addDays(raised, 3);
      if (now > deadline) {
        alerts.push({ type: 'error', msg: `Whistleblowing concern ${c.date_raised}: Not acknowledged within 3 days` });
      }
    }

    // Investigation exceeding 30 days
    if (c.status === 'investigating' && c.investigation_start_date) {
      const start = parseDate(c.investigation_start_date);
      const deadline = addDays(start, 30);
      if (now > deadline) {
        const daysSince = Math.floor((now - start) / (1000 * 60 * 60 * 24));
        alerts.push({ type: 'warning', msg: `Whistleblowing investigation ongoing for ${daysSince} days — raised ${c.date_raised}` });
      }
    }

    // Follow-up overdue
    if (c.follow_up_date && !c.follow_up_completed && c.follow_up_date < todayStr) {
      alerts.push({ type: 'warning', msg: `Whistleblowing follow-up overdue since ${c.follow_up_date}` });
    }
  }

  return alerts;
}

// ── CQC Metric: Speak Up Culture Score ───────────────────────────────────────

export function calculateSpeakUpCulture(data, fromDate, toDate) {
  const concerns = filterByDateRange(data.whistleblowing_concerns || [], fromDate, toDate);

  if (concerns.length === 0) {
    return { score: 50, totalConcerns: 0, resolutionRate: 0, protectionRate: 0, detail: 'No concerns raised — may indicate low awareness' };
  }

  // Concerns logged: having any is positive (scored 40%)
  const loggedScore = 40;

  // Resolution rate: % resolved/closed (scored 30%)
  const resolvedOrClosed = concerns.filter(c => c.status === 'resolved' || c.status === 'closed').length;
  const resolutionRate = Math.round((resolvedOrClosed / concerns.length) * 100);
  const resolutionScore = Math.round((resolutionRate / 100) * 30);

  // Protection rate: % with reporter_protected out of non-anonymous (scored 30%)
  const nonAnonymous = concerns.filter(c => !c.anonymous);
  const protectedCount = nonAnonymous.filter(c => c.reporter_protected === true).length;
  const protectionRate = nonAnonymous.length > 0 ? Math.round((protectedCount / nonAnonymous.length) * 100) : 100;
  const protectionScore = Math.round((protectionRate / 100) * 30);

  const score = loggedScore + resolutionScore + protectionScore;

  return {
    score,
    totalConcerns: concerns.length,
    resolutionRate,
    protectionRate,
  };
}
