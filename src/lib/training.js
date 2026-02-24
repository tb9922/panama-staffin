import { formatDate, parseDate, CARE_ROLES } from './rotation.js';

// ── Default Training Types ─────────────────────────────────────────────────

export const DEFAULT_TRAINING_TYPES = [
  { id: 'fire-safety', name: 'Fire Safety', category: 'statutory', refresher_months: 12, roles: null, legislation: 'Regulatory Reform (Fire Safety) Order 2005', active: true },
  { id: 'moving-handling', name: 'Moving & Handling', category: 'statutory', refresher_months: 12, roles: null, legislation: 'Manual Handling Operations Regs 1992', active: true },
  { id: 'health-safety', name: 'Health & Safety Awareness', category: 'statutory', refresher_months: 36, roles: null, legislation: 'H&S at Work Act 1974', active: true },
  { id: 'food-hygiene', name: 'Food Hygiene', category: 'statutory', refresher_months: 36, roles: null, legislation: 'Food Safety Act 1990', active: true },
  { id: 'basic-life-support', name: 'Basic Life Support', category: 'statutory', refresher_months: 12, roles: null, legislation: 'H&S First-Aid Regs 1981', active: true },
  { id: 'first-aid-work', name: 'First Aid at Work', category: 'statutory', refresher_months: 36, roles: null, legislation: 'H&S First-Aid Regs 1981', active: true },
  { id: 'safeguarding-adults', name: 'Safeguarding Adults', category: 'mandatory', refresher_months: 12, roles: null, legislation: 'CQC Regulation 18', active: true },
  { id: 'safeguarding-children', name: 'Safeguarding Children', category: 'mandatory', refresher_months: 36, roles: null, legislation: 'CQC Regulation 18', active: true },
  { id: 'infection-control', name: 'Infection Prevention & Control', category: 'mandatory', refresher_months: 12, roles: null, legislation: 'CQC Regulation 18', active: true },
  { id: 'equality-diversity', name: 'Equality, Diversity & Human Rights', category: 'mandatory', refresher_months: 36, roles: null, legislation: 'CQC Regulation 18', active: true },
  { id: 'mca-dols', name: 'Mental Capacity Act & DoLS', category: 'mandatory', refresher_months: 24, roles: null, legislation: 'CQC Regulation 18', active: true },
  { id: 'data-protection', name: 'Data Protection / GDPR', category: 'mandatory', refresher_months: 12, roles: null, legislation: 'CQC Regulation 18', active: true },
  { id: 'oliver-mcgowan', name: 'Learning Disability & Autism (Oliver McGowan)', category: 'mandatory', refresher_months: 36, roles: null, legislation: 'Health and Care Act 2022', active: true },
  { id: 'medication-awareness', name: 'Medication Awareness', category: 'mandatory', refresher_months: 12, roles: [...CARE_ROLES].filter(r => r !== 'Team Lead'), legislation: 'CQC Regulation 18', active: true },
  { id: 'duty-of-candour', name: 'Duty of Candour', category: 'mandatory', refresher_months: 24, roles: null, legislation: 'CQC Regulation 20', active: true },
  { id: 'positive-behaviour', name: 'Positive Behaviour Support', category: 'mandatory', refresher_months: 12, roles: null, legislation: 'CQC Regulation 18', active: true },
];

export const TRAINING_METHODS = ['classroom', 'e-learning', 'practical', 'online'];

export const TRAINING_STATUS = {
  COMPLIANT: 'compliant',
  EXPIRING_SOON: 'expiring_soon',
  URGENT: 'urgent',
  EXPIRED: 'expired',
  NOT_STARTED: 'not_started',
  NOT_REQUIRED: 'not_required',
};

export const STATUS_DISPLAY = {
  compliant:     { label: 'Compliant',     badgeKey: 'green',  symbol: '\u2713' },
  expiring_soon: { label: 'Expiring Soon', badgeKey: 'amber',  symbol: '!' },
  urgent:        { label: 'Urgent',        badgeKey: 'red',    symbol: '!!' },
  expired:       { label: 'Expired',       badgeKey: 'red',    symbol: 'X' },
  not_started:   { label: 'Not Started',   badgeKey: 'gray',   symbol: '-' },
  not_required:  { label: 'N/A',           badgeKey: 'gray',   symbol: '' },
};

// ── Helpers ────────────────────────────────────────────────────────────────

export function getTrainingTypes(config) {
  return (config.training_types && config.training_types.length > 0)
    ? config.training_types
    : DEFAULT_TRAINING_TYPES;
}

/**
 * Returns new data with defaults populated if training_types is missing, or null if already set.
 */
export function ensureTrainingDefaults(data) {
  if (data.config.training_types && data.config.training_types.length > 0) return null;
  return {
    ...data,
    config: { ...data.config, training_types: [...DEFAULT_TRAINING_TYPES] },
    training: data.training || {},
  };
}

export function isTrainingRequired(trainingType, staffRole) {
  if (!trainingType.active) return false;
  if (!trainingType.roles) return true;
  return trainingType.roles.includes(staffRole);
}

export function calculateExpiry(completedDateStr, refresherMonths) {
  const d = parseDate(completedDateStr);
  d.setUTCMonth(d.getUTCMonth() + refresherMonths);
  return formatDate(d);
}

// ── Status Calculation ─────────────────────────────────────────────────────

export function getTrainingStatus(staffMember, trainingType, staffRecords, asOfDate) {
  if (!isTrainingRequired(trainingType, staffMember.role)) {
    return { status: TRAINING_STATUS.NOT_REQUIRED, record: null, daysUntilExpiry: null };
  }

  const record = staffRecords?.[trainingType.id] || null;
  if (!record || !record.completed) {
    return { status: TRAINING_STATUS.NOT_STARTED, record: null, daysUntilExpiry: null };
  }

  const expiry = parseDate(record.expiry);
  const now = typeof asOfDate === 'string' ? parseDate(asOfDate) : new Date(asOfDate);
  const diffMs = expiry.getTime() - now.getTime();
  const daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry < 0) {
    return { status: TRAINING_STATUS.EXPIRED, record, daysUntilExpiry };
  }
  if (daysUntilExpiry <= 30) {
    return { status: TRAINING_STATUS.URGENT, record, daysUntilExpiry };
  }
  if (daysUntilExpiry <= 60) {
    return { status: TRAINING_STATUS.EXPIRING_SOON, record, daysUntilExpiry };
  }
  return { status: TRAINING_STATUS.COMPLIANT, record, daysUntilExpiry };
}

// ── Matrix & Stats ─────────────────────────────────────────────────────────

export function buildComplianceMatrix(activeStaff, trainingTypes, trainingData, asOfDate) {
  const matrix = new Map();
  for (const s of activeStaff) {
    const staffMap = new Map();
    const staffRecords = trainingData[s.id] || {};
    for (const t of trainingTypes) {
      if (!t.active) continue;
      staffMap.set(t.id, getTrainingStatus(s, t, staffRecords, asOfDate));
    }
    matrix.set(s.id, staffMap);
  }
  return matrix;
}

export function getComplianceStats(matrix) {
  let totalRequired = 0, compliant = 0, expiringSoon = 0, urgent = 0, expired = 0, notStarted = 0;
  for (const [, staffMap] of matrix) {
    for (const [, result] of staffMap) {
      if (result.status === TRAINING_STATUS.NOT_REQUIRED) continue;
      totalRequired++;
      if (result.status === TRAINING_STATUS.COMPLIANT) compliant++;
      else if (result.status === TRAINING_STATUS.EXPIRING_SOON) expiringSoon++;
      else if (result.status === TRAINING_STATUS.URGENT) urgent++;
      else if (result.status === TRAINING_STATUS.EXPIRED) expired++;
      else if (result.status === TRAINING_STATUS.NOT_STARTED) notStarted++;
    }
  }
  const compliancePct = totalRequired > 0 ? Math.round((compliant / totalRequired) * 100) : 100;
  return { totalRequired, compliant, expiringSoon, urgent, expired, notStarted, compliancePct };
}

export function getTrainingAlerts(activeStaff, trainingTypes, trainingData, asOfDate) {
  const alerts = [];
  const activeTypes = trainingTypes.filter(t => t.active);
  for (const s of activeStaff) {
    const staffRecords = trainingData[s.id] || {};
    for (const t of activeTypes) {
      const result = getTrainingStatus(s, t, staffRecords, asOfDate);
      if (result.status === TRAINING_STATUS.EXPIRED) {
        alerts.push({ type: 'error', msg: `${s.name}: ${t.name} expired` });
      } else if (result.status === TRAINING_STATUS.URGENT) {
        alerts.push({ type: 'warning', msg: `${s.name}: ${t.name} expires in ${result.daysUntilExpiry}d` });
      }
    }
  }
  return alerts;
}
