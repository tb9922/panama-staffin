// IPC Audit — Constants, Helpers, CQC Metric Calculators
// Maps to QS7 (Infection Prevention & Control) — CQC Regulation 12

import { formatDate, parseDate, addDays } from './rotation.js';

// ── Default IPC Audit Types ─────────────────────────────────────────────────

export const DEFAULT_IPC_AUDIT_TYPES = [
  { id: 'hand_hygiene', name: 'Hand Hygiene Audit',    frequency: 'quarterly', active: true },
  { id: 'ppe',          name: 'PPE Compliance',         frequency: 'quarterly', active: true },
  { id: 'cleanliness',  name: 'Cleanliness Audit',      frequency: 'quarterly', active: true },
  { id: 'isolation',    name: 'Isolation Procedures',    frequency: 'quarterly', active: true },
  { id: 'outbreak',     name: 'Outbreak Response',       frequency: 'quarterly', active: true },
  { id: 'general',      name: 'General IPC Audit',       frequency: 'quarterly', active: true },
];

// ── Outbreak Statuses ───────────────────────────────────────────────────────

export const OUTBREAK_STATUSES = [
  { id: 'suspected', name: 'Suspected', badgeKey: 'amber' },
  { id: 'confirmed', name: 'Confirmed', badgeKey: 'red' },
  { id: 'contained', name: 'Contained', badgeKey: 'amber' },
  { id: 'resolved',  name: 'Resolved',  badgeKey: 'green' },
];

// ── IPC Audit Statuses ──────────────────────────────────────────────────────

export const IPC_AUDIT_STATUSES = [
  { id: 'compliant',          name: 'Compliant',          badgeKey: 'green' },
  { id: 'improvement_needed', name: 'Improvement Needed', badgeKey: 'amber' },
  { id: 'non_compliant',      name: 'Non-Compliant',      badgeKey: 'red' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

export function ensureIpcDefaults(data) {
  let changed = false;
  let result = data;
  if (!data.ipc_audits) {
    result = { ...result, ipc_audits: [] };
    changed = true;
  }
  if (!data.config?.ipc_audit_types) {
    result = { ...result, config: { ...result.config, ipc_audit_types: DEFAULT_IPC_AUDIT_TYPES } };
    changed = true;
  }
  return changed ? result : null;
}

export function getIpcAuditTypes(config) {
  return config?.ipc_audit_types?.length > 0 ? config.ipc_audit_types : DEFAULT_IPC_AUDIT_TYPES;
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function getIpcStats(audits, asOfDate) {
  const arr = audits || [];
  const now = asOfDate ? parseDate(asOfDate) : new Date();
  const todayStr = formatDate(now);

  // Average score across all audits
  const scored = arr.filter(a => a.overall_score != null);
  const avgScore = scored.length > 0
    ? Math.round(scored.reduce((sum, a) => sum + a.overall_score, 0) / scored.length)
    : 0;

  // Audits this quarter (last 91 days)
  const quarterStart = addDays(now, -91);
  const quarterStartStr = formatDate(quarterStart);
  const auditsThisQuarter = arr.filter(a => a.audit_date >= quarterStartStr && a.audit_date <= todayStr).length;

  // Active outbreaks: suspected or confirmed
  const activeOutbreaks = arr.filter(a =>
    a.outbreak && (a.outbreak.status === 'suspected' || a.outbreak.status === 'confirmed')
  ).length;

  // Corrective action completion %
  let totalActions = 0;
  let completedActions = 0;
  for (const audit of arr) {
    for (const action of (audit.corrective_actions || [])) {
      totalActions++;
      if (action.status === 'completed') completedActions++;
    }
  }
  const actionCompletion = totalActions > 0
    ? Math.round((completedActions / totalActions) * 100)
    : 100;

  return { avgScore, auditsThisQuarter, activeOutbreaks, actionCompletion };
}

// ── Dashboard Alerts ─────────────────────────────────────────────────────────

export function getIpcAlerts(audits, asOfDate, config) {
  const alerts = [];
  const arr = audits || [];
  const now = asOfDate ? parseDate(asOfDate) : new Date();
  const todayStr = formatDate(now);
  const overdueThreshold = formatDate(addDays(now, -91));

  // Check each audit type for overdue (no audit of that type in 91 days)
  // Use config types so custom types added by managers are also checked
  const types = getIpcAuditTypes(config).filter(t => t.active);
  for (const type of types) {
    const typeAudits = arr.filter(a => a.audit_type === type.id);
    const latest = typeAudits.sort((a, b) => b.audit_date.localeCompare(a.audit_date))[0];
    if (!latest || latest.audit_date < overdueThreshold) {
      alerts.push({ type: 'warning', msg: `IPC: ${type.name} overdue — no audit in last 3 months` });
    }
  }

  // Low score audits (<80%)
  for (const audit of arr) {
    if (audit.overall_score != null && audit.overall_score < 80) {
      const typeDef = getIpcAuditTypes(config).find(t => t.id === audit.audit_type);
      alerts.push({ type: 'warning', msg: `IPC: ${typeDef?.name || audit.audit_type} scored ${audit.overall_score}% on ${audit.audit_date}` });
    }
  }

  // Active outbreaks
  for (const audit of arr) {
    if (audit.outbreak && (audit.outbreak.status === 'suspected' || audit.outbreak.status === 'confirmed')) {
      alerts.push({ type: 'error', msg: `IPC: Active outbreak (${audit.outbreak.status}) — ${audit.outbreak.type || 'unspecified type'}` });
    }
  }

  // Overdue corrective actions
  for (const audit of arr) {
    for (const action of (audit.corrective_actions || [])) {
      if (action.status !== 'completed' && action.due_date && action.due_date < todayStr) {
        alerts.push({ type: 'warning', msg: `IPC: Corrective action overdue — "${(action.description || '').substring(0, 40)}"` });
      }
    }
  }

  return alerts;
}

// ── CQC Metric: IPC Audit Compliance ─────────────────────────────────────────

export function calculateIpcAuditCompliance(data, asOfDate) {
  const arr = data?.ipc_audits || [];
  const now = asOfDate ? parseDate(asOfDate) : new Date();
  const yearAgo = formatDate(addDays(now, -365));
  const todayStr = formatDate(now);

  const recent = arr.filter(a => a.audit_date >= yearAgo && a.audit_date <= todayStr && a.overall_score != null);

  if (recent.length === 0) return { score: 0, avgScore: 0, totalAudits: 0 };

  const avgScore = Math.round(recent.reduce((sum, a) => sum + a.overall_score, 0) / recent.length);

  return { score: avgScore, avgScore, totalAudits: recent.length };
}
