import { formatDate, parseDate, addDays, CARE_ROLES } from './rotation.js';

// ── Default Training Types ─────────────────────────────────────────────────

export const DEFAULT_TRAINING_TYPES = [
  // ── Statutory (explicit legislative duty) ────────────────────────────────
  { id: 'fire-safety',         name: 'Fire Safety',                                  category: 'statutory', refresher_months: 12, roles: null,            legislation: 'Regulatory Reform (Fire Safety) Order 2005, Art 21',                    active: true  },
  { id: 'moving-handling',     name: 'Moving & Handling',                            category: 'statutory', refresher_months: 12, roles: null,            legislation: 'Manual Handling Operations Regs 1992 / HSWA 1974 s.2(2)(c)',            active: true  },
  { id: 'health-safety',       name: 'Health & Safety Awareness',                    category: 'statutory', refresher_months: 36, roles: null,            legislation: 'Health & Safety at Work Act 1974 s.2 / MHSWR 1999 Reg 13',            active: true  },
  { id: 'coshh',               name: 'COSHH',                                        category: 'statutory', refresher_months: 36, roles: null,            legislation: 'Control of Substances Hazardous to Health Regs 2002, Reg 12',         active: true  },
  { id: 'food-hygiene',        name: 'Food Hygiene',                                 category: 'statutory', refresher_months: 36, roles: null,            legislation: 'EU Reg 852/2004 Annex II / Food Safety & Hygiene (England) Regs 2013', active: true  },
  { id: 'basic-life-support',  name: 'Basic Life Support',                           category: 'statutory', refresher_months: 12, roles: null,            legislation: 'Health & Safety (First-Aid) Regs 1981',                               active: true  },
  { id: 'first-aid-work',      name: 'First Aid at Work',                            category: 'statutory', refresher_months: 36, roles: null,            legislation: 'Health & Safety (First-Aid) Regs 1981, Reg 3',                        active: true  },
  { id: 'ppe-awareness',       name: 'PPE Awareness',                                category: 'statutory', refresher_months: 36, roles: null,            legislation: 'Personal Protective Equipment at Work Regs 1992, Reg 9',              active: false },
  // ── Mandatory (CQC Fundamental Standards / Skills for Care Part 1 & 2) ──
  { id: 'safeguarding-adults', name: 'Safeguarding Adults',                          category: 'mandatory', refresher_months: 12, roles: null,            legislation: 'Care Act 2014 ss.42-46 / CQC Regulation 13',                          active: true  },
  { id: 'safeguarding-children', name: 'Safeguarding Children',                      category: 'mandatory', refresher_months: 36, roles: null,            legislation: 'Working Together to Safeguard Children 2023 / CQC Regulation 13',    active: true  },
  { id: 'infection-control',   name: 'Infection Prevention & Control',               category: 'mandatory', refresher_months: 12, roles: null,            legislation: 'CQC Regulation 12 / Code of Practice on IPC 2022',                    active: true  },
  { id: 'oliver-mcgowan',      name: 'Learning Disability & Autism (Oliver McGowan)', category: 'mandatory', refresher_months: 36, roles: null,           legislation: 'Health and Care Act 2022 s.181 / Oliver McGowan Code of Practice 2025', active: true },
  { id: 'mca-dols',            name: 'Mental Capacity Act & DoLS',                   category: 'mandatory', refresher_months: 24, roles: null,            legislation: 'Mental Capacity Act 2005 / Mental Capacity (Amendment) Act 2019',    active: true  },
  { id: 'equality-diversity',  name: 'Equality, Diversity & Human Rights',           category: 'mandatory', refresher_months: 36, roles: null,            legislation: 'Equality Act 2010 / CQC Regulations 10 & 13',                         active: true  },
  { id: 'data-protection',     name: 'Data Protection / GDPR',                       category: 'mandatory', refresher_months: 12, roles: null,            legislation: 'UK GDPR / Data Protection Act 2018',                                  active: true  },
  { id: 'duty-of-candour',     name: 'Duty of Candour',                              category: 'mandatory', refresher_months: 24, roles: null,            legislation: 'CQC Regulation 20 / Health & Social Care Act 2008',                   active: true  },
  { id: 'medication-awareness', name: 'Medication Awareness',                        category: 'mandatory', refresher_months: 12, roles: [...CARE_ROLES].filter(r => r !== 'Team Lead'), legislation: 'CQC Regulation 12 / NICE SC1 (Managing Medicines in Care Homes)', active: true },
  { id: 'positive-behaviour',  name: 'Positive Behaviour Support',                   category: 'mandatory', refresher_months: 12, roles: null,            legislation: 'CQC Regulation 13(4) / Restraint Reduction Network Standards 2021',  active: true  },
  // ── High-priority mandatory (CQC inspection priorities 2025) ────────────
  { id: 'dementia-awareness',  name: 'Dementia Awareness',                           category: 'mandatory', refresher_months: 12, roles: null,            legislation: 'CQC Regulation 18 / Dementia Training Standards Framework 2018',    active: true  },
  { id: 'dysphagia-iddsi',     name: 'Dysphagia & IDDSI',                            category: 'mandatory', refresher_months: 12, roles: [...CARE_ROLES], legislation: 'CQC Regulation 12 / IDDSI Framework 2018',                            active: true  },
  { id: 'end-of-life-care',    name: 'End of Life Care',                             category: 'mandatory', refresher_months: 24, roles: [...CARE_ROLES], legislation: 'CQC Regulation 18 / Ambitions for Palliative and End of Life Care 2021', active: true },
  { id: 'falls-prevention',    name: 'Falls Prevention',                             category: 'mandatory', refresher_months: 12, roles: [...CARE_ROLES], legislation: 'CQC Regulation 12 / NICE NG249 (2025)',                                active: true  },
  { id: 'nutrition-hydration', name: 'Nutrition & Hydration',                        category: 'mandatory', refresher_months: 36, roles: [...CARE_ROLES], legislation: 'CQC Regulation 14',                                                   active: true  },
  { id: 'pressure-ulcer',      name: 'Pressure Ulcer Prevention',                   category: 'mandatory', refresher_months: 12, roles: [...CARE_ROLES], legislation: 'CQC Regulation 12 / NICE NG7',                                         active: true  },
  { id: 'oral-health',         name: 'Oral Health Care',                             category: 'mandatory', refresher_months: 36, roles: [...CARE_ROLES], legislation: 'CQC Regulation 14 / NICE NG48',                                        active: true  },
];

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

// ── Training Levels ──────────────────────────────────────────────────────

export const DEFAULT_TRAINING_LEVELS = {
  'safeguarding-adults': [
    { id: 'L1', name: 'Level 1 — Awareness', roles: ['Carer', 'Night Carer', 'Float Carer'] },
    { id: 'L2', name: 'Level 2 — Response', roles: ['Senior Carer', 'Night Senior', 'Float Senior'] },
    { id: 'L3', name: 'Level 3 — Lead', roles: ['Team Lead'] },
  ],
  'mca-dols': [
    { id: 'basic', name: 'Basic Awareness', roles: ['Carer', 'Night Carer', 'Float Carer'] },
    { id: 'advanced', name: 'Advanced (Assessments)', roles: ['Senior Carer', 'Night Senior', 'Float Senior', 'Team Lead'] },
  ],
  'oliver-mcgowan': [
    // Tier 1: non-direct-care/admin staff (empty = matches no care role in our system)
    { id: 'tier1', name: 'Tier 1 — Awareness (e-learning + 1hr live)', roles: [] },
    // Tier 2: all direct care staff (Health and Care Act 2022 s.181 mandate)
    { id: 'tier2', name: 'Tier 2 — Direct Care (full day, co-delivered)', roles: [...CARE_ROLES] },
  ],
  'dementia-awareness': [
    // Tiers per Dementia Training Standards Framework 2018
    { id: 'tier1', name: 'Tier 1 — Awareness', roles: ['Carer', 'Night Carer', 'Float Carer'] },
    { id: 'tier2', name: 'Tier 2 — Core Skills (direct care)', roles: ['Senior Carer', 'Night Senior', 'Float Senior'] },
    { id: 'tier3', name: 'Tier 3 — Enhanced (leadership/specialist)', roles: ['Team Lead'] },
  ],
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
  if (idxA === -1 || idxB === -1) return 0;
  if (idxA === idxB) return 0;
  return idxA < idxB ? -1 : 1;
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function getTrainingTypes(config) {
  return (config.training_types && config.training_types.length > 0)
    ? config.training_types
    : DEFAULT_TRAINING_TYPES;
}

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
  const d = parseDate(completedDateStr);
  d.setUTCMonth(d.getUTCMonth() + refresherMonths);
  return formatDate(d);
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

  if (daysUntilExpiry < 0) {
    return { status: TRAINING_STATUS.EXPIRED, record, daysUntilExpiry, requiredLevel: null };
  }

  // Level check: if type has levels, verify the recorded level meets the requirement
  const requiredLevel = getRequiredLevel(trainingType, staffMember.role);
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
  const freq = getSupervisionFrequency(staff, config, asOfDate);
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
