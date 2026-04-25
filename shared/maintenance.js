// Maintenance & Environment — Constants, Helpers, CQC Metric Calculators
// Maps to QS5 (Safe Environments) — CQC Regulation 15

import { formatDate, parseDate, addDays } from './rotation.js';

// ── Default Maintenance Categories ──────────────────────────────────────────

export const DEFAULT_MAINTENANCE_CATEGORIES = [
  { id: 'pat',         name: 'PAT Testing',                    frequency: 'annual',     regulation: 'Health & Safety at Work Act 1974' },
  { id: 'legionella',  name: 'Legionella Risk Assessment',     frequency: 'annual',     regulation: 'Water Supply (Water Quality) Regs 2016' },
  { id: 'gas',         name: 'Gas Safety Certificate',         frequency: 'annual',     regulation: 'Gas Safety (Installation & Use) Regs 1998' },
  { id: 'fire-risk',   name: 'Fire Risk Assessment',           frequency: 'annual',     regulation: 'Regulatory Reform (Fire Safety) Order 2005' },
  { id: 'water',       name: 'Water Temperature Monitoring',   frequency: 'monthly',    regulation: 'HSG274 Legionella Guidelines' },
  { id: 'electrical',  name: 'Electrical Installation (EICR)', frequency: '5-yearly',   regulation: 'IET Wiring Regulations BS 7671' },
  { id: 'hvac',        name: 'HVAC & Ventilation Service',     frequency: 'annual',     regulation: 'Building Regulations Part F' },
  { id: 'equipment',   name: 'Hoist & Equipment Servicing',    frequency: '6-monthly',  regulation: 'LOLER Regulations 1998 / PUWER 1998' },
];

export const FREQUENCY_OPTIONS = [
  { id: 'monthly',    name: 'Monthly',     days: 30 },
  { id: 'quarterly',  name: 'Quarterly',   days: 91 },
  { id: '6-monthly',  name: '6-Monthly',   days: 183 },
  { id: 'annual',     name: 'Annual',      days: 365 },
  { id: '5-yearly',   name: '5-Yearly',    days: 1825 },
];

export const MAINTENANCE_STATUSES = [
  { id: 'compliant',   name: 'Compliant',   badgeKey: 'green' },
  { id: 'due_soon',    name: 'Due Soon',    badgeKey: 'amber' },
  { id: 'overdue',     name: 'Overdue',     badgeKey: 'red' },
  { id: 'not_started', name: 'Not Started', badgeKey: 'gray' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

export function getMaintenanceCategories(config) {
  return config?.maintenance_categories?.length > 0 ? config.maintenance_categories : DEFAULT_MAINTENANCE_CATEGORIES;
}

function getFrequencyDays(frequency) {
  const opt = FREQUENCY_OPTIONS.find(f => f.id === frequency);
  return opt ? opt.days : 365;
}

export function ensureMaintenanceDefaults(data) {
  let changed = false;
  let result = data;
  if (!data.maintenance) {
    result = { ...result, maintenance: [] };
    changed = true;
  }
  return changed ? result : null;
}

// ── Status Calculation ──────────────────────────────────────────────────────

export function getMaintenanceStatus(check, asOfDate) {
  const today = asOfDate || formatDate(new Date());

  if (!check.last_completed) {
    return { status: 'not_started', daysUntilDue: null, isOverdue: false, daysOverdue: 0 };
  }

  const nextDue = check.next_due || formatDate(addDays(parseDate(check.last_completed), getFrequencyDays(check.frequency)));
  const dueDate = parseDate(nextDue);
  const todayDate = parseDate(today);
  const diffMs = dueDate - todayDate;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { status: 'overdue', daysUntilDue: diffDays, isOverdue: true, daysOverdue: Math.abs(diffDays), nextDue };
  }
  if (diffDays <= 30) {
    return { status: 'due_soon', daysUntilDue: diffDays, isOverdue: false, daysOverdue: 0, nextDue };
  }
  return { status: 'compliant', daysUntilDue: diffDays, isOverdue: false, daysOverdue: 0, nextDue };
}

// ── Stats ───────────────────────────────────────────────────────────────────

export function getMaintenanceStats(maintenance, asOfDate) {
  const today = asOfDate || formatDate(new Date());
  const total = maintenance.length;
  let compliant = 0, dueSoon = 0, overdue = 0, notStarted = 0;

  for (const check of maintenance) {
    const st = getMaintenanceStatus(check, today);
    if (st.status === 'compliant') compliant++;
    else if (st.status === 'due_soon') dueSoon++;
    else if (st.status === 'overdue') overdue++;
    else notStarted++;
  }

  const compliancePct = total > 0 ? Math.round(((compliant + dueSoon) / total) * 100) : 100;

  return { total, compliant, dueSoon, overdue, notStarted, compliancePct };
}

// ── Dashboard Alerts ────────────────────────────────────────────────────────

export function getMaintenanceAlerts(maintenance, asOfDate) {
  const alerts = [];
  const today = asOfDate || formatDate(new Date());

  for (const check of maintenance) {
    const st = getMaintenanceStatus(check, today);
    if (st.status === 'overdue') {
      alerts.push({ type: 'error', msg: `${check.category_name || check.category} overdue by ${st.daysOverdue} days` });
    }
    if (check.certificate_expiry && check.certificate_expiry < today) {
      alerts.push({ type: 'warning', msg: `${check.category_name || check.category} certificate expired` });
    }
  }

  return alerts;
}

// ── CQC Metrics ─────────────────────────────────────────────────────────────

export function calculateMaintenanceCompliancePct(data, asOfDate) {
  const maintenance = data.maintenance || [];
  if (maintenance.length === 0) return { score: 100, detail: 'No checks configured' };

  const stats = getMaintenanceStats(maintenance, asOfDate);
  return { score: stats.compliancePct, compliant: stats.compliant, overdue: stats.overdue, total: stats.total };
}
