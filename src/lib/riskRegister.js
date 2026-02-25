// Risk Register — Constants, Helpers, CQC Metric Calculators
// Maps to QS31 (Governance & Management) — CQC Regulation 17

import { formatDate, parseDate, addDays } from './rotation.js';

// ── Risk Categories ─────────────────────────────────────────────────────────

export const RISK_CATEGORIES = [
  { id: 'staffing',    name: 'Staffing' },
  { id: 'clinical',    name: 'Clinical' },
  { id: 'operational', name: 'Operational' },
  { id: 'financial',   name: 'Financial' },
  { id: 'compliance',  name: 'Compliance' },
];

// ── Likelihood Labels (1-5) ─────────────────────────────────────────────────

export const LIKELIHOOD_LABELS = [
  { value: 1, name: 'Rare' },
  { value: 2, name: 'Unlikely' },
  { value: 3, name: 'Possible' },
  { value: 4, name: 'Likely' },
  { value: 5, name: 'Almost Certain' },
];

// ── Impact Labels (1-5) ─────────────────────────────────────────────────────

export const IMPACT_LABELS = [
  { value: 1, name: 'Negligible' },
  { value: 2, name: 'Minor' },
  { value: 3, name: 'Moderate' },
  { value: 4, name: 'Major' },
  { value: 5, name: 'Catastrophic' },
];

// ── Risk Score Bands ────────────────────────────────────────────────────────

export const RISK_SCORE_BANDS = [
  { id: 'low',      name: 'Low',      badgeKey: 'green',  min: 1,  max: 4 },
  { id: 'medium',   name: 'Medium',   badgeKey: 'amber',  min: 5,  max: 9 },
  { id: 'high',     name: 'High',     badgeKey: 'red',    min: 10, max: 15 },
  { id: 'critical', name: 'Critical', badgeKey: 'purple', min: 16, max: 25 },
];

// ── Risk Statuses ───────────────────────────────────────────────────────────

export const RISK_STATUSES = [
  { id: 'open',      name: 'Open',      badgeKey: 'red' },
  { id: 'mitigated', name: 'Mitigated', badgeKey: 'amber' },
  { id: 'closed',    name: 'Closed',    badgeKey: 'green' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

export function ensureRiskRegisterDefaults(data) {
  let changed = false;
  let result = data;
  if (!data.risk_register) {
    result = { ...result, risk_register: [] };
    changed = true;
  }
  return changed ? result : null;
}

export function getRiskScore(likelihood, impact) {
  return (likelihood || 0) * (impact || 0);
}

export function getRiskBand(score) {
  if (!score || score < 1) return RISK_SCORE_BANDS[0];
  return RISK_SCORE_BANDS.find(b => score >= b.min && score <= b.max) || RISK_SCORE_BANDS[3];
}

// ── Stats ───────────────────────────────────────────────────────────────────

export function getRiskStats(risks, asOfDate) {
  const today = asOfDate || formatDate(new Date());
  const list = risks || [];

  let total = 0;
  let critical = 0;
  let high = 0;
  let reviewsOverdue = 0;
  let actionsOverdue = 0;

  for (const risk of list) {
    if (risk.status === 'closed') continue;
    total++;

    const score = risk.risk_score || getRiskScore(risk.likelihood, risk.impact);
    if (score >= 16) critical++;
    else if (score >= 10) high++;

    if (risk.next_review && risk.next_review < today) reviewsOverdue++;

    for (const action of (risk.actions || [])) {
      if (action.status !== 'completed' && action.due_date && action.due_date < today) {
        actionsOverdue++;
      }
    }
  }

  return { total, critical, high, reviewsOverdue, actionsOverdue };
}

// ── Dashboard Alerts ────────────────────────────────────────────────────────

export function getRiskAlerts(risks, asOfDate) {
  const alerts = [];
  const today = asOfDate || formatDate(new Date());

  for (const risk of (risks || [])) {
    if (risk.status === 'closed') continue;

    const score = risk.risk_score || getRiskScore(risk.likelihood, risk.impact);

    // Critical risk score
    if (score >= 16) {
      alerts.push({ type: 'error', msg: `Risk "${risk.title}": CRITICAL score ${score} — requires immediate attention` });
    }

    // Review overdue >90 days
    if (risk.next_review && risk.next_review < today) {
      const reviewDate = parseDate(risk.next_review);
      const todayDate = parseDate(today);
      const daysSince = Math.floor((todayDate - reviewDate) / (1000 * 60 * 60 * 24));
      if (daysSince > 90) {
        alerts.push({ type: 'error', msg: `Risk "${risk.title}": Review overdue by ${daysSince} days` });
      } else {
        alerts.push({ type: 'warning', msg: `Risk "${risk.title}": Review overdue by ${daysSince} days` });
      }
    }

    // Action deadline passed
    for (const action of (risk.actions || [])) {
      if (action.status !== 'completed' && action.due_date && action.due_date < today) {
        alerts.push({ type: 'warning', msg: `Risk "${risk.title}": Action overdue — "${(action.description || '').substring(0, 40)}"` });
      }
    }
  }

  return alerts;
}

// ── CQC Metric: Risk Management Score ───────────────────────────────────────

export function calculateRiskManagementScore(data, asOfDate) {
  const risks = data?.risk_register || [];
  const today = asOfDate || formatDate(new Date());
  const openRisks = risks.filter(r => r.status !== 'closed');

  if (openRisks.length === 0) return { score: 100, reviewedPct: 100, actionsPct: 100, total: 0 };

  // % of risks reviewed within last 90 days
  const ninetyDaysAgo = formatDate(addDays(parseDate(today), -90));
  let reviewedCount = 0;
  for (const risk of openRisks) {
    if (risk.last_reviewed && risk.last_reviewed >= ninetyDaysAgo) {
      reviewedCount++;
    }
  }
  const reviewedPct = Math.round((reviewedCount / openRisks.length) * 100);

  // % of actions completed on time
  let totalActions = 0;
  let completedOnTime = 0;
  for (const risk of openRisks) {
    for (const action of (risk.actions || [])) {
      totalActions++;
      if (action.status === 'completed') {
        // If completed and had a due date, check if completed on time
        if (action.due_date && action.completed_date) {
          if (action.completed_date <= action.due_date) completedOnTime++;
        } else {
          completedOnTime++; // No due date or no completed_date recorded = assume on time
        }
      }
    }
  }
  const actionsPct = totalActions > 0 ? Math.round((completedOnTime / totalActions) * 100) : 100;

  // Average of both metrics
  const score = Math.round((reviewedPct + actionsPct) / 2);

  return { score, reviewedPct, actionsPct, total: openRisks.length };
}
