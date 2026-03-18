// GDPR / Data Protection — Pure Functions
// UK GDPR compliance for care home special category data

// ── Engine Version ──────────────────────────────────────────────────────────
// Bump when the scoring model changes materially (penalty weights, domain structure,
// banding thresholds). Embedded in calculateGdprComplianceScore return value so
// snapshots record which engine produced them.
export const ENGINE_VERSION = 'v2';

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
    engine_version: ENGINE_VERSION,
    score: clampedScore,
    band: clampedScore >= 90 ? 'good' : clampedScore >= 70 ? 'adequate' : clampedScore >= 50 ? 'requires_improvement' : 'inadequate',
    issues,
  };
}

// ── 7-Domain Controls Model (ICO Accountability Framework) ──────────────────
// Aligned to ICO's Data Protection Audit Framework (October 2024).
// 9 ICO toolkits → 7 applicable to care home staffing (AI + Age Appropriate Design excluded).
// Each domain has sub-controls scored 0 (not evidenced) or 1 (evidenced).
// Domain score = % of evidenced controls. Overall = weighted average of assessed domains.

export const GDPR_DOMAINS = [
  { id: 'rights_management',  label: 'Rights Management',     weight: 0.20, icoToolkit: 'Requests for access' },
  { id: 'breach_management',  label: 'Breach Management',     weight: 0.20, icoToolkit: 'Personal data breach management' },
  { id: 'retention',          label: 'Records & Retention',   weight: 0.15, icoToolkit: 'Records management' },
  { id: 'accountability',     label: 'Accountability',        weight: 0.15, icoToolkit: 'Accountability' },
  { id: 'training',           label: 'Training & Awareness',  weight: 0.10, icoToolkit: 'Training and awareness' },
  { id: 'consent',            label: 'Consent & Lawful Basis',weight: 0.10, icoToolkit: 'Data sharing' },
  { id: 'security',           label: 'Information Security',  weight: 0.10, icoToolkit: 'Information & cyber security' },
];

export const GDPR_SCORE_BANDS = [
  { min: 90, label: 'Good',                   badgeKey: 'green' },
  { min: 70, label: 'Adequate',               badgeKey: 'blue' },
  { min: 50, label: 'Requires Improvement',   badgeKey: 'amber' },
  { min: 0,  label: 'Inadequate',             badgeKey: 'red' },
];

export function getGdprScoreBand(score) {
  return GDPR_SCORE_BANDS.find(b => score >= b.min) || GDPR_SCORE_BANDS[GDPR_SCORE_BANDS.length - 1];
}

// ── Provenance & Confidence ─────────────────────────────────────────────────
// Per-domain provenance: which modules feed each domain, and confidence level
// based on data availability. Mirrors CQC's METRIC_PROVENANCE pattern.

export const GDPR_DOMAIN_PROVENANCE = {
  rights_management:  { source_modules: ['data_requests'], assumptions: ['All SARs recorded in system'], exclusions: ['Verbal requests not recorded'] },
  breach_management:  { source_modules: ['data_breaches'], assumptions: ['All breaches reported and logged'], exclusions: ['Near-misses may not be captured'] },
  retention:          { source_modules: ['retention_schedule'], assumptions: ['Schedule covers all data categories'], exclusions: ['Paper records not tracked'] },
  accountability:     { source_modules: ['dp_complaints', 'data_breaches', 'ropa', 'dpia'], assumptions: ['ROPA completeness indicates Art 30 maturity', 'DPIA coverage indicates Art 35 maturity'], exclusions: ['Policy reviews not yet linked'] },
  consent:            { source_modules: ['consent_records'], assumptions: ['All processing purposes documented'], exclusions: ['Implied consent not tracked'] },
  training:           { source_modules: ['data_breaches'], assumptions: ['Breach handling maturity implies training'], exclusions: ['Training records not directly available from GDPR module'] },
  security:           { source_modules: ['data_breaches'], assumptions: ['Breach patterns indicate security posture'], exclusions: ['Technical controls not assessed'] },
};

function deriveGdprConfidence(domainId, data) {
  const r = data.requests || [];
  const b = data.breaches || [];
  const c = data.complaints || [];
  const ret = data.retentionScan || [];
  const consent = data.consent || [];

  switch (domainId) {
    case 'rights_management': return r.length > 0 ? 'high' : 'low';
    case 'breach_management': return b.length > 0 ? 'high' : 'medium';
    case 'retention': return ret.length >= 5 ? 'high' : ret.length > 0 ? 'medium' : 'low';
    case 'accountability': return (c.length > 0 || b.length > 0) ? 'medium' : 'low';
    case 'consent': return consent.length > 0 ? 'high' : 'low';
    case 'training': return b.some(x => x.root_cause) ? 'medium' : 'low';
    case 'security': return b.length > 0 ? 'medium' : 'low';
    default: return 'low';
  }
}

// Evaluate controls for a single domain. Returns { score, controls, assessed, confidence, provenance }.
// Each control: { id, label, evidenced: boolean, detail: string }.
function evaluateDomain(domainId, data) {
  const r = data.requests || [];
  const b = data.breaches || [];
  const c = data.complaints || [];
  const ret = data.retentionScan || [];
  const consent = data.consent || [];
  const controls = [];

  switch (domainId) {
    case 'rights_management': {
      const completed = r.filter(x => x.status === 'completed');
      const overdue = r.filter(x => x.status !== 'completed' && x.status !== 'rejected' && isOverdue(x.deadline));
      const total = r.filter(x => x.status !== 'rejected');
      const responseRate = total.length > 0 ? Math.round((completed.length / total.length) * 100) : null;
      controls.push({ id: 'sar_response_rate', label: 'SAR response rate ≥ 90%', evidenced: responseRate === null || responseRate >= 90, detail: responseRate != null ? `${responseRate}% (${completed.length}/${total.length})` : 'No requests' });
      controls.push({ id: 'no_overdue_requests', label: 'No overdue data requests', evidenced: overdue.length === 0, detail: overdue.length > 0 ? `${overdue.length} overdue` : 'All on time' });
      controls.push({ id: 'request_process_exists', label: 'Request handling process active', evidenced: r.length > 0 || total.length === 0, detail: `${r.length} requests recorded` });
      break;
    }
    case 'breach_management': {
      const notifiable = b.filter(x => x.ico_notifiable);
      const notified = notifiable.filter(x => x.ico_notified);
      const withDecision = b.filter(x => x.decision_at);
      const withRootCause = b.filter(x => x.root_cause);
      const open = b.filter(x => x.status === 'open');
      controls.push({ id: 'ico_notification_rate', label: 'ICO notifications on time', evidenced: notifiable.length === 0 || notified.length === notifiable.length, detail: notifiable.length > 0 ? `${notified.length}/${notifiable.length} notified` : 'No notifiable breaches' });
      controls.push({ id: 'decision_records', label: 'ICO decision records documented', evidenced: b.length === 0 || withDecision.length >= b.length * 0.8, detail: `${withDecision.length}/${b.length} documented` });
      controls.push({ id: 'root_cause_analysis', label: 'Root cause analysis completed', evidenced: b.length === 0 || withRootCause.length >= b.length * 0.8, detail: `${withRootCause.length}/${b.length} analysed` });
      controls.push({ id: 'breach_containment', label: 'All breaches contained/resolved', evidenced: open.length === 0, detail: open.length > 0 ? `${open.length} still open` : 'All resolved' });
      break;
    }
    case 'retention': {
      const hasSchedule = ret.length > 0;
      const violations = ret.filter(x => x.action_needed);
      controls.push({ id: 'retention_schedule_defined', label: 'Retention schedule defined', evidenced: hasSchedule, detail: hasSchedule ? `${ret.length} categories` : 'No schedule' });
      controls.push({ id: 'no_retention_violations', label: 'No retention violations', evidenced: violations.length === 0, detail: violations.length > 0 ? `${violations.length} violations` : 'Compliant' });
      controls.push({ id: 'retention_categories_complete', label: 'All data categories covered', evidenced: ret.length >= 5, detail: `${ret.length} categories defined` });
      break;
    }
    case 'accountability': {
      // Assessed from complaints handling, breach management maturity, ROPA, and DPIA
      const dpComplaints = c || [];
      const resolved = dpComplaints.filter(x => x.status === 'resolved' || x.status === 'closed');
      const icoEscalated = dpComplaints.filter(x => x.ico_involved && x.status !== 'resolved' && x.status !== 'closed');
      controls.push({ id: 'dp_complaints_handled', label: 'DP complaints resolved', evidenced: dpComplaints.length === 0 || resolved.length >= dpComplaints.length * 0.7, detail: `${resolved.length}/${dpComplaints.length} resolved` });
      controls.push({ id: 'no_ico_escalations', label: 'No open ICO escalations', evidenced: icoEscalated.length === 0, detail: icoEscalated.length > 0 ? `${icoEscalated.length} open` : 'None' });
      controls.push({ id: 'breach_process_mature', label: 'Breach management process active', evidenced: b.length === 0 || b.some(x => x.containment_actions), detail: b.length > 0 ? 'Active' : 'No breaches to assess' });
      // ROPA — Article 30 compliance
      const ropa = data.ropa || [];
      const activeRopa = ropa.filter(x => x.status === 'active');
      const overdueRopa = ropa.filter(x => x.next_review_due && x.next_review_due < new Date().toISOString().slice(0, 10));
      controls.push({ id: 'ropa_maintained', label: 'ROPA maintained (Art 30)', evidenced: activeRopa.length > 0, detail: `${activeRopa.length} active entries` });
      controls.push({ id: 'ropa_reviewed', label: 'ROPA reviews up to date', evidenced: overdueRopa.length === 0, detail: overdueRopa.length > 0 ? `${overdueRopa.length} overdue` : 'All current' });
      // DPIA — Article 35 compliance
      const dpia = data.dpia || [];
      const requiredDpias = dpia.filter(x => x.screening_result === 'required');
      const completedDpias = requiredDpias.filter(x => x.status === 'completed' || x.status === 'approved');
      controls.push({ id: 'dpia_completed', label: 'Required DPIAs completed', evidenced: requiredDpias.length === 0 || completedDpias.length === requiredDpias.length, detail: `${completedDpias.length}/${requiredDpias.length} complete` });
      // Cross-check: ROPA entries flagged dpia_required should have a completed DPIA
      const ropaRequiringDpia = ropa.filter(x => x.dpia_required && x.status === 'active');
      controls.push({ id: 'high_risk_covered', label: 'High-risk processing has DPIA', evidenced: ropaRequiringDpia.length === 0 || requiredDpias.length >= ropaRequiringDpia.length, detail: ropaRequiringDpia.length > 0 ? `${requiredDpias.length}/${ropaRequiringDpia.length} covered` : 'No high-risk processing' });
      break;
    }
    case 'consent': {
      controls.push({ id: 'consent_records_maintained', label: 'Consent records maintained', evidenced: consent.length > 0, detail: `${consent.length} records` });
      controls.push({ id: 'legal_basis_documented', label: 'Legal basis documented', evidenced: consent.length === 0 || consent.filter(x => x.legal_basis).length >= consent.length * 0.8, detail: consent.length > 0 ? `${consent.filter(x => x.legal_basis).length}/${consent.length} documented` : 'No records' });
      break;
    }
    case 'training': {
      // Training data not available from GDPR module alone — mark based on available signals
      // If consent records exist and breach handling is mature, training is implied
      const hasMatureProcess = b.length > 0 && b.some(x => x.root_cause) && b.some(x => x.containment_actions);
      controls.push({ id: 'dp_training_evidenced', label: 'Data protection awareness evidenced', evidenced: hasMatureProcess || b.length === 0, detail: hasMatureProcess ? 'Mature breach handling implies training' : 'Insufficient data to assess directly' });
      break;
    }
    case 'security': {
      // Security assessed through breach patterns and access logging
      const repeatedBreaches = b.length >= 3;
      controls.push({ id: 'no_repeated_breaches', label: 'No pattern of repeated breaches', evidenced: !repeatedBreaches, detail: `${b.length} total breaches` });
      controls.push({ id: 'breach_severity_managed', label: 'No critical uncontained breaches', evidenced: !b.some(x => x.severity === 'critical' && x.status === 'open'), detail: 'Checked' });
      break;
    }
  }

  const evidencedCount = controls.filter(c => c.evidenced).length;
  const score = controls.length > 0 ? Math.round((evidencedCount / controls.length) * 100) : 0;
  const confidence = deriveGdprConfidence(domainId, data);
  const provenance = GDPR_DOMAIN_PROVENANCE[domainId] || {};
  return { score, band: getGdprScoreBand(score), controls, assessed: controls.length > 0, confidence, provenance };
}

// Calculate GDPR controls score across all 7 ICO-aligned domains.
// Accepts a data object: { requests, breaches, complaints, retentionScan, consent }.
// Returns per-domain scores + overall weighted score + band.
export function calculateGdprControlsScore(data) {
  const domains = {};
  let weightedSum = 0;
  let assessedWeight = 0;

  for (const domain of GDPR_DOMAINS) {
    const result = evaluateDomain(domain.id, data);
    domains[domain.id] = { ...result, label: domain.label, weight: domain.weight, icoToolkit: domain.icoToolkit };
    if (result.assessed) {
      weightedSum += result.score * domain.weight;
      assessedWeight += domain.weight;
    }
  }

  const overallScore = assessedWeight > 0 ? Math.round(weightedSum / assessedWeight) : 0;
  const band = getGdprScoreBand(overallScore);

  // Check for critical floor: any domain at Inadequate caps overall at Requires Improvement
  const hasInadequate = Object.values(domains).some(d => d.assessed && d.band.label === 'Inadequate');
  const finalBand = hasInadequate && band.label === 'Good' ? GDPR_SCORE_BANDS[2] : band;

  // Keep legacy operational health score for backward compat
  const operationalHealth = calculateGdprComplianceScore(
    data.requests, data.breaches, data.complaints, data.retentionScan
  );

  // Overall confidence: lowest confidence across assessed domains
  const confidenceLevels = { high: 3, medium: 2, low: 1 };
  const assessedDomainsList = Object.values(domains).filter(d => d.assessed);
  const minConfidence = assessedDomainsList.length > 0
    ? assessedDomainsList.reduce((min, d) => Math.min(min, confidenceLevels[d.confidence] || 1), 3)
    : 1;
  const overallConfidence = minConfidence >= 3 ? 'high' : minConfidence >= 2 ? 'medium' : 'low';

  return {
    engine_version: ENGINE_VERSION,
    overallScore,
    band: finalBand,
    confidence: overallConfidence,
    domains,
    operationalHealth,
    assessedDomains: assessedDomainsList.length,
    totalDomains: GDPR_DOMAINS.length,
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
