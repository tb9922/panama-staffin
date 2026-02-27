// HR Module — Constants, Helpers, CQC Metric Calculators
// Covers: Disciplinary, Grievance, Performance, Absence, Contracts,
// Family Leave, Flexible Working, EDI, TUPE, RTW/DBS Renewals

// ── Disciplinary ──────────────────────────────────────────────────────────────

export const DISCIPLINARY_CATEGORIES = [
  { id: 'misconduct', name: 'Misconduct' },
  { id: 'gross_misconduct', name: 'Gross Misconduct' },
  { id: 'capability', name: 'Capability' },
  { id: 'attendance', name: 'Attendance' },
  { id: 'conduct', name: 'Conduct' },
  { id: 'other', name: 'Other' },
];

export const DISCIPLINARY_STATUSES = [
  { id: 'open', name: 'Open', badgeKey: 'blue' },
  { id: 'investigation', name: 'Investigation', badgeKey: 'amber' },
  { id: 'hearing_scheduled', name: 'Hearing Scheduled', badgeKey: 'orange' },
  { id: 'outcome_issued', name: 'Outcome Issued', badgeKey: 'green' },
  { id: 'appeal_pending', name: 'Appeal Pending', badgeKey: 'purple' },
  { id: 'appeal_complete', name: 'Appeal Complete', badgeKey: 'purple' },
  { id: 'closed', name: 'Closed', badgeKey: 'gray' },
  { id: 'withdrawn', name: 'Withdrawn', badgeKey: 'gray' },
];

export const DISCIPLINARY_OUTCOMES = [
  { id: 'no_action', name: 'No Action' },
  { id: 'verbal_warning', name: 'Verbal Warning' },
  { id: 'first_written', name: 'First Written Warning' },
  { id: 'final_written', name: 'Final Written Warning' },
  { id: 'dismissal', name: 'Dismissal' },
  { id: 'demotion', name: 'Demotion' },
  { id: 'transfer', name: 'Transfer' },
];

export const DISCIPLINARY_SOURCES = [
  { id: 'incident', name: 'Incident' },
  { id: 'complaint', name: 'Complaint' },
  { id: 'observation', name: 'Observation' },
  { id: 'whistleblowing', name: 'Whistleblowing' },
  { id: 'other', name: 'Other' },
];

export const INVESTIGATION_STATUSES = [
  { id: 'not_started', name: 'Not Started' },
  { id: 'in_progress', name: 'In Progress' },
  { id: 'complete', name: 'Complete' },
];

export const INVESTIGATION_RECOMMENDATIONS = [
  { id: 'no_action', name: 'No Action' },
  { id: 'informal_warning', name: 'Informal Warning' },
  { id: 'formal_hearing', name: 'Formal Hearing' },
  { id: 'refer_police', name: 'Refer to Police' },
  { id: 'refer_safeguarding', name: 'Refer to Safeguarding' },
];

export const HEARING_STATUSES = [
  { id: 'not_scheduled', name: 'Not Scheduled' },
  { id: 'scheduled', name: 'Scheduled' },
  { id: 'held', name: 'Held' },
  { id: 'adjourned', name: 'Adjourned' },
  { id: 'cancelled', name: 'Cancelled' },
];

export const APPEAL_STATUSES = [
  { id: 'none', name: 'None' },
  { id: 'requested', name: 'Requested' },
  { id: 'scheduled', name: 'Scheduled' },
  { id: 'held', name: 'Held' },
  { id: 'decided', name: 'Decided' },
];

export const APPEAL_OUTCOMES = [
  { id: 'upheld', name: 'Upheld' },
  { id: 'partially_upheld', name: 'Partially Upheld' },
  { id: 'overturned', name: 'Overturned' },
];

export const OUTCOME_LETTER_METHODS = [
  { id: 'hand_delivered', name: 'Hand Delivered' },
  { id: 'recorded_post', name: 'Recorded Post' },
  { id: 'email', name: 'Email' },
];

export const CLOSED_REASONS = [
  { id: 'resolved', name: 'Resolved' },
  { id: 'warning_expired', name: 'Warning Expired' },
  { id: 'appeal_overturned', name: 'Appeal Overturned' },
  { id: 'employee_left', name: 'Employee Left' },
  { id: 'withdrawn', name: 'Withdrawn' },
];

export const COMPANION_ROLES = [
  { id: 'colleague', name: 'Colleague' },
  { id: 'trade_union_rep', name: 'Trade Union Rep' },
];

// ── Grievance ─────────────────────────────────────────────────────────────────

export const GRIEVANCE_CATEGORIES = [
  { id: 'pay', name: 'Pay & Benefits' },
  { id: 'bullying', name: 'Bullying & Harassment' },
  { id: 'discrimination', name: 'Discrimination' },
  { id: 'working_conditions', name: 'Working Conditions' },
  { id: 'management', name: 'Management' },
  { id: 'contractual', name: 'Contractual' },
  { id: 'other', name: 'Other' },
];

export const GRIEVANCE_STATUSES = [
  { id: 'open', name: 'Open', badgeKey: 'blue' },
  { id: 'acknowledged', name: 'Acknowledged', badgeKey: 'blue' },
  { id: 'investigation', name: 'Investigation', badgeKey: 'amber' },
  { id: 'hearing_scheduled', name: 'Hearing Scheduled', badgeKey: 'orange' },
  { id: 'decided', name: 'Decided', badgeKey: 'green' },
  { id: 'appeal', name: 'Under Appeal', badgeKey: 'purple' },
  { id: 'closed', name: 'Closed', badgeKey: 'gray' },
  { id: 'withdrawn', name: 'Withdrawn', badgeKey: 'gray' },
];

// ── Performance ───────────────────────────────────────────────────────────────

export const PERFORMANCE_TYPES = [
  { id: 'capability', name: 'Capability' },
  { id: 'pip', name: 'Performance Improvement Plan' },
  { id: 'probation_concern', name: 'Probation Concern' },
];

export const PERFORMANCE_STATUSES = [
  { id: 'open', name: 'Open', badgeKey: 'blue' },
  { id: 'informal', name: 'Informal Stage', badgeKey: 'blue' },
  { id: 'pip_active', name: 'PIP Active', badgeKey: 'amber' },
  { id: 'hearing_scheduled', name: 'Hearing Scheduled', badgeKey: 'orange' },
  { id: 'decided', name: 'Decided', badgeKey: 'green' },
  { id: 'appeal', name: 'Under Appeal', badgeKey: 'purple' },
  { id: 'closed', name: 'Closed', badgeKey: 'gray' },
];

// ── Contract Types ────────────────────────────────────────────────────────────

export const CONTRACT_TYPES = [
  { id: 'permanent', name: 'Permanent' },
  { id: 'fixed_term', name: 'Fixed Term' },
  { id: 'zero_hours', name: 'Zero Hours' },
  { id: 'bank', name: 'Bank' },
  { id: 'agency', name: 'Agency' },
  { id: 'apprenticeship', name: 'Apprenticeship' },
];

export const CONTRACT_STATUSES = [
  { id: 'active', name: 'Active', badgeKey: 'green' },
  { id: 'probation', name: 'Probation', badgeKey: 'amber' },
  { id: 'notice', name: 'Notice Period', badgeKey: 'orange' },
  { id: 'terminated', name: 'Terminated', badgeKey: 'red' },
  { id: 'expired', name: 'Expired', badgeKey: 'gray' },
];

// ── Family Leave Types (ERA 2025 day-one rights) ─────────────────────────────

export const FAMILY_LEAVE_TYPES = [
  { id: 'maternity', name: 'Maternity Leave' },
  { id: 'paternity', name: 'Paternity Leave' },
  { id: 'shared_parental', name: 'Shared Parental Leave' },
  { id: 'adoption', name: 'Adoption Leave' },
  { id: 'parental', name: 'Parental Leave (Unpaid)' },
  { id: 'bereavement', name: 'Parental Bereavement' },
  { id: 'neonatal', name: 'Neonatal Care Leave' },
];

export const FAMILY_LEAVE_STATUSES = [
  { id: 'planned', name: 'Planned', badgeKey: 'blue' },
  { id: 'active', name: 'Active', badgeKey: 'green' },
  { id: 'ended', name: 'Ended', badgeKey: 'gray' },
  { id: 'cancelled', name: 'Cancelled', badgeKey: 'gray' },
];

// ── Flexible Working ──────────────────────────────────────────────────────────

export const FLEX_WORKING_STATUSES = [
  { id: 'pending', name: 'Pending', badgeKey: 'blue' },
  { id: 'meeting_scheduled', name: 'Meeting Scheduled', badgeKey: 'amber' },
  { id: 'decided', name: 'Decided', badgeKey: 'green' },
  { id: 'implemented', name: 'Implemented', badgeKey: 'green' },
  { id: 'appealed', name: 'Under Appeal', badgeKey: 'purple' },
  { id: 'withdrawn', name: 'Withdrawn', badgeKey: 'gray' },
];

export const FLEX_REFUSAL_REASONS = [
  { id: 'burden_of_additional_costs', name: 'Burden of additional costs' },
  { id: 'detrimental_to_meet_customer_demand', name: 'Detrimental to meet customer demand' },
  { id: 'inability_to_reorganise_work', name: 'Inability to reorganise work' },
  { id: 'inability_to_recruit_additional_staff', name: 'Inability to recruit additional staff' },
  { id: 'detrimental_to_quality', name: 'Detrimental to quality' },
  { id: 'detrimental_to_performance', name: 'Detrimental to performance' },
  { id: 'insufficiency_of_work_during_periods', name: 'Insufficiency of work during periods' },
  { id: 'planned_structural_changes', name: 'Planned structural changes' },
];

// ── EDI ───────────────────────────────────────────────────────────────────────

export const EDI_RECORD_TYPES = [
  { id: 'harassment_complaint', name: 'Harassment Complaint' },
  { id: 'reasonable_adjustment', name: 'Reasonable Adjustment' },
];

export const EDI_STATUSES = [
  { id: 'open', name: 'Open', badgeKey: 'blue' },
  { id: 'investigating', name: 'Investigating', badgeKey: 'amber' },
  { id: 'resolved', name: 'Resolved', badgeKey: 'green' },
  { id: 'closed', name: 'Closed', badgeKey: 'gray' },
  { id: 'escalated', name: 'Escalated', badgeKey: 'red' },
];

export const HARASSMENT_CATEGORIES = [
  { id: 'sexual_harassment', name: 'Sexual Harassment' },
  { id: 'racial', name: 'Racial' },
  { id: 'disability', name: 'Disability' },
  { id: 'age', name: 'Age' },
  { id: 'religion', name: 'Religion' },
  { id: 'gender', name: 'Gender' },
  { id: 'other', name: 'Other' },
];

// ── TUPE ──────────────────────────────────────────────────────────────────────

export const TUPE_STATUSES = [
  { id: 'planned', name: 'Planned', badgeKey: 'blue' },
  { id: 'consultation', name: 'Consultation', badgeKey: 'amber' },
  { id: 'transferred', name: 'Transferred', badgeKey: 'green' },
  { id: 'complete', name: 'Complete', badgeKey: 'gray' },
];

// ── RTW/DBS Renewals ──────────────────────────────────────────────────────────

export const RENEWAL_CHECK_TYPES = [
  { id: 'dbs', name: 'DBS Check' },
  { id: 'rtw', name: 'Right to Work' },
];

export const RENEWAL_STATUSES = [
  { id: 'current', name: 'Current', badgeKey: 'green' },
  { id: 'due_soon', name: 'Due Soon', badgeKey: 'amber' },
  { id: 'overdue', name: 'Overdue', badgeKey: 'red' },
  { id: 'pending', name: 'Pending', badgeKey: 'blue' },
  { id: 'expired', name: 'Expired', badgeKey: 'gray' },
];

// ── Bradford Factor ───────────────────────────────────────────────────────────

export const BRADFORD_TRIGGERS = [
  { threshold: 801, level: 'final', name: 'Final Stage', badgeKey: 'red' },
  { threshold: 401, level: 'stage_2', name: 'Stage 2', badgeKey: 'red' },
  { threshold: 201, level: 'stage_1', name: 'Stage 1', badgeKey: 'amber' },
  { threshold: 51, level: 'informal', name: 'Informal Discussion', badgeKey: 'amber' },
  { threshold: 0, level: 'none', name: 'Normal', badgeKey: 'green' },
];

// ── Warning Levels (for warning register display) ─────────────────────────────

export const WARNING_LEVELS = [
  { id: 'summary_dismissal', name: 'Summary Dismissal', badgeKey: 'red' },
  { id: 'dismissal', name: 'Dismissal', badgeKey: 'red' },
  { id: 'final_written', name: 'Final Written Warning', badgeKey: 'red' },
  { id: 'first_written', name: 'First Written Warning', badgeKey: 'amber' },
  { id: 'informal_warning', name: 'Informal Warning', badgeKey: 'amber' },
];

// ── Case Note Types ───────────────────────────────────────────────────────────

export const CASE_NOTE_TYPES = [
  'disciplinary', 'grievance', 'performance', 'rtw_interview',
  'oh_referral', 'contract', 'family_leave', 'flexible_working',
  'edi', 'tupe', 'renewal',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getStatusBadge(statusId, statusList) {
  const s = statusList.find(entry => entry.id === statusId);
  return s ? s.badgeKey : 'gray';
}

export function getAbsenceTriggerBadge(triggerLevel) {
  const entry = BRADFORD_TRIGGERS.find(t => t.level === triggerLevel);
  return entry || BRADFORD_TRIGGERS[BRADFORD_TRIGGERS.length - 1];
}

// ── HR Alerts (for Dashboard integration) ─────────────────────────────────────
// Takes the stats and warnings objects from the API and generates alert items
// matching the Dashboard alert format: { key, type, severity, label }

// ── Investigation Meetings ──────────────────────────────────────────────────

export const MEETING_TYPES = [
  { id: 'interview', name: 'Investigation Interview' },
  { id: 'hearing', name: 'Formal Hearing' },
  { id: 'review', name: 'Review Meeting' },
  { id: 'informal', name: 'Informal Discussion' },
];

export const MEETING_ATTENDEE_ROLES = [
  { id: 'subject', name: 'Subject of Investigation' },
  { id: 'investigator', name: 'Investigation Officer' },
  { id: 'witness', name: 'Witness' },
  { id: 'companion', name: 'Companion (TU Rep / Colleague)' },
  { id: 'note_taker', name: 'Note Taker' },
  { id: 'hr_advisor', name: 'HR Advisor' },
  { id: 'chair', name: 'Chair' },
];

export function getHrAlerts(stats, warnings) {
  const alerts = [];
  if (!stats) return alerts;

  if (stats.open_disciplinary > 0) {
    alerts.push({ key: 'hr-disc', type: 'hr', severity: stats.open_disciplinary > 2 ? 'red' : 'amber',
      label: `${stats.open_disciplinary} open disciplinary case${stats.open_disciplinary > 1 ? 's' : ''}` });
  }
  if (stats.open_grievance > 0) {
    alerts.push({ key: 'hr-grv', type: 'hr', severity: 'amber',
      label: `${stats.open_grievance} open grievance${stats.open_grievance > 1 ? 's' : ''}` });
  }
  if (stats.open_performance > 0) {
    alerts.push({ key: 'hr-perf', type: 'hr', severity: 'amber',
      label: `${stats.open_performance} active performance case${stats.open_performance > 1 ? 's' : ''}` });
  }
  if (stats.pending_flex > 0) {
    alerts.push({ key: 'hr-flex', type: 'hr', severity: 'amber',
      label: `${stats.pending_flex} pending flexible working request${stats.pending_flex > 1 ? 's' : ''}` });
  }
  if (stats.active_warnings > 0) {
    alerts.push({ key: 'hr-warn', type: 'hr', severity: 'red',
      label: `${stats.active_warnings} active warning${stats.active_warnings > 1 ? 's' : ''} on register` });
  }

  if (Array.isArray(warnings)) {
    const overdueRenewals = warnings.filter(w => w.type === 'renewal_overdue');
    if (overdueRenewals.length > 0) {
      alerts.push({ key: 'hr-renew', type: 'hr', severity: 'red',
        label: `${overdueRenewals.length} overdue DBS/RTW renewal${overdueRenewals.length > 1 ? 's' : ''}` });
    }
  }

  return alerts;
}
