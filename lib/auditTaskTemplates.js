export const AUDIT_TASK_TEMPLATES = Object.freeze([
  {
    key: 'daily_mar_check',
    title: 'Daily MAR spot check',
    category: 'medication',
    frequency: 'daily',
    evidence_required: true,
  },
  {
    key: 'daily_care_record_completion',
    title: 'Daily care record completion check',
    category: 'care_records',
    frequency: 'daily',
    evidence_required: true,
  },
  {
    key: 'weekly_ipc_walkaround',
    title: 'Weekly infection control walkaround',
    category: 'infection_control',
    frequency: 'weekly',
    evidence_required: true,
  },
  {
    key: 'weekly_skin_fluid_review',
    title: 'Weekly skin integrity and fluid intake review',
    category: 'care_records',
    frequency: 'weekly',
    evidence_required: true,
  },
  {
    key: 'monthly_medication_audit',
    title: 'Monthly medication audit',
    category: 'medication',
    frequency: 'monthly',
    evidence_required: true,
  },
  {
    key: 'monthly_environment_audit',
    title: 'Monthly environment audit',
    category: 'environment',
    frequency: 'monthly',
    evidence_required: true,
  },
  {
    key: 'monthly_health_safety_audit',
    title: 'Monthly health and safety audit',
    category: 'health_safety',
    frequency: 'monthly',
    evidence_required: true,
  },
  {
    key: 'monthly_training_matrix_review',
    title: 'Monthly training matrix review',
    category: 'staffing',
    frequency: 'monthly',
    evidence_required: true,
  },
  {
    key: 'quarterly_governance_review',
    title: 'Quarterly provider governance review',
    category: 'governance',
    frequency: 'quarterly',
    evidence_required: true,
  },
  {
    key: 'annual_fire_safety_review',
    title: 'Annual fire safety review',
    category: 'health_safety',
    frequency: 'annual',
    evidence_required: true,
  },
]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDateOnly(value) {
  const text = String(value || '').slice(0, 10);
  const [year, month, day] = text.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function startOfWeek(date) {
  const day = date.getUTCDay() || 7;
  return addDays(date, 1 - day);
}

function endOfMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}

function startOfQuarter(date) {
  const month = date.getUTCMonth();
  const quarterStart = month - (month % 3);
  return new Date(Date.UTC(date.getUTCFullYear(), quarterStart, 1));
}

function endOfQuarter(date) {
  const start = startOfQuarter(date);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0));
}

function overlaps(start, end, from, to) {
  return start <= to && end >= from;
}

function createTask(template, periodStart, periodEnd) {
  return {
    template_key: template.key,
    title: template.title,
    category: template.category,
    frequency: template.frequency,
    period_start: dateOnly(periodStart),
    period_end: dateOnly(periodEnd),
    due_date: dateOnly(periodEnd),
    evidence_required: template.evidence_required,
    status: 'open',
  };
}

function buildDaily(template, from, to) {
  const tasks = [];
  for (let cursor = new Date(from); cursor <= to; cursor = addDays(cursor, 1)) {
    tasks.push(createTask(template, cursor, cursor));
  }
  return tasks;
}

function buildWeekly(template, from, to) {
  const tasks = [];
  let cursor = startOfWeek(from);
  while (cursor <= to) {
    const periodStart = cursor;
    const periodEnd = addDays(cursor, 6);
    if (overlaps(periodStart, periodEnd, from, to)) tasks.push(createTask(template, periodStart, periodEnd));
    cursor = addDays(cursor, 7);
  }
  return tasks;
}

function buildMonthly(template, from, to) {
  const tasks = [];
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();
  while (new Date(Date.UTC(year, month, 1)) <= to) {
    const periodStart = new Date(Date.UTC(year, month, 1));
    const periodEnd = endOfMonth(year, month);
    if (overlaps(periodStart, periodEnd, from, to)) tasks.push(createTask(template, periodStart, periodEnd));
    month += 1;
    if (month > 11) {
      year += 1;
      month = 0;
    }
  }
  return tasks;
}

function buildQuarterly(template, from, to) {
  const tasks = [];
  let cursor = startOfQuarter(from);
  while (cursor <= to) {
    const periodStart = cursor;
    const periodEnd = endOfQuarter(cursor);
    if (overlaps(periodStart, periodEnd, from, to)) tasks.push(createTask(template, periodStart, periodEnd));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 3, 1));
  }
  return tasks;
}

function buildAnnual(template, from, to) {
  const tasks = [];
  for (let year = from.getUTCFullYear(); year <= to.getUTCFullYear(); year += 1) {
    const periodStart = new Date(Date.UTC(year, 0, 1));
    const periodEnd = new Date(Date.UTC(year, 11, 31));
    if (overlaps(periodStart, periodEnd, from, to)) tasks.push(createTask(template, periodStart, periodEnd));
  }
  return tasks;
}

export function buildAuditTasksForRange({ from, to, templates = AUDIT_TASK_TEMPLATES } = {}) {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  if (!start || !end || end < start) return [];
  return templates.flatMap((template) => {
    if (template.frequency === 'daily') return buildDaily(template, start, end);
    if (template.frequency === 'weekly') return buildWeekly(template, start, end);
    if (template.frequency === 'monthly') return buildMonthly(template, start, end);
    if (template.frequency === 'quarterly') return buildQuarterly(template, start, end);
    if (template.frequency === 'annual') return buildAnnual(template, start, end);
    return [];
  });
}
