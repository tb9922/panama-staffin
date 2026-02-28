// Complaints & Feedback — Constants, Helpers, CQC Metric Calculators
// Maps to QS23 (Complaints & Feedback) — CQC Regulation 16

import { formatDate, parseDate, addDays } from './rotation.js';

// ── Default Complaint Categories ────────────────────────────────────────────

export const DEFAULT_COMPLAINT_CATEGORIES = [
  { id: 'care-quality',   name: 'Quality of Care',           active: true },
  { id: 'medication',     name: 'Medication Management',     active: true },
  { id: 'staffing',       name: 'Staffing & Availability',   active: true },
  { id: 'communication',  name: 'Communication',             active: true },
  { id: 'facilities',     name: 'Facilities & Environment',  active: true },
  { id: 'food',           name: 'Meals & Nutrition',          active: true },
  { id: 'dignity',        name: 'Dignity & Respect',          active: true },
  { id: 'other',          name: 'Other',                      active: true },
];

export const COMPLAINT_STATUSES = [
  { id: 'open',           name: 'Open',           badgeKey: 'red' },
  { id: 'acknowledged',   name: 'Acknowledged',   badgeKey: 'amber' },
  { id: 'investigating',  name: 'Investigating',  badgeKey: 'amber' },
  { id: 'resolved',       name: 'Resolved',       badgeKey: 'green' },
  { id: 'closed',         name: 'Closed',         badgeKey: 'gray' },
];

export const RAISED_BY_TYPES = [
  { id: 'resident', name: 'Resident' },
  { id: 'family',   name: 'Family Member' },
  { id: 'staff',    name: 'Staff' },
  { id: 'visitor',  name: 'Visitor' },
  { id: 'other',    name: 'Other' },
];

export const SURVEY_TYPES = [
  { id: 'residents', name: 'Resident Survey' },
  { id: 'families',  name: 'Family Survey' },
  { id: 'staff',     name: 'Staff Survey' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

export function getComplaintCategories(config) {
  return config?.complaint_categories?.length > 0 ? config.complaint_categories : DEFAULT_COMPLAINT_CATEGORIES;
}

export function ensureComplaintDefaults(data) {
  let changed = false;
  let result = data;
  if (!data.complaints) {
    result = { ...result, complaints: [] };
    changed = true;
  }
  if (!data.complaint_surveys) {
    result = { ...result, complaint_surveys: [] };
    changed = true;
  }
  if (!data.config?.complaint_response_days) {
    result = { ...result, config: { ...result.config, complaint_response_days: 28 } };
    changed = true;
  }
  return changed ? result : null;
}

// ── Status Calculation ──────────────────────────────────────────────────────

export function getComplaintStatus(complaint, config) {
  const today = formatDate(new Date());
  const responseDays = config?.complaint_response_days || 28;
  const deadline = complaint.response_deadline || (complaint.date ? formatDate(addDays(parseDate(complaint.date), responseDays)) : null);

  const isAcknowledged = !!complaint.acknowledged_date;
  const isOverdueAck = !isAcknowledged && complaint.date && today > formatDate(addDays(parseDate(complaint.date), 2));
  const isOverdueResponse = !['resolved', 'closed'].includes(complaint.status) && deadline && today > deadline;
  const isResolved = complaint.status === 'resolved' || complaint.status === 'closed';

  let responseDaysActual = null;
  if (isResolved && complaint.date && complaint.resolution_date) {
    const start = parseDate(complaint.date);
    const end = parseDate(complaint.resolution_date);
    responseDaysActual = Math.round((end - start) / (1000 * 60 * 60 * 24));
  }

  return { isAcknowledged, isOverdueAck, isOverdueResponse, isResolved, responseDaysActual, deadline };
}

// ── Stats ───────────────────────────────────────────────────────────────────

export function getComplaintStats(complaints, config, fromDate, toDate) {
  const filtered = complaints.filter(c => {
    if (fromDate && c.date < fromDate) return false;
    if (toDate && c.date > toDate) return false;
    return true;
  });

  const total = filtered.length;
  const open = filtered.filter(c => c.status === 'open' || c.status === 'acknowledged' || c.status === 'investigating').length;
  const resolved = filtered.filter(c => c.status === 'resolved' || c.status === 'closed').length;
  const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 100;

  let totalResponseDays = 0;
  let resolvedWithDays = 0;
  let overdue = 0;

  for (const c of filtered) {
    const st = getComplaintStatus(c, config);
    if (st.responseDaysActual !== null) {
      totalResponseDays += st.responseDaysActual;
      resolvedWithDays++;
    }
    if (st.isOverdueResponse) overdue++;
  }

  const avgResponseDays = resolvedWithDays > 0 ? Math.round(totalResponseDays / resolvedWithDays) : null;

  return { total, open, resolved, resolutionRate, avgResponseDays, overdue };
}

export function getSurveyStats(surveys, fromDate, toDate) {
  const filtered = surveys.filter(s => {
    if (fromDate && s.date < fromDate) return false;
    if (toDate && s.date > toDate) return false;
    return true;
  });

  if (filtered.length === 0) return { avgSatisfaction: null, totalResponses: 0, surveyCount: 0, responseRate: null };

  let totalSat = 0;
  let totalResponses = 0;
  let totalSent = 0;

  for (const s of filtered) {
    if (s.overall_satisfaction) totalSat += s.overall_satisfaction;
    totalResponses += (s.responses || 0);
    totalSent += (s.total_sent || 0);
  }

  const avgSatisfaction = filtered.filter(s => s.overall_satisfaction).length > 0
    ? Math.round((totalSat / filtered.filter(s => s.overall_satisfaction).length) * 10) / 10
    : null;
  const responseRate = totalSent > 0 ? Math.round((totalResponses / totalSent) * 100) : null;

  return { avgSatisfaction, totalResponses, surveyCount: filtered.length, responseRate };
}

// ── Dashboard Alerts ────────────────────────────────────────────────────────

export function getComplaintAlerts(complaints, config) {
  const alerts = [];
  const _today = formatDate(new Date());

  for (const c of complaints) {
    if (c.status === 'resolved' || c.status === 'closed') continue;
    const st = getComplaintStatus(c, config);

    if (st.isOverdueAck) {
      alerts.push({ type: 'error', msg: `Complaint "${c.title || 'Untitled'}" not acknowledged within 2 days` });
    }
    if (st.isOverdueResponse) {
      alerts.push({ type: 'warning', msg: `Complaint "${c.title || 'Untitled'}" response deadline overdue` });
    }
  }

  return alerts;
}

export function getSurveyAlerts(surveys, _config) {
  const alerts = [];
  if (!surveys || surveys.length === 0) return alerts;

  const recent = surveys.filter(s => s.overall_satisfaction).sort((a, b) => b.date.localeCompare(a.date));
  if (recent.length > 0 && recent[0].overall_satisfaction < 3.5) {
    alerts.push({ type: 'warning', msg: `Latest survey satisfaction score below 3.5 (${recent[0].overall_satisfaction}/5)` });
  }

  return alerts;
}

// ── CQC Metrics ─────────────────────────────────────────────────────────────

export function calculateComplaintResolutionRate(complaints, fromDate, toDate) {
  const filtered = complaints.filter(c => {
    if (fromDate && c.date < fromDate) return false;
    if (toDate && c.date > toDate) return false;
    return true;
  });

  if (filtered.length === 0) return { score: 100, resolved: 0, total: 0 };

  const resolved = filtered.filter(c => c.status === 'resolved' || c.status === 'closed').length;
  const score = Math.round((resolved / filtered.length) * 100);

  return { score, resolved, total: filtered.length };
}

export function calculateSatisfactionScore(surveys, fromDate, toDate) {
  const filtered = surveys.filter(s => {
    if (fromDate && s.date < fromDate) return false;
    if (toDate && s.date > toDate) return false;
    return s.overall_satisfaction;
  });

  if (filtered.length === 0) return { score: null, avgScore: null, totalSurveys: 0 };

  const avg = filtered.reduce((sum, s) => sum + s.overall_satisfaction, 0) / filtered.length;
  const score = Math.round((avg / 5) * 100);

  return { score, avgScore: Math.round(avg * 10) / 10, totalSurveys: filtered.length };
}
