const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const ACTION_ITEM_STATUSES = Object.freeze([
  'open',
  'in_progress',
  'blocked',
  'completed',
  'verified',
  'cancelled',
]);

export const ACTION_ITEM_OPEN_STATUSES = Object.freeze([
  'open',
  'in_progress',
  'blocked',
]);

export const ACTION_ITEM_CLOSED_STATUSES = Object.freeze([
  'completed',
  'verified',
  'cancelled',
]);

export const ACTION_ITEM_PRIORITIES = Object.freeze([
  'low',
  'medium',
  'high',
  'critical',
]);

export const ACTION_ITEM_CATEGORIES = Object.freeze([
  'safeguarding',
  'clinical',
  'environmental',
  'hr',
  'governance',
  'compliance',
  'staffing',
  'finance',
  'operational',
]);

export const ACTION_ITEM_SOURCE_TYPES = Object.freeze([
  'standalone',
  'incident',
  'ipc_audit',
  'risk',
  'complaint',
  'complaint_survey',
  'maintenance',
  'fire_drill',
  'supervision',
  'appraisal',
  'hr_grievance',
  'cqc_observation',
  'cqc_narrative',
  'reflective_practice',
]);

export function normalizeLegacyStatus(status) {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'in_progress':
      return 'in_progress';
    case 'blocked':
      return 'blocked';
    default:
      return 'open';
  }
}

function toDateOnly(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function daysPastDue(dueDate, today = new Date()) {
  const due = toDateOnly(dueDate);
  const now = toDateOnly(today);
  if (due == null || now == null) return 0;
  return Math.floor((now - due) / MS_PER_DAY);
}

export function calculateEscalationLevel({ dueDate, status = 'open', priority = 'medium', today = new Date() } = {}) {
  if (ACTION_ITEM_CLOSED_STATUSES.includes(status)) return 0;
  const overdueDays = daysPastDue(dueDate, today);
  if (overdueDays < 0) return 0;

  let level;
  if (overdueDays <= 1) level = 1;
  else if (overdueDays <= 3) level = 2;
  else if (overdueDays <= 7) level = 3;
  else level = 4;

  if (priority === 'critical') {
    level += 1;
  }

  return Math.min(level, 4);
}
