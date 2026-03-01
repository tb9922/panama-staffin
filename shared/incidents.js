// Incident & Safety Reporting — Constants, Helpers, CQC Metric Calculators

import { formatDate, parseDate, addDays } from './rotation.js';

// ── Default Incident Types (configurable via config.incident_types) ─────────

export const DEFAULT_INCIDENT_TYPES = [
  { id: 'fall',              name: 'Fall / Slip / Trip',          category: 'clinical',      active: true },
  { id: 'medication-error',  name: 'Medication Error',            category: 'clinical',      active: true },
  { id: 'pressure-ulcer',    name: 'Pressure Ulcer',              category: 'clinical',      active: true },
  { id: 'choking',           name: 'Choking Incident',            category: 'clinical',      active: true },
  { id: 'infection',         name: 'Infection Outbreak',          category: 'clinical',      active: true },
  { id: 'death',             name: 'Death (Expected/Unexpected)', category: 'clinical',      active: true },
  { id: 'abuse-allegation',  name: 'Abuse / Neglect Allegation',  category: 'safeguarding',  active: true },
  { id: 'self-harm',         name: 'Self-Harm',                   category: 'safeguarding',  active: true },
  { id: 'missing-person',    name: 'Missing / Absent Person',     category: 'safeguarding',  active: true },
  { id: 'injury-staff',      name: 'Staff Injury',                category: 'workplace',     active: true },
  { id: 'injury-visitor',    name: 'Visitor Injury',              category: 'workplace',     active: true },
  { id: 'near-miss',         name: 'Near Miss',                   category: 'workplace',     active: true },
  { id: 'behaviour',         name: 'Challenging Behaviour',       category: 'behavioural',   active: true },
  { id: 'fire',              name: 'Fire / Fire Alarm',           category: 'environmental', active: true },
  { id: 'security',          name: 'Security Breach',             category: 'environmental', active: true },
  { id: 'equipment-failure', name: 'Equipment Failure',           category: 'environmental', active: true },
  { id: 'other',             name: 'Other',                       category: 'other',         active: true },
];

export const INCIDENT_CATEGORIES = [
  { id: 'clinical',      name: 'Clinical' },
  { id: 'safeguarding',  name: 'Safeguarding' },
  { id: 'workplace',     name: 'Workplace' },
  { id: 'behavioural',   name: 'Behavioural' },
  { id: 'environmental', name: 'Environmental' },
  { id: 'other',         name: 'Other' },
];

export const SEVERITY_LEVELS = [
  { id: 'minor',        name: 'Minor',        badgeKey: 'green',  description: 'No injury or very minor. No treatment needed.' },
  { id: 'moderate',     name: 'Moderate',      badgeKey: 'amber',  description: 'Minor injury, first aid applied. Short-term impact.' },
  { id: 'serious',      name: 'Serious',       badgeKey: 'orange', description: 'Injury requiring treatment. Potential for notification.' },
  { id: 'major',        name: 'Major',         badgeKey: 'red',    description: 'Significant injury, hospital attendance. CQC notifiable.' },
  { id: 'catastrophic', name: 'Catastrophic',  badgeKey: 'red',    description: 'Death or life-threatening. Immediate notification required.' },
];

export const INVESTIGATION_STATUSES = [
  { id: 'open',         name: 'Open',         badgeKey: 'red' },
  { id: 'under_review', name: 'Under Review', badgeKey: 'amber' },
  { id: 'closed',       name: 'Closed',       badgeKey: 'green' },
];

export const LOCATIONS = [
  { id: 'bedroom',          name: 'Bedroom' },
  { id: 'bathroom',         name: 'Bathroom' },
  { id: 'corridor',         name: 'Corridor' },
  { id: 'lounge',           name: 'Lounge' },
  { id: 'dining_room',      name: 'Dining Room' },
  { id: 'kitchen',          name: 'Kitchen' },
  { id: 'garden',           name: 'Garden / Outside' },
  { id: 'staircase',        name: 'Staircase' },
  { id: 'entrance',         name: 'Entrance / Reception' },
  { id: 'medication_room',  name: 'Medication Room' },
  { id: 'office',           name: 'Office' },
  { id: 'laundry',          name: 'Laundry' },
  { id: 'other',            name: 'Other' },
];

export const CQC_NOTIFICATION_TYPES = [
  { id: 'death',                   name: 'Death of a service user',               deadline: 'immediate' },
  { id: 'serious_injury',         name: 'Serious injury',                        deadline: '72h' },
  { id: 'abuse_allegation',       name: 'Abuse / allegation of abuse',           deadline: 'immediate' },
  { id: 'police',                 name: 'Police involvement / criminal offence', deadline: 'immediate' },
  { id: 'deprivation_of_liberty', name: 'Deprivation of Liberty application',    deadline: '72h' },
  { id: 'seclusion_restraint',    name: 'Seclusion or restraint',                deadline: '72h' },
  { id: 'other',                  name: 'Other notifiable event',                deadline: '72h' },
];

export const RIDDOR_CATEGORIES = [
  { id: 'death',                name: 'Death',                      deadlineDays: 0 },
  { id: 'specified_injury',     name: 'Specified Injury',           deadlineDays: 0 },
  { id: 'over_7_day',           name: 'Over 7-day Incapacitation',  deadlineDays: 15 },
  { id: 'dangerous_occurrence', name: 'Dangerous Occurrence',       deadlineDays: 0 },
];

export const PERSON_AFFECTED_TYPES = [
  { id: 'resident', name: 'Resident' },
  { id: 'staff',    name: 'Staff' },
  { id: 'visitor',  name: 'Visitor' },
  { id: 'multiple', name: 'Multiple People' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getIncidentTypes(config) {
  return config?.incident_types?.length > 0 ? config.incident_types : DEFAULT_INCIDENT_TYPES;
}

export function ensureIncidentDefaults(data) {
  let changed = false;
  let result = data;
  if (!data.incidents) {
    result = { ...result, incidents: [] };
    changed = true;
  }
  if (!data.config?.incident_types) {
    result = { ...result, config: { ...result.config, incident_types: DEFAULT_INCIDENT_TYPES } };
    changed = true;
  }
  return changed ? result : null;
}

// ── CQC Notification Deadline ─────────────────────────────────────────────

export function getCqcNotificationDeadline(incident, asOfDate = new Date()) {
  if (!incident.cqc_notifiable || !incident.date) return { deadline: null, hoursAllowed: null, isOverdue: false };

  const hoursAllowed = incident.cqc_notification_deadline === 'immediate' ? 24 : 72;
  const incidentTime = incident.time || '00:00';
  // Append 'Z' to parse as UTC, avoiding BST/GMT offset in deadline calculation
  const incidentDate = new Date(incident.date + 'T' + incidentTime + ':00Z');
  const deadline = new Date(incidentDate.getTime() + hoursAllowed * 60 * 60 * 1000);

  if (incident.cqc_notified) return { deadline, hoursAllowed, isOverdue: false };
  return { deadline, hoursAllowed, isOverdue: asOfDate > deadline };
}

export function isCqcNotificationOverdue(incident, asOfDate = new Date()) {
  return getCqcNotificationDeadline(incident, asOfDate).isOverdue;
}

export function isRiddorOverdue(incident, asOfDate = new Date()) {
  if (!incident.riddor_reportable || !incident.date || incident.riddor_reported) return false;
  const cat = RIDDOR_CATEGORIES.find(r => r.id === incident.riddor_category);
  if (!cat) return false;
  const incidentDate = parseDate(incident.date);
  // deadlineDays=0 means "immediate" — give until end of next day (day + 1)
  // deadlineDays=15 means "within 15 calendar days" — deadline is exactly day 15 (no +1)
  const deadline = addDays(incidentDate, cat.deadlineDays === 0 ? 1 : cat.deadlineDays);
  return asOfDate > deadline;
}

// ── Stats ────────────────────────────────────────────────────────────────────

function filterByDateRange(incidents, fromDate, toDate) {
  return incidents.filter(inc => inc.date >= fromDate && inc.date <= toDate);
}

export function getIncidentStats(incidents, config, fromDate, toDate) {
  const filtered = filterByDateRange(incidents || [], fromDate, toDate);

  const bySeverity = {};
  const byType = {};
  let openInvestigations = 0;
  let pendingCqcNotifications = 0;
  let overdueNotifications = 0;
  let totalResponseHours = 0;
  let respondedCount = 0;

  for (const inc of filtered) {
    bySeverity[inc.severity] = (bySeverity[inc.severity] || 0) + 1;
    byType[inc.type] = (byType[inc.type] || 0) + 1;

    if (inc.investigation_status !== 'closed') openInvestigations++;

    if (inc.cqc_notifiable && !inc.cqc_notified) {
      pendingCqcNotifications++;
      if (isCqcNotificationOverdue(inc)) overdueNotifications++;
    }

    if (inc.cqc_notifiable && inc.cqc_notified && inc.cqc_notified_date && inc.date) {
      const incTime = new Date(inc.date + 'T' + (inc.time || '00:00') + ':00');
      const notifiedTime = new Date(inc.cqc_notified_date + 'T00:00:00');
      const hours = Math.max(0, (notifiedTime - incTime) / (1000 * 60 * 60));
      totalResponseHours += hours;
      respondedCount++;
    }
  }

  return {
    total: filtered.length,
    bySeverity,
    byType,
    openInvestigations,
    pendingCqcNotifications,
    overdueNotifications,
    avgResponseTimeHours: respondedCount > 0 ? Math.round(totalResponseHours / respondedCount * 10) / 10 : null,
  };
}

// ── Dashboard Alerts ─────────────────────────────────────────────────────────

export function getIncidentAlerts(incidents) {
  const alerts = [];
  const now = new Date();

  for (const inc of (incidents || [])) {
    // CQC/RIDDOR/DoC alerts fire regardless of investigation status — a closed
    // investigation does not excuse a missed regulatory notification.

    // Overdue CQC notifications
    if (isCqcNotificationOverdue(inc)) {
      const typeDef = getIncidentTypes(null).find(t => t.id === inc.type);
      alerts.push({ type: 'error', msg: `Incident ${inc.date}: CQC notification OVERDUE — ${typeDef?.name || inc.type}` });
    }

    // Overdue RIDDOR
    if (isRiddorOverdue(inc)) {
      alerts.push({ type: 'error', msg: `Incident ${inc.date}: RIDDOR report OVERDUE` });
    }

    // Overdue Duty of Candour
    if (isDutyOfCandourOverdue(inc)) {
      alerts.push({ type: 'error', msg: `Incident ${inc.date}: Duty of Candour notification OVERDUE` });
    }

    // Stale open investigations (>14 days) — only relevant if not closed
    if (inc.investigation_status !== 'closed' && inc.date) {
      const incDate = parseDate(inc.date);
      const daysSince = Math.floor((now - incDate) / (1000 * 60 * 60 * 24));
      if (daysSince > 14) {
        alerts.push({ type: 'warning', msg: `Incident ${inc.date}: Investigation open for ${daysSince} days — ${inc.severity} severity` });
      }
    }

    // Overdue corrective actions — fire regardless of investigation status
    const todayStr = formatDate(now);
    for (const action of (inc.corrective_actions || [])) {
      if (action.status !== 'completed' && action.due_date && action.due_date < todayStr) {
        alerts.push({ type: 'warning', msg: `Incident ${inc.date}: Corrective action overdue — "${(action.description || '').substring(0, 40)}"` });
      }
    }
  }

  return alerts;
}

// ── CQC Metric: Incident Response Time ──────────────────────────────────────

export function calculateIncidentResponseTime(incidents, fromDate, toDate) {
  const filtered = filterByDateRange(incidents || [], fromDate, toDate);
  const notifiable = filtered.filter(inc => inc.cqc_notifiable);

  if (notifiable.length === 0) return { score: 100, avgHours: null, onTime: 0, total: 0 };

  let onTime = 0;
  let totalHours = 0;
  let respondedCount = 0;

  for (const inc of notifiable) {
    if (!inc.cqc_notified) continue;
    respondedCount++;

    const incTime = new Date(inc.date + 'T' + (inc.time || '00:00') + ':00');
    const notifiedTime = new Date(inc.cqc_notified_date + 'T00:00:00');
    const hours = Math.max(0, (notifiedTime - incTime) / (1000 * 60 * 60));
    totalHours += hours;

    const deadline = getCqcNotificationDeadline(inc);
    if (deadline.hoursAllowed && hours <= deadline.hoursAllowed) onTime++;
  }

  const score = respondedCount > 0 ? Math.round((onTime / respondedCount) * 100) : (notifiable.length > 0 ? 0 : 100);
  const avgHours = respondedCount > 0 ? Math.round(totalHours / respondedCount * 10) / 10 : null;

  return { score, avgHours, onTime, total: notifiable.length };
}

// ── CQC Metric: CQC Notifications Compliance ────────────────────────────────

export function calculateCqcNotificationsPct(incidents, fromDate, toDate) {
  const filtered = filterByDateRange(incidents || [], fromDate, toDate);
  const notifiable = filtered.filter(inc => inc.cqc_notifiable);

  if (notifiable.length === 0) return { score: 100, onTime: 0, total: 0 };

  let onTime = 0;
  let respondedCount = 0;
  for (const inc of notifiable) {
    if (!inc.cqc_notified || !inc.cqc_notified_date) continue;
    respondedCount++;
    const incTime = new Date(inc.date + 'T' + (inc.time || '00:00') + ':00');
    const notifiedTime = new Date(inc.cqc_notified_date + 'T00:00:00');
    const hours = (notifiedTime - incTime) / (1000 * 60 * 60);
    const deadline = getCqcNotificationDeadline(inc);
    if (deadline.hoursAllowed && hours <= deadline.hoursAllowed) onTime++;
  }

  const score = respondedCount > 0 ? Math.round((onTime / respondedCount) * 100) : (notifiable.length > 0 ? 0 : 100);
  return { score, onTime, total: notifiable.length };
}

// ── CQC Evidence: Safeguarding Incidents (S3) ────────────────────────────────

export function getSafeguardingIncidentStats(incidents, fromDate, toDate) {
  const filtered = filterByDateRange(incidents || [], fromDate, toDate);
  const sgTypes = ['abuse-allegation', 'self-harm', 'missing-person'];
  const sgIncidents = filtered.filter(inc => sgTypes.includes(inc.type));
  const withReferral = sgIncidents.filter(inc => inc.safeguarding_referral).length;

  return {
    total: sgIncidents.length,
    withReferral,
    referralPct: sgIncidents.length > 0 ? Math.round((withReferral / sgIncidents.length) * 100) : 100,
  };
}

// ── Duty of Candour ──────────────────────────────────────────────────────────

export function isDutyOfCandourOverdue(incident) {
  if (!incident.duty_of_candour_applies || !incident.date) return false;
  if (incident.candour_notification_date) return false;
  const incDate = parseDate(incident.date);
  const deadlineDays = 14; // 10 working days ≈ 14 calendar days
  const deadline = addDays(incDate, deadlineDays);
  return new Date() > deadline;
}

// ── Corrective Action Completion Rate ────────────────────────────────────────

export function calculateActionCompletionRate(incidents, fromDate, toDate) {
  const filtered = filterByDateRange(incidents || [], fromDate, toDate);
  let total = 0, completed = 0, overdue = 0;
  const now = formatDate(new Date());

  for (const inc of filtered) {
    const actions = inc.corrective_actions || [];
    for (const action of actions) {
      total++;
      if (action.status === 'completed') completed++;
      else if (action.due_date && action.due_date < now) overdue++;
    }
  }

  return {
    total,
    completed,
    overdue,
    completionPct: total > 0 ? Math.round((completed / total) * 100) : 100,
  };
}

// ── CQC Evidence: Incident Trends (WL2) ─────────────────────────────────────

export function getIncidentTrendData(incidents, fromDate, toDate) {
  const filtered = filterByDateRange(incidents || [], fromDate, toDate);
  const byMonth = {};

  for (const inc of filtered) {
    const month = inc.date.substring(0, 7); // YYYY-MM
    byMonth[month] = (byMonth[month] || 0) + 1;
  }

  const monthlyTrend = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));

  return { monthlyTrend };
}
