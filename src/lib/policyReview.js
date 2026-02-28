// Policy Review — Constants, Helpers, CQC Metric Calculators
// Maps to QS31 (Governance & Management) — CQC Regulation 17

import { formatDate, parseDate } from './rotation.js';

// ── Default Policies ────────────────────────────────────────────────────────

export const DEFAULT_POLICIES = [
  { id: 'safeguarding',    name: 'Safeguarding Adults & Children',       category: 'safeguarding',  review_frequency_months: 12 },
  { id: 'complaints',      name: 'Complaints & Feedback',                category: 'governance',    review_frequency_months: 12 },
  { id: 'whistleblowing',  name: 'Freedom to Speak Up / Whistleblowing', category: 'governance',    review_frequency_months: 12 },
  { id: 'data-protection', name: 'Data Protection & GDPR',               category: 'governance',    review_frequency_months: 12 },
  { id: 'health-safety',   name: 'Health & Safety',                      category: 'health-safety', review_frequency_months: 12 },
  { id: 'ipc',             name: 'Infection Prevention & Control',        category: 'clinical',      review_frequency_months: 12 },
  { id: 'mca-dols',        name: 'Mental Capacity Act & DoLS',           category: 'clinical',      review_frequency_months: 12 },
  { id: 'equality',        name: 'Equality & Diversity',                 category: 'governance',    review_frequency_months: 12 },
];

// ── Policy Statuses ──────────────────────────────────────────────────────────

export const POLICY_STATUSES = [
  { id: 'current', name: 'Current', badgeKey: 'green' },
  { id: 'due',     name: 'Due',     badgeKey: 'amber' },
  { id: 'overdue', name: 'Overdue', badgeKey: 'red' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

export function ensurePolicyDefaults(data) {
  let changed = false;
  let result = data;

  if (!data.policy_reviews) {
    // Pre-populate with 8 default policies
    const defaults = DEFAULT_POLICIES.map(p => ({
      id: 'pol-' + p.id,
      policy_name: p.name,
      policy_ref: '',
      category: p.category,
      version: '1.0',
      last_reviewed: '',
      next_review_due: '',
      review_frequency_months: p.review_frequency_months,
      status: 'not_reviewed',
      reviewed_by: '',
      approved_by: '',
      changes: [],
      notes: '',
      updated_at: '',
    }));
    result = { ...result, policy_reviews: defaults };
    changed = true;
  }

  return changed ? result : null;
}

// ── Status Calculation ───────────────────────────────────────────────────────

export function getPolicyStatus(policy, asOfDate) {
  const today = typeof asOfDate === 'string' ? asOfDate : formatDate(asOfDate || new Date());

  // No review date — treat as overdue
  if (!policy.last_reviewed || !policy.next_review_due) {
    return { status: 'overdue', daysUntilDue: 0, isOverdue: true, daysOverdue: 0 };
  }

  const nextDue = policy.next_review_due;

  if (nextDue < today) {
    // Overdue
    const dueDate = parseDate(nextDue);
    const todayDate = parseDate(today);
    const daysOverdue = Math.floor((todayDate - dueDate) / (1000 * 60 * 60 * 24));
    return { status: 'overdue', daysUntilDue: -daysOverdue, isOverdue: true, daysOverdue };
  }

  // Days until due
  const dueDate = parseDate(nextDue);
  const todayDate = parseDate(today);
  const daysUntilDue = Math.floor((dueDate - todayDate) / (1000 * 60 * 60 * 24));

  if (daysUntilDue <= 30) {
    return { status: 'due', daysUntilDue, isOverdue: false, daysOverdue: 0 };
  }

  return { status: 'current', daysUntilDue, isOverdue: false, daysOverdue: 0 };
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function getPolicyStats(policies, asOfDate) {
  const list = policies || [];
  let current = 0, due = 0, overdue = 0;

  for (const policy of list) {
    const s = getPolicyStatus(policy, asOfDate);
    if (s.status === 'current') current++;
    else if (s.status === 'due') due++;
    else overdue++;
  }

  const total = list.length;
  const compliancePct = total > 0 ? Math.round(((current + due) / total) * 100) : 100;

  return { total, current, due, overdue, compliancePct };
}

// ── Dashboard Alerts ─────────────────────────────────────────────────────────

export function getPolicyAlerts(policies, asOfDate) {
  const alerts = [];

  for (const policy of (policies || [])) {
    const s = getPolicyStatus(policy, asOfDate);

    if (s.isOverdue) {
      alerts.push({ type: 'error', msg: `Policy "${policy.policy_name}" overdue by ${s.daysOverdue} days` });
    } else if (s.status === 'due') {
      alerts.push({ type: 'warning', msg: `Policy "${policy.policy_name}" due for review in ${s.daysUntilDue} days` });
    }
  }

  return alerts;
}

// ── CQC Metric: Policy Compliance % ─────────────────────────────────────────

export function calculatePolicyCompliancePct(data, asOfDate) {
  const policies = data.policy_reviews || [];
  const stats = getPolicyStats(policies, asOfDate);

  return {
    score: stats.compliancePct,
    current: stats.current,
    overdue: stats.overdue,
    total: stats.total,
  };
}
