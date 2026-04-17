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

const IPC_OUTBREAK_STATUS_TRANSITIONS = {
  suspected: ['confirmed', 'contained', 'resolved'],
  confirmed: ['contained', 'resolved'],
  contained: ['resolved'],
  resolved: [],
};

const GDPR_REQUEST_STATUS_TRANSITIONS = {
  received: ['in_progress', 'rejected'],
  in_progress: ['completed', 'rejected'],
  completed: [],
  rejected: [],
};

const GDPR_BREACH_STATUS_TRANSITIONS = {
  open: ['contained', 'resolved'],
  contained: ['resolved'],
  resolved: ['closed'],
  closed: [],
};

const GDPR_COMPLAINT_STATUS_TRANSITIONS = {
  open: ['investigating', 'escalated', 'resolved'],
  investigating: ['escalated', 'resolved'],
  escalated: ['resolved'],
  resolved: ['closed'],
  closed: [],
};

const RISK_STATUS_TRANSITIONS = {
  open: ['mitigated', 'accepted'],
  mitigated: ['closed'],
  accepted: ['closed'],
  closed: [],
};

const POLICY_STATUS_TRANSITIONS = {
  not_reviewed: ['current', 'under_review', 'due', 'overdue'],
  current: ['under_review', 'due', 'overdue'],
  under_review: ['current', 'due', 'overdue'],
  due: ['current', 'under_review', 'overdue'],
  overdue: ['current', 'under_review'],
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
  pending: ['in_progress', 'completed'],
  in_progress: ['completed'],
  completed: [],
};

export function validateComplaintStatusChange(existing, updates) {
  const error = transitionError(
    existing.status || 'open',
    updates.status,
    COMPLAINT_STATUS_TRANSITIONS,
    'Complaint status'
  );
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
  if (
    updates.status === 'resolved' &&
    !mergedHasAny(existing, updates, ['outcome', 'outcome_details', 'resolution_date'])
  ) {
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
  if (
    updates.investigation_status === 'closed' &&
    !mergedHasAny(existing, updates, ['investigation_closed_date'])
  ) {
    return 'Closed incidents must include an investigation closed date';
  }
  return null;
}

export function validateIpcOutbreakStatusChange(existing, updates) {
  const currentStatus = existing.outbreak?.status || null;
  const nextStatus = updates.outbreak?.status;
  const error = transitionError(
    currentStatus,
    nextStatus,
    IPC_OUTBREAK_STATUS_TRANSITIONS,
    'Outbreak status'
  );
  if (error) return error;
  if (
    nextStatus === 'resolved' &&
    !mergedHasAny(existing.outbreak || {}, updates.outbreak || {}, ['end_date'])
  ) {
    return 'Resolved outbreaks must include an end date';
  }
  return null;
}

export function validateGdprRequestStatusChange(existing, updates) {
  return transitionError(
    existing.status || 'received',
    updates.status,
    GDPR_REQUEST_STATUS_TRANSITIONS,
    'Request status'
  );
}

export function validateGdprBreachStatusChange(existing, updates) {
  return transitionError(
    existing.status || 'open',
    updates.status,
    GDPR_BREACH_STATUS_TRANSITIONS,
    'Breach status'
  );
}

export function validateGdprComplaintStatusChange(existing, updates) {
  const error = transitionError(
    existing.status || 'open',
    updates.status,
    GDPR_COMPLAINT_STATUS_TRANSITIONS,
    'Complaint status'
  );
  if (error) return error;
  if (
    updates.status === 'resolved' &&
    !mergedHasAny(existing, updates, ['resolution', 'resolution_date'])
  ) {
    return 'Resolution details are required before marking a complaint resolved';
  }
  return null;
}

export function validateRiskStatusChange(existing, updates) {
  return transitionError(
    existing.status || 'open',
    updates.status,
    RISK_STATUS_TRANSITIONS,
    'Risk status'
  );
}

export function validatePolicyStatusChange(existing, updates) {
  const error = transitionError(
    existing.status || 'not_reviewed',
    updates.status,
    POLICY_STATUS_TRANSITIONS,
    'Policy status'
  );
  if (error) return error;
  if (
    updates.status === 'current' &&
    !mergedHasAny(existing, updates, ['last_reviewed'])
  ) {
    return 'Last reviewed date is required before marking a policy current';
  }
  return null;
}

export function validateDpiaStatusChange(existing, updates) {
  return transitionError(
    existing.status || 'screening',
    updates.status,
    DPIA_STATUS_TRANSITIONS,
    'DPIA status'
  );
}

export function validateRopaStatusChange(existing, updates) {
  return transitionError(
    existing.status || 'active',
    updates.status,
    ROPA_STATUS_TRANSITIONS,
    'ROPA status'
  );
}

export function validateDolsReviewStatusChange(existing, updates) {
  const error = transitionError(
    existing.review_status || 'pending',
    updates.review_status,
    DOLS_REVIEW_STATUS_TRANSITIONS,
    'DoLS review status'
  );
  if (error) return error;
  if (
    updates.review_status === 'completed' &&
    !mergedHasAny(existing, updates, ['reviewed_date'])
  ) {
    return 'Completed DoLS reviews must include a reviewed date';
  }
  return null;
}
