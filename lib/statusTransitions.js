function hasValue(value) {
  if (typeof value === 'string') return value.trim() !== '';
  return value != null;
}

function mergedHasAny(existing, updates, fields) {
  return fields.some((field) => hasValue(updates[field]) || hasValue(existing[field]));
}

function transitionError(current, next, allowedTransitions, label) {
  const from = current ?? null;
  const to = next ?? null;
  if (!from || !to || from === to) return null;
  const allowed = allowedTransitions[from] || [];
  if (allowed.includes(to)) return null;
  return `${label} cannot move from ${from} to ${to}`;
}

const COMPLAINT_STATUS_TRANSITIONS = {
  open: ['acknowledged', 'investigating', 'resolved'],
  acknowledged: ['investigating', 'resolved'],
  investigating: ['resolved'],
  resolved: ['closed'],
  closed: [],
};

const WHISTLEBLOWING_STATUS_TRANSITIONS = {
  registered: ['investigating', 'resolved'],
  investigating: ['resolved'],
  resolved: ['closed'],
  closed: [],
};

const INCIDENT_INVESTIGATION_TRANSITIONS = {
  open: ['under_review'],
  under_review: ['closed'],
  closed: [],
};

const RISK_STATUS_TRANSITIONS = {
  open: ['mitigated', 'accepted'],
  mitigated: ['closed'],
  accepted: ['closed'],
  closed: [],
};

const DPIA_STATUS_TRANSITIONS = {
  screening: ['in_progress'],
  in_progress: ['completed'],
  completed: ['approved'],
  approved: ['review_due'],
  review_due: ['in_progress'],
};

const ROPA_STATUS_TRANSITIONS = {
  active: ['under_review', 'archived'],
  under_review: ['active', 'archived'],
  archived: [],
};

const DOLS_REVIEW_STATUS_TRANSITIONS = {
  pending: ['in_progress'],
  in_progress: ['completed'],
  completed: [],
};

const POLICY_STATUS_TRANSITIONS = {
  not_reviewed: ['under_review', 'due', 'overdue', 'current'],
  current: ['under_review', 'due', 'overdue'],
  due: ['under_review', 'current', 'overdue'],
  overdue: ['under_review', 'current'],
  under_review: ['current', 'due', 'overdue'],
};

const IPC_OUTBREAK_STATUS_TRANSITIONS = {
  suspected: ['confirmed', 'contained', 'resolved'],
  confirmed: ['contained', 'resolved'],
  contained: ['resolved'],
  resolved: [],
};

export function validateComplaintStatusChange(existing, updates) {
  const error = transitionError(existing.status || 'open', updates.status, COMPLAINT_STATUS_TRANSITIONS, 'Complaint status');
  if (error) return error;
  if (updates.status === 'resolved' && !mergedHasAny(existing, updates, ['resolution', 'resolution_date'])) {
    return 'Resolution details are required before marking a complaint resolved';
  }
  return null;
}

export function validateWhistleblowingStatusChange(existing, updates) {
  const error = transitionError(
    existing.status || 'registered',
    updates.status,
    WHISTLEBLOWING_STATUS_TRANSITIONS,
    'Concern status'
  );
  if (error) return error;
  if (updates.status === 'resolved' && !mergedHasAny(existing, updates, ['outcome', 'outcome_details', 'resolution_date'])) {
    return 'Outcome details are required before marking a concern resolved';
  }
  return null;
}

export function validateIncidentStatusChange(existing, updates) {
  const error = transitionError(
    existing.investigation_status || 'open',
    updates.investigation_status,
    INCIDENT_INVESTIGATION_TRANSITIONS,
    'Investigation status'
  );
  if (error) return error;
  if (updates.investigation_status === 'closed' && !mergedHasAny(existing, updates, ['investigation_closed_date'])) {
    return 'Closed incidents must include an investigation closed date';
  }
  return null;
}

export function validateRiskStatusChange(existing, updates) {
  return transitionError(existing.status || 'open', updates.status, RISK_STATUS_TRANSITIONS, 'Risk status');
}

export function validateDpiaStatusChange(existing, updates) {
  return transitionError(existing.status || 'screening', updates.status, DPIA_STATUS_TRANSITIONS, 'DPIA status');
}

export function validateRopaStatusChange(existing, updates) {
  return transitionError(existing.status || 'active', updates.status, ROPA_STATUS_TRANSITIONS, 'ROPA status');
}

export function validateDolsReviewStatusChange(existing, updates) {
  return transitionError(existing.review_status || 'pending', updates.review_status, DOLS_REVIEW_STATUS_TRANSITIONS, 'Review status');
}

export function validatePolicyStatusChange(existing, updates) {
  return transitionError(existing.status || 'not_reviewed', updates.status, POLICY_STATUS_TRANSITIONS, 'Policy status');
}

export function validateIpcOutbreakStatusChange(existing, updates) {
  if (!updates.outbreak || !Object.prototype.hasOwnProperty.call(updates.outbreak, 'status')) return null;
  const currentStatus = existing.outbreak?.status || (existing.outbreak?.suspected ? 'suspected' : null);
  return transitionError(currentStatus || 'suspected', updates.outbreak.status, IPC_OUTBREAK_STATUS_TRANSITIONS, 'Outbreak status');
}
