// GDPR / Data Protection — Pure Functions
// UK GDPR compliance for care home special category data

// ── Constants ────────────────────────────────────────────────────────────────

export const REQUEST_TYPES = [
  { id: 'sar',            label: 'Subject Access Request',  deadline_days: 30 },
  { id: 'erasure',        label: 'Right to Erasure',        deadline_days: 30 },
  { id: 'rectification',  label: 'Right to Rectification',  deadline_days: 30 },
  { id: 'restriction',    label: 'Restriction of Processing', deadline_days: 30 },
  { id: 'portability',    label: 'Data Portability',        deadline_days: 30 },
];

export const REQUEST_STATUSES = ['received', 'in_progress', 'completed', 'rejected'];

export const BREACH_SEVERITIES = [
  { id: 'low',      label: 'Low',      badgeKey: 'green' },
  { id: 'medium',   label: 'Medium',   badgeKey: 'amber' },
  { id: 'high',     label: 'High',     badgeKey: 'red' },
  { id: 'critical', label: 'Critical', badgeKey: 'purple' },
];

export const BREACH_STATUSES = ['open', 'contained', 'resolved', 'closed'];

export const RISK_TO_RIGHTS = [
  { id: 'unlikely', label: 'Unlikely' },
  { id: 'possible', label: 'Possible' },
  { id: 'likely',   label: 'Likely' },
  { id: 'high',     label: 'High' },
];

export const LEGAL_BASES = [
  { id: 'consent',              label: 'Consent (Art 6(1)(a))' },
  { id: 'contract',             label: 'Contract (Art 6(1)(b))' },
  { id: 'legal_obligation',     label: 'Legal Obligation (Art 6(1)(c))' },
  { id: 'vital_interests',      label: 'Vital Interests (Art 6(1)(d))' },
  { id: 'public_task',          label: 'Public Task (Art 6(1)(e))' },
  { id: 'legitimate_interests', label: 'Legitimate Interests (Art 6(1)(f))' },
];

export const DP_COMPLAINT_CATEGORIES = [
  { id: 'access',        label: 'Access Request' },
  { id: 'erasure',       label: 'Erasure Request' },
  { id: 'rectification', label: 'Data Correction' },
  { id: 'breach',        label: 'Data Breach' },
  { id: 'consent',       label: 'Consent Issue' },
  { id: 'other',         label: 'Other' },
];

export const DP_COMPLAINT_STATUSES = ['open', 'investigating', 'resolved', 'closed', 'escalated'];

export const DATA_CATEGORIES = [
  'staff', 'scheduling', 'overrides', 'payroll', 'tax', 'pension',
  'clinical', 'handover', 'audit', 'gdpr', 'personal_data',
  'staff_health', 'dbs', 'resident_health', 'dols', 'mca',
];

// ── Deadline Calculators ─────────────────────────────────────────────────────

export function calculateDeadline(dateReceived, days = 30) {
  const [y, m, day] = dateReceived.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, day + days));
  return d.toISOString().slice(0, 10);
}

export function calculateICODeadline(discoveredDate) {
  const d = new Date(discoveredDate);
  return new Date(d.getTime() + 72 * 60 * 60 * 1000).toISOString();
}

export function daysUntilDeadline(deadline) {
  const now = new Date();
  const dl = new Date(deadline);
  return Math.ceil((dl - now) / (1000 * 60 * 60 * 24));
}

export function isOverdue(deadline) {
  return daysUntilDeadline(deadline) < 0;
}

export function hoursUntilICODeadline(icoDeadline) {
  const now = new Date();
  const dl = new Date(icoDeadline);
  return Math.round((dl - now) / (1000 * 60 * 60));
}

// ── Risk Assessment ──────────────────────────────────────────────────────────

// ICO breach risk assessment. Art 33(1): notify unless "unlikely to result in a risk."
// The safe default is to recommend notification. Categories that carry identity fraud
// or elevated vulnerability risk use a higher multiplier.
export function assessBreachRisk(breachData) {
  const severityWeights = { low: 1, medium: 2, high: 3, critical: 4 };
  const riskWeights = { unlikely: 1, possible: 2, likely: 3, high: 4 };

  const sevScore = severityWeights[breachData.severity] || 1;
  const riskScore = riskWeights[breachData.risk_to_rights] || 1;
  // Each affected individual matters — don't scale per-10.
  // ?? 1 preserves explicit 0 (e.g., breach discovered before data accessed).
  const affectedScore = Math.min(4, breachData.individuals_affected ?? 1);

  // Special category data (GDPR Art 9) — health, biometric, criminal records
  const specialCats = (breachData.data_categories || []).filter(c =>
    ['staff_health', 'dbs', 'resident_health', 'dols', 'mca'].includes(c)
  );
  // Identity fraud risk data — NI numbers, financial, addresses
  const identityRiskCats = (breachData.data_categories || []).filter(c =>
    ['personal_data', 'payroll', 'tax', 'pension'].includes(c)
  );

  // specialCats already covers resident data (resident_health, dols, mca) at 1.5x
  let multiplier = 1.0;
  if (specialCats.length > 0) multiplier = 1.5;
  if (identityRiskCats.length > 0) multiplier = Math.max(multiplier, 1.3);

  const rawScore = ((sevScore + riskScore + affectedScore) / 3) * multiplier;
  const score = Math.round(rawScore * 10) / 10;

  let riskLevel;
  if (score >= 3.0) riskLevel = 'critical';
  else if (score >= 2.0) riskLevel = 'high';
  else if (score >= 1.0) riskLevel = 'medium';
  else riskLevel = 'low';

  // ICO default: notify unless demonstrably unlikely to result in risk.
  // Only "low" risk level (all dimensions at minimum, no sensitive data) is not notifiable.
  const icoNotifiable = riskLevel !== 'low';

  return { score, riskLevel, icoNotifiable, specialCategoryDataInvolved: specialCats.length > 0 };
}

// ── Compliance Score ─────────────────────────────────────────────────────────

export function calculateGdprComplianceScore(requests, breaches, complaints, retentionScan) {
  let score = 100;
  const issues = [];

  // Overdue requests: -10 per overdue
  const overdueRequests = (requests || []).filter(r =>
    r.status !== 'completed' && r.status !== 'rejected' && isOverdue(r.deadline)
  );
  score -= overdueRequests.length * 10;
  if (overdueRequests.length > 0) issues.push(`${overdueRequests.length} overdue data request(s)`);

  // Open breaches: -15 per open breach
  const openBreaches = (breaches || []).filter(b => b.status === 'open');
  score -= openBreaches.length * 15;
  if (openBreaches.length > 0) issues.push(`${openBreaches.length} open data breach(es)`);

  // Unnotified ICO breaches: -20 each
  const unnotifiedBreaches = (breaches || []).filter(b =>
    b.ico_notifiable && !b.ico_notified
  );
  score -= unnotifiedBreaches.length * 20;
  if (unnotifiedBreaches.length > 0) issues.push(`${unnotifiedBreaches.length} ICO-notifiable breach(es) not yet reported`);

  // Open complaints: -5 per open complaint
  const openComplaints = (complaints || []).filter(c => c.status === 'open');
  score -= openComplaints.length * 5;
  if (openComplaints.length > 0) issues.push(`${openComplaints.length} open DP complaint(s)`);

  // Retention violations: -3 per category with expired data
  const retentionViolations = (retentionScan || []).filter(r => r.action_needed);
  score -= retentionViolations.length * 3;
  if (retentionViolations.length > 0) issues.push(`${retentionViolations.length} retention category(-ies) with expired data`);

  const clampedScore = Math.max(0, Math.min(100, score));
  return {
    score: clampedScore,
    band: clampedScore >= 90 ? 'good' : clampedScore >= 70 ? 'adequate' : clampedScore >= 50 ? 'requires_improvement' : 'inadequate',
    issues,
  };
}

// ── Alert Generators ─────────────────────────────────────────────────────────

export function getGdprAlerts(requests, breaches, complaints) {
  const alerts = [];

  // Overdue SARs
  for (const r of (requests || [])) {
    if (r.status !== 'completed' && r.status !== 'rejected' && isOverdue(r.deadline)) {
      const type = REQUEST_TYPES.find(t => t.id === r.request_type);
      alerts.push({
        severity: 'red',
        message: `${type?.label || r.request_type} from ${r.subject_name || r.subject_id} is ${Math.abs(daysUntilDeadline(r.deadline))} days overdue`,
        category: 'gdpr',
      });
    }
  }

  // Approaching deadlines (within 7 days)
  for (const r of (requests || [])) {
    if (r.status !== 'completed' && r.status !== 'rejected') {
      const days = daysUntilDeadline(r.deadline);
      if (days >= 0 && days <= 7) {
        alerts.push({
          severity: 'amber',
          message: `Data request deadline in ${days} day(s) — ${r.subject_name || r.subject_id}`,
          category: 'gdpr',
        });
      }
    }
  }

  // ICO notification deadlines
  for (const b of (breaches || [])) {
    if (b.ico_notifiable && !b.ico_notified && b.ico_notification_deadline) {
      const hours = hoursUntilICODeadline(b.ico_notification_deadline);
      if (hours <= 0) {
        alerts.push({
          severity: 'red',
          message: `ICO notification OVERDUE for breach: ${b.title}`,
          category: 'gdpr',
        });
      } else if (hours <= 24) {
        alerts.push({
          severity: 'red',
          message: `ICO notification due in ${hours}h for breach: ${b.title}`,
          category: 'gdpr',
        });
      }
    }
  }

  // Open DP complaints with ICO involvement
  for (const c of (complaints || [])) {
    if (c.ico_involved && c.status !== 'closed' && c.status !== 'resolved') {
      alerts.push({
        severity: 'red',
        message: `ICO-involved DP complaint still open: ${c.category}`,
        category: 'gdpr',
      });
    }
  }

  return alerts;
}

// ── Display Helpers ──────────────────────────────────────────────────────────

export function getStatusBadgeKey(status) {
  const map = {
    received: 'blue', in_progress: 'amber', completed: 'green', rejected: 'gray',
    open: 'red', contained: 'amber', resolved: 'green', closed: 'gray',
    investigating: 'amber', escalated: 'purple',
  };
  return map[status] || 'gray';
}

export function getSeverityBadgeKey(severity) {
  const map = { low: 'green', medium: 'amber', high: 'red', critical: 'purple' };
  return map[severity] || 'gray';
}

export function formatRequestType(type) {
  const found = REQUEST_TYPES.find(t => t.id === type);
  return found?.label || type;
}
