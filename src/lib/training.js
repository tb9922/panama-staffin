import { formatDate, parseDate, addDays } from './rotation.js';
export { DEFAULT_TRAINING_TYPES, DEFAULT_TRAINING_LEVELS, getTrainingTypes } from '../../shared/training.js';
import { DEFAULT_TRAINING_TYPES, DEFAULT_TRAINING_LEVELS, getTrainingTypes } from '../../shared/training.js';

export const TRAINING_METHODS = ['classroom', 'e-learning', 'practical', 'online'];

export const TRAINING_STATUS = {
  COMPLIANT: 'compliant',
  EXPIRING_SOON: 'expiring_soon',
  URGENT: 'urgent',
  EXPIRED: 'expired',
  NOT_STARTED: 'not_started',
  NOT_REQUIRED: 'not_required',
  WRONG_LEVEL: 'wrong_level',
};

export const STATUS_DISPLAY = {
  compliant:     { label: 'Compliant',     badgeKey: 'green',  symbol: '\u2713' },
  expiring_soon: { label: 'Expiring Soon', badgeKey: 'amber',  symbol: '!' },
  urgent:        { label: 'Urgent',        badgeKey: 'red',    symbol: '!!' },
  expired:       { label: 'Expired',       badgeKey: 'red',    symbol: 'X' },
  not_started:   { label: 'Not Started',   badgeKey: 'gray',   symbol: '-' },
  not_required:  { label: 'N/A',           badgeKey: 'gray',   symbol: '' },
  wrong_level:   { label: 'Wrong Level',   badgeKey: 'orange', symbol: 'L!' },
};

export function getRequiredLevel(trainingType, staffRole) {
  if (!trainingType.levels || trainingType.levels.length === 0) return null;
  // Find the highest level (latest in array) whose roles include this staff role
  for (let i = trainingType.levels.length - 1; i >= 0; i--) {
    const level = trainingType.levels[i];
    if (level.roles && level.roles.includes(staffRole)) return level;
  }
  return null;
}

export function compareLevels(trainingType, levelIdA, levelIdB) {
  if (!trainingType.levels) return 0;
  const idxA = trainingType.levels.findIndex(l => l.id === levelIdA);
  const idxB = trainingType.levels.findIndex(l => l.id === levelIdB);
  if (idxA === -1 && idxB === -1) return 0; // both unknown = equal
  if (idxA === -1) return -1; // A unknown, treat as less than B
  if (idxB === -1) return 1;  // B unknown, treat as less than A
  if (idxA === idxB) return 0;
  return idxA < idxB ? -1 : 1;
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function ensureTrainingDefaults(data) {
  let changed = false;
  let result = data;
  if (!data.config.training_types || data.config.training_types.length === 0) {
    result = { ...result, config: { ...result.config, training_types: [...DEFAULT_TRAINING_TYPES] } };
    changed = true;
  } else {
    // Merge any new default types not yet present in this home's config
    const existingIds = new Set(result.config.training_types.map(t => t.id));
    const missing = DEFAULT_TRAINING_TYPES.filter(t => !existingIds.has(t.id));
    if (missing.length > 0) {
      result = { ...result, config: { ...result.config, training_types: [...result.config.training_types, ...missing] } };
      changed = true;
    }
  }
  if (!data.training) { result = { ...result, training: {} }; changed = true; }
  if (!data.supervisions) { result = { ...result, supervisions: {} }; changed = true; }
  if (!data.appraisals) { result = { ...result, appraisals: {} }; changed = true; }
  if (!data.fire_drills) { result = { ...result, fire_drills: [] }; changed = true; }
  // Apply default levels to safeguarding-adults and mca-dols if missing
  const types = getTrainingTypes(result.config);
  let typesChanged = false;
  const updatedTypes = types.map(t => {
    if (DEFAULT_TRAINING_LEVELS[t.id] && !t.levels) {
      typesChanged = true;
      return { ...t, levels: DEFAULT_TRAINING_LEVELS[t.id] };
    }
    return t;
  });
  if (typesChanged) {
    result = { ...result, config: { ...result.config, training_types: updatedTypes } };
    changed = true;
  }
  return changed ? result : null;
}

export function isTrainingRequired(trainingType, staffRole) {
  if (!trainingType.active) return false;
  if (!trainingType.roles) return true;
  return trainingType.roles.includes(staffRole);
}

export function calculateExpiry(completedDateStr, refresherMonths) {
  // Pure integer calendar arithmetic — no Date objects to avoid UTC/local mixing.
  const [y, m, d] = completedDateStr.split('-').map(Number);
  const totalMonths = (y * 12 + (m - 1)) + refresherMonths;
  const expiryYear = Math.floor(totalMonths / 12);
  const expiryMonth = (totalMonths % 12) + 1;
  // Clamp day to last day of target month (e.g. Jan 31 + 1mo → Feb 28, not Feb 31)
  const lastDayOfMonth = new Date(expiryYear, expiryMonth, 0).getDate();
  const clampedDay = Math.min(d, lastDayOfMonth);
  return `${expiryYear}-${String(expiryMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

// ── Status Calculation ─────────────────────────────────────────────────────

export function getTrainingStatus(staffMember, trainingType, staffRecords, asOfDate) {
  if (!isTrainingRequired(trainingType, staffMember.role)) {
    return { status: TRAINING_STATUS.NOT_REQUIRED, record: null, daysUntilExpiry: null, requiredLevel: null };
  }

  const record = staffRecords?.[trainingType.id] || null;
  if (!record || !record.completed) {
    const requiredLevel = getRequiredLevel(trainingType, staffMember.role);
    return { status: TRAINING_STATUS.NOT_STARTED, record: null, daysUntilExpiry: null, requiredLevel };
  }

  const expiry = parseDate(record.expiry);
  const now = typeof asOfDate === 'string' ? parseDate(asOfDate) : new Date(asOfDate);
  const diffMs = expiry.getTime() - now.getTime();
  const daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  // Compute required level before expiry check so it's available in all returns
  const requiredLevel = getRequiredLevel(trainingType, staffMember.role);

  if (daysUntilExpiry < 0) {
    return { status: TRAINING_STATUS.EXPIRED, record, daysUntilExpiry, requiredLevel };
  }

  // Level check: if type has levels, verify the recorded level meets the requirement
  if (requiredLevel && record.level) {
    if (compareLevels(trainingType, record.level, requiredLevel.id) < 0) {
      return { status: TRAINING_STATUS.WRONG_LEVEL, record, daysUntilExpiry, requiredLevel };
    }
  } else if (requiredLevel && !record.level) {
    // Type has levels but record doesn't specify one — treat as wrong level
    return { status: TRAINING_STATUS.WRONG_LEVEL, record, daysUntilExpiry, requiredLevel };
  }

  if (daysUntilExpiry <= 30) {
    return { status: TRAINING_STATUS.URGENT, record, daysUntilExpiry, requiredLevel };
  }
  if (daysUntilExpiry <= 60) {
    return { status: TRAINING_STATUS.EXPIRING_SOON, record, daysUntilExpiry, requiredLevel };
  }
  return { status: TRAINING_STATUS.COMPLIANT, record, daysUntilExpiry, requiredLevel };
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
  let totalRequired = 0, compliant = 0, expiringSoon = 0, urgent = 0, expired = 0, notStarted = 0, wrongLevel = 0;
  for (const [, staffMap] of matrix) {
    for (const [, result] of staffMap) {
      if (result.status === TRAINING_STATUS.NOT_REQUIRED) continue;
      totalRequired++;
      if (result.status === TRAINING_STATUS.COMPLIANT) compliant++;
      else if (result.status === TRAINING_STATUS.EXPIRING_SOON) expiringSoon++;
      else if (result.status === TRAINING_STATUS.URGENT) urgent++;
      else if (result.status === TRAINING_STATUS.EXPIRED) expired++;
      else if (result.status === TRAINING_STATUS.NOT_STARTED) notStarted++;
      else if (result.status === TRAINING_STATUS.WRONG_LEVEL) wrongLevel++;
    }
  }
  const compliancePct = totalRequired > 0 ? Math.round((compliant / totalRequired) * 100) : 100;
  return { totalRequired, compliant, expiringSoon, urgent, expired, notStarted, wrongLevel, compliancePct };
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
      } else if (result.status === TRAINING_STATUS.EXPIRING_SOON) {
        alerts.push({ type: 'warning', msg: `${s.name}: ${t.name} expires in ${result.daysUntilExpiry} days` });
      } else if (result.status === TRAINING_STATUS.WRONG_LEVEL) {
        const hasLevel = t.levels?.find(l => l.id === result.record?.level);
        alerts.push({ type: 'warning', msg: `${s.name}: ${t.name} — has ${hasLevel?.name || 'none'}, needs ${result.requiredLevel?.name}` });
      }
    }
  }
  return alerts;
}

// ── Supervision Engine ─────────────────────────────────────────────────────

export function isInProbation(staff, config, asOfDate) {
  if (!staff.start_date) return false;
  const start = parseDate(staff.start_date);
  const probMonths = config.supervision_probation_months || 6;
  const probEnd = new Date(start);
  probEnd.setUTCMonth(probEnd.getUTCMonth() + probMonths);
  const now = typeof asOfDate === 'string' ? parseDate(asOfDate) : new Date(asOfDate);
  return now < probEnd;
}

export function getSupervisionFrequency(staff, config, asOfDate) {
  if (isInProbation(staff, config, asOfDate)) {
    return config.supervision_frequency_probation || 30;
  }
  return config.supervision_frequency_standard || 49;
}

export function getSupervisionStatus(staff, config, supervisionsData, asOfDate) {
  const staffSups = supervisionsData?.[staff.id] || [];
  if (staffSups.length === 0) {
    return { status: 'not_started', lastSession: null, nextDue: null, daysUntilDue: null, overdueDays: 0 };
  }
  const sorted = [...staffSups].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  // Use the session date, not today — frequency may have changed since the session
  const freq = getSupervisionFrequency(staff, config, latest.date);
  const lastDate = parseDate(latest.date);
  const nextDue = addDays(lastDate, freq);
  const now = typeof asOfDate === 'string' ? parseDate(asOfDate) : new Date(asOfDate);
  const daysUntilDue = Math.ceil((nextDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  let status;
  if (daysUntilDue < -14) status = 'overdue';
  else if (daysUntilDue < 0) status = 'due';
  else if (daysUntilDue <= 14) status = 'due_soon';
  else status = 'up_to_date';

  return { status, lastSession: latest, nextDue: formatDate(nextDue), daysUntilDue, overdueDays: daysUntilDue < 0 ? Math.abs(daysUntilDue) : 0 };
}

export function getSupervisionStats(activeStaff, config, supervisionsData, asOfDate) {
  let total = activeStaff.length, upToDate = 0, dueSoon = 0, overdue = 0, notStarted = 0;
  for (const s of activeStaff) {
    const result = getSupervisionStatus(s, config, supervisionsData, asOfDate);
    if (result.status === 'up_to_date') upToDate++;
    else if (result.status === 'due_soon') dueSoon++;
    else if (result.status === 'overdue' || result.status === 'due') overdue++;
    else if (result.status === 'not_started') notStarted++;
  }
  const completionPct = total > 0 ? Math.round(((upToDate + dueSoon) / total) * 100) : 100;
  return { total, upToDate, dueSoon, overdue, notStarted, completionPct };
}

export function calculateSupervisionCompletionPct(data, asOfDate) {
  const activeStaff = (data.staff || []).filter(s => s.active !== false);
  if (activeStaff.length === 0) return 100;
  return getSupervisionStats(activeStaff, data.config, data.supervisions || {}, asOfDate).completionPct;
}

export function getSupervisionAlerts(activeStaff, config, supervisionsData, asOfDate) {
  const alerts = [];
  for (const s of activeStaff) {
    const result = getSupervisionStatus(s, config, supervisionsData, asOfDate);
    if (result.status === 'overdue') {
      alerts.push({ type: 'error', msg: `${s.name}: Supervision overdue by ${result.overdueDays} days` });
    } else if (result.status === 'due') {
      alerts.push({ type: 'warning', msg: `${s.name}: Supervision overdue by ${result.overdueDays} days` });
    } else if (result.status === 'not_started') {
      alerts.push({ type: 'warning', msg: `${s.name}: No supervision records` });
    }
  }
  return alerts;
}

// ── Appraisal Engine ───────────────────────────────────────────────────────

export function getAppraisalStatus(staff, appraisalsData, asOfDate) {
  const staffAprs = appraisalsData?.[staff.id] || [];
  if (staffAprs.length === 0) {
    return { status: 'not_started', lastAppraisal: null, nextDue: null, daysUntilDue: null, overdueDays: 0 };
  }
  const sorted = [...staffAprs].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  let nextDueStr = latest.next_due;
  if (!nextDueStr) {
    const d = parseDate(latest.date);
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    nextDueStr = formatDate(d);
  }
  const now = typeof asOfDate === 'string' ? parseDate(asOfDate) : new Date(asOfDate);
  const dueDate = parseDate(nextDueStr);
  const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  let status;
  if (daysUntilDue < 0) status = 'overdue';
  else if (daysUntilDue <= 30) status = 'due_soon';
  else status = 'up_to_date';

  return { status, lastAppraisal: latest, nextDue: nextDueStr, daysUntilDue, overdueDays: daysUntilDue < 0 ? Math.abs(daysUntilDue) : 0 };
}

export function getAppraisalStats(activeStaff, appraisalsData, asOfDate) {
  let total = activeStaff.length, upToDate = 0, dueSoon = 0, overdue = 0, notStarted = 0;
  for (const s of activeStaff) {
    const result = getAppraisalStatus(s, appraisalsData, asOfDate);
    if (result.status === 'up_to_date') upToDate++;
    else if (result.status === 'due_soon') dueSoon++;
    else if (result.status === 'overdue') overdue++;
    else if (result.status === 'not_started') notStarted++;
  }
  const completionPct = total > 0 ? Math.round(((upToDate + dueSoon) / total) * 100) : 100;
  return { total, upToDate, dueSoon, overdue, notStarted, completionPct };
}

export function getAppraisalAlerts(activeStaff, appraisalsData, asOfDate) {
  const alerts = [];
  for (const s of activeStaff) {
    const result = getAppraisalStatus(s, appraisalsData, asOfDate);
    if (result.status === 'overdue') {
      alerts.push({ type: 'error', msg: `${s.name}: Annual appraisal overdue by ${result.overdueDays} days` });
    } else if (result.status === 'due_soon') {
      alerts.push({ type: 'warning', msg: `${s.name}: Annual appraisal due in ${result.daysUntilDue} days` });
    }
  }
  return alerts;
}

// ── Fire Drill Engine ──────────────────────────────────────────────────────

export const FIRE_DRILL_FREQUENCY_DAYS = 91; // quarterly

export function getFireDrillStatus(fireDrills, asOfDate) {
  const drills = fireDrills || [];
  if (drills.length === 0) {
    return { status: 'not_started', lastDrill: null, nextDue: null, daysUntilDue: null, drillsThisYear: 0, avgEvacTime: null };
  }
  const sorted = [...drills].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  const nextDue = addDays(parseDate(latest.date), FIRE_DRILL_FREQUENCY_DAYS);
  const now = typeof asOfDate === 'string' ? parseDate(asOfDate) : new Date(asOfDate);
  const daysUntilDue = Math.ceil((nextDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  const yearAgo = new Date(now);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const yearDrills = drills.filter(d => parseDate(d.date) >= yearAgo);
  const drillsThisYear = yearDrills.length;

  const withTime = yearDrills.filter(d => d.evacuation_time_seconds > 0);
  const avgEvacTime = withTime.length > 0
    ? Math.round(withTime.reduce((s, d) => s + d.evacuation_time_seconds, 0) / withTime.length)
    : null;

  let status;
  if (daysUntilDue < 0) status = 'overdue';
  else if (daysUntilDue <= 14) status = 'due_soon';
  else status = 'up_to_date';

  return { status, lastDrill: latest, nextDue: formatDate(nextDue), daysUntilDue, drillsThisYear, avgEvacTime };
}

export function getFireDrillAlerts(fireDrills, asOfDate) {
  const result = getFireDrillStatus(fireDrills, asOfDate);
  const alerts = [];
  if (result.status === 'overdue') {
    alerts.push({ type: 'error', msg: `Fire drill overdue — last drill ${result.lastDrill?.date || 'never'}` });
  } else if (result.status === 'due_soon') {
    alerts.push({ type: 'warning', msg: `Fire drill due within ${result.daysUntilDue} days` });
  }
  if (result.status === 'not_started') {
    alerts.push({ type: 'error', msg: 'No fire drills recorded' });
  } else if (result.drillsThisYear < 4) {
    alerts.push({ type: 'warning', msg: `Only ${result.drillsThisYear} fire drill${result.drillsThisYear !== 1 ? 's' : ''} in last 12 months (minimum 4 required)` });
  }
  return alerts;
}

// ── Roster Blocking — Critical Training ─────────────────────────────────────

export const BLOCKING_TRAINING_TYPES = ['fire-safety', 'moving-handling', 'safeguarding-adults'];

/**
 * Get blocking reasons for a staff member — if non-empty, they have expired or missing critical training.
 */
export function getTrainingBlockingReasons(staffId, staffRole, trainingData, config, asOfDate) {
  const reasons = [];
  const types = getTrainingTypes(config);
  const staffRecords = trainingData?.[staffId] || {};

  for (const typeId of BLOCKING_TRAINING_TYPES) {
    const type = types.find(t => t.id === typeId);
    if (!type || !type.active) continue;
    if (!isTrainingRequired(type, staffRole)) continue;

    const record = staffRecords[typeId];
    if (!record || !record.completed) {
      reasons.push(`${type.name} not completed`);
    } else if (record.expiry) {
      const expiry = parseDate(record.expiry);
      const now = typeof asOfDate === 'string' ? parseDate(asOfDate) : new Date(asOfDate);
      if (expiry < now) {
        reasons.push(`${type.name} expired`);
      }
    }
  }
  return reasons;
}
