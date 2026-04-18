// Escalation & Cost Logic — Aligned with Excel v8

import {
  isCareRole, isWorkingShift, isEarlyShift, isLateShift, isNightShift,
  isOTShift, isAgencyShift, isBHShift, getShiftHours,
  getActualShift, addDays, formatDate, parseDate, AGENCY_SHIFTS,
} from './rotation.js';
import { BLOCKING_TRAINING_TYPES } from './training.js';
import { getConfiguredNlwRate } from '../../shared/nmw.js';

// Coverage counting matching Excel DAILY_STATUS formulas
export function countEarlyCoverage(staffForDay) {
  return staffForDay.filter(s => isCareRole(s.role) && isEarlyShift(s.shift)).length;
}

export function countLateCoverage(staffForDay) {
  return staffForDay.filter(s => isCareRole(s.role) && isLateShift(s.shift)).length;
}

export function countNightCoverage(staffForDay) {
  return staffForDay.filter(s => isCareRole(s.role) && isNightShift(s.shift)).length;
}

// Skill points for a shift period
function calcSkillPoints(staffList) {
  return staffList.reduce((sum, s) => sum + (s.skill || 0), 0);
}

// Coverage calculation for a shift period (early/late/night)
export function calculateCoverage(staffForDay, period, config) {
  const mins = config?.minimum_staffing?.[period] ?? { heads: 0, skill_points: 0 };
  let relevantStaff;
  if (period === 'early') {
    relevantStaff = staffForDay.filter(s => isCareRole(s.role) && isEarlyShift(s.shift));
  } else if (period === 'late') {
    relevantStaff = staffForDay.filter(s => isCareRole(s.role) && isLateShift(s.shift));
  } else {
    relevantStaff = staffForDay.filter(s => isCareRole(s.role) && isNightShift(s.shift));
  }

  const headCount = relevantStaff.length;
  const skillPoints = calcSkillPoints(relevantStaff);
  const headGap = Math.max(0, mins.heads - headCount);
  const skillGap = Math.max(0, mins.skill_points - skillPoints);
  const isCovered = headGap === 0 && skillGap <= 0;

  return { headCount, skillPoints, headGap, skillGap, isCovered, required: mins, staff: relevantStaff };
}

// 6-level escalation matching Excel
// LVL0: Normal — fully covered
// LVL1: Float deployed
// LVL2: OT/OC-L triggered
// LVL3: Agency required
// LVL4: Short-staffed (gaps remain after agency)
// LVL5: UNSAFE — below absolute minimum
export function getEscalationLevel(coverage, staffForDay) {
  const hasAgency = staffForDay.some(s => isAgencyShift(s.shift));
  const hasOT = staffForDay.some(s => isOTShift(s.shift));
  const hasFloat = staffForDay.some(s => s.team === 'Float' && isWorkingShift(s.shift));

  if (coverage.isCovered && !hasAgency && !hasOT && !hasFloat) {
    return { level: 0, status: 'LVL0 Normal', color: 'green', label: 'Covered' };
  }
  if (coverage.isCovered && hasFloat && !hasOT && !hasAgency) {
    return { level: 1, status: 'LVL1 Float', color: 'green', label: 'Float Deployed' };
  }
  if (coverage.isCovered && hasOT && !hasAgency) {
    return { level: 2, status: 'LVL2 OT/OC-L', color: 'amber', label: 'OT Triggered' };
  }
  if (coverage.isCovered && hasAgency) {
    return { level: 3, status: 'LVL3 Agency', color: 'yellow', label: 'Agency Required' };
  }
  if (!coverage.isCovered && coverage.headGap === 0 && coverage.skillGap > 0) {
    return { level: 4, status: 'LVL4 Skill Gap', color: 'red', label: 'Skill Gap — heads met, skill mix insufficient' };
  }
  if (!coverage.isCovered && coverage.headGap <= 1) {
    return { level: 4, status: 'LVL4 Short', color: 'red', label: 'Short-Staffed' };
  }
  return { level: 5, status: 'LVL5 UNSAFE', color: 'red', label: 'UNSAFE' };
}

// Full day coverage status
export function getDayCoverageStatus(staffForDay, config) {
  const earlyCov = calculateCoverage(staffForDay, 'early', config);
  const lateCov = calculateCoverage(staffForDay, 'late', config);
  const nightCov = calculateCoverage(staffForDay, 'night', config);

  // Filter staff by period so night agency doesn't inflate early/late escalation
  const earlyEsc = getEscalationLevel(earlyCov, staffForDay.filter(s => isEarlyShift(s.shift)));
  const lateEsc = getEscalationLevel(lateCov, staffForDay.filter(s => isLateShift(s.shift)));
  const nightEsc = getEscalationLevel(nightCov, staffForDay.filter(s => isNightShift(s.shift)));

  const worstLevel = Math.max(earlyEsc.level, lateEsc.level, nightEsc.level);
  const colorMap = { 0: 'green', 1: 'green', 2: 'amber', 3: 'yellow', 4: 'red', 5: 'red' };

  return {
    early: { coverage: earlyCov, escalation: earlyEsc },
    late: { coverage: lateCov, escalation: lateEsc },
    night: { coverage: nightCov, escalation: nightEsc },
    // Back-compat: day = worst of early+late
    day: {
      coverage: {
        headCount: Math.min(earlyCov.headCount, lateCov.headCount),
        skillPoints: Math.min(earlyCov.skillPoints, lateCov.skillPoints),
        isCovered: earlyCov.isCovered && lateCov.isCovered,
        required: earlyCov.required,
      },
      escalation: earlyEsc.level >= lateEsc.level ? earlyEsc : lateEsc,
    },
    overall: colorMap[worstLevel] || 'green',
    overallLevel: worstLevel,
  };
}

// Cost calculation matching Excel DAILY_COSTS formulas exactly
export function calculateDayCost(staffForDay, config) {
  let base = 0;
  let otPremium = 0;
  let agencyDay = 0;
  let agencyNight = 0;
  let bhPremium = 0;
  let sleepIn = 0;

  staffForDay.forEach(s => {
    if (s.sleep_in) sleepIn += config.sleep_in_rate || 0;
    const shift = s.shift;
    if (!isWorkingShift(shift)) return;
    let hours = getShiftHours(shift, config);
    const rate = s.hourly_rate || 0;

    // TRN/ADM: on a working day pay full scheduled shift; on OFF day pay override_hours
    if (shift === 'TRN' || shift === 'ADM') {
      if (isWorkingShift(s.scheduledShift)) {
        hours = getShiftHours(s.scheduledShift, config);
      } else {
        hours = s.override_hours ?? hours;
      }
    }

    // Agency shifts use agency rates, not staff rates
    if (isAgencyShift(shift)) {
      if (shift === 'AG-N') {
        agencyNight += hours * config.agency_rate_night;
      } else {
        agencyDay += hours * config.agency_rate_day;
      }
      return;
    }

    // Base cost: hours × staff rate
    base += hours * rate;

    // OT premium: extra £/hr for OC-* shifts
    if (isOTShift(shift)) {
      otPremium += hours * config.ot_premium;
    }

    // BH premium: (multiplier - 1) × hours × rate
    if (isBHShift(shift)) {
      bhPremium += hours * rate * (config.bh_premium_multiplier - 1);
    }
  });

  // AL cost: use stored al_hours from override if available, else heuristic
  staffForDay.forEach(s => {
    if (s.shift !== 'AL') return;
    let alHours;
    if (s.al_hours != null) {
      alHours = parseFloat(s.al_hours);
    } else if (s.team === 'Float') {
      alHours = (parseFloat(s.contract_hours) || 0) / 5;
    } else if (s.team && s.team.startsWith('Night')) {
      alHours = getShiftHours('N', config);
    } else {
      alHours = getShiftHours(s.pref || 'EL', config);
    }
    base += alHours * (s.hourly_rate || 0);
  });

  const total = base + otPremium + agencyDay + agencyNight + bhPremium + sleepIn;

  return {
    base: Math.round(base * 100) / 100,
    otPremium: Math.round(otPremium * 100) / 100,
    agencyDay: Math.round(agencyDay * 100) / 100,
    agencyNight: Math.round(agencyNight * 100) / 100,
    bhPremium: Math.round(bhPremium * 100) / 100,
    sleepIn: Math.round(sleepIn * 100) / 100,
    total: Math.round(total * 100) / 100,
    agency: Math.round((agencyDay + agencyNight) * 100) / 100,
    // Back-compat
    standard: Math.round(base * 100) / 100,
    oclPremium: Math.round(otPremium * 100) / 100,
  };
}

// Fatigue risk check — consecutive working days
export function checkFatigueRisk(staffMember, date, overrides, config) {
  // Scan up to 14 days (full Panama cycle) in each direction to catch heavy OT override runs
  const scanRadius = Math.max(config.max_consecutive_days + 3, 14);
  let backward = 0;
  let checkDate = typeof date === 'string' ? parseDate(date) : parseDate(formatDate(date));

  for (let i = 0; i < scanRadius; i++) {
    checkDate = addDays(checkDate, -1);
    const actual = getActualShift(staffMember, checkDate, overrides, config.cycle_start_date);
    if (!isWorkingShift(actual.shift)) break;
    backward++;
  }

  let forward = 0;
  checkDate = typeof date === 'string' ? parseDate(date) : parseDate(formatDate(date));
  const todayActual = getActualShift(staffMember, checkDate, overrides, config.cycle_start_date);
  if (isWorkingShift(todayActual.shift)) {
    forward = 1;
    for (let i = 0; i < scanRadius; i++) {
      checkDate = addDays(checkDate, 1);
      const actual = getActualShift(staffMember, checkDate, overrides, config.cycle_start_date);
      if (!isWorkingShift(actual.shift)) break;
      forward++;
    }
  }

  const consecutive = backward + forward;
  return {
    consecutive,
    atRisk: consecutive >= config.max_consecutive_days,
    exceeded: consecutive > config.max_consecutive_days,
  };
}

// Scenario model matching Excel SCENARIO_MODEL sheet
export function calculateScenario(sickPerDay, alPerDay, config) {
  const totalGaps = sickPerDay + alPerDay;
  const floatPool = config.staff
    ? config.staff.filter(s => s.team === 'Float' && s.active !== false).length
    : 3;
  const otPool = config.bank_staff_pool_size || 4;

  const floatFills = Math.min(totalGaps, floatPool);
  const afterFloat = Math.max(totalGaps - floatFills, 0);
  const otFills = Math.min(afterFloat, otPool);
  const afterOT = Math.max(afterFloat - otFills, 0);
  const nightGapPct = config.night_gap_pct || 0.3;
  const agDayFills = Math.round(afterOT * (1 - nightGapPct));
  const agNightFills = afterOT - agDayFills;

  const days = 28;
  const elHours = config.shifts?.EL?.hours ?? 12;
  const nHours = config.shifts?.N?.hours ?? 10;

  // Average float rate — use actual float staff rates, fall back to NLW minimum
  const floatStaff = config.staff ? config.staff.filter(s => s.team === 'Float' && s.active !== false) : [];
  const avgFloatRate = floatStaff.length > 0
    ? floatStaff.reduce((sum, s) => sum + (s.hourly_rate || 0), 0) / floatStaff.length
    : getConfiguredNlwRate(config);
  const floatCost = floatFills * elHours * avgFloatRate * days;
  const otCost = otFills * elHours * (avgFloatRate + config.ot_premium) * days;
  const agDayCost = agDayFills * elHours * config.agency_rate_day * days;
  const agNightCost = agNightFills * nHours * config.agency_rate_night * days;

  return {
    sickPerDay, alPerDay, totalGaps,
    floatFills, otFills, agDayFills, agNightFills,
    floatCost, otCost, agDayCost, agNightCost,
    totalExtraCost: floatCost + otCost + agDayCost + agNightCost,
  };
}

// Swap validator matching Excel DAILY_STATUS swap checker
export function validateSwap(fromStaff, toStaff, date, overrides, config, training, asOfDate = null) {
  const issues = [];

  // Self-swap guard
  if (fromStaff.id === toStaff.id) {
    issues.push({ type: 'error', msg: 'Cannot swap a staff member with themselves' });
    return { safe: false, issues };
  }

  // Skill safety: does removing fromStaff and adding toStaff maintain coverage?
  if (fromStaff.skill > toStaff.skill) {
    issues.push({ type: 'warning', msg: `Skill downgrade: ${fromStaff.skill} → ${toStaff.skill}` });
  }

  // Fatigue check for toStaff (the one receiving fromStaff's shift)
  const fatigue = checkFatigueRisk(toStaff, date, overrides, config);
  if (fatigue.exceeded) {
    issues.push({ type: 'error', msg: `${toStaff.name}: ${fatigue.consecutive} consecutive days (max ${config.max_consecutive_days})` });
  } else if (fatigue.atRisk) {
    issues.push({ type: 'warning', msg: `${toStaff.name}: ${fatigue.consecutive} consecutive days — at limit` });
  }

  // WTR 1998 Reg 10: 11h rest gap — toStaff will work fromStaff.shift on this date.
  // getActualShift returns { shift: '...' } — extract the string.
  const newShift = fromStaff.shift;
  const prevShift = getActualShift(toStaff, addDays(date, -1), overrides, config.cycle_start_date)?.shift;
  const nextShift = getActualShift(toStaff, addDays(date, 1), overrides, config.cycle_start_date)?.shift;
  const restingShifts = new Set(['OFF', 'AL', 'SICK', 'NS']);
  if (isNightShift(prevShift) && !isNightShift(newShift)) {
    issues.push({ type: 'warning', msg: `${toStaff.name}: worked nights yesterday — verify 11h rest before this shift (WTR 1998 Reg 10)` });
  }
  if (isNightShift(newShift) && !restingShifts.has(nextShift) && !isNightShift(nextShift)) {
    issues.push({ type: 'warning', msg: `${toStaff.name}: ${nextShift} shift tomorrow after this night — verify 11h rest (WTR 1998 Reg 10)` });
  }

  // Night worker conversion: toStaff moving from day to night (WTR Reg 7 health assessment).
  // toStaff.shift is from staffForDay which has already resolved overrides — string is correct.
  if (isNightShift(newShift) && !isNightShift(toStaff.shift)) {
    issues.push({ type: 'warning', msg: `${toStaff.name}: converting to night shift — health assessment obligation applies (WTR 1998 Reg 7)` });
  }

  // Training currency: blocking types must be current before rostering.
  // Compare expiry date strings directly to avoid BST midnight edge cases.
  if (training) {
    const staffTraining = training[toStaff.id] || {};
    const today = asOfDate ? (typeof asOfDate === 'string' ? asOfDate : formatDate(asOfDate)) : formatDate(date);
    const expiredTypes = [];
    const missingTypes = [];
    for (const typeId of BLOCKING_TRAINING_TYPES) {
      const record = staffTraining[typeId];
      if (!record?.expiry) {
        missingTypes.push(typeId.replace(/-/g, ' '));
      } else if (record.expiry < today) {
        expiredTypes.push(typeId.replace(/-/g, ' '));
      }
    }
    if (expiredTypes.length > 0) {
      issues.push({ type: 'error', msg: `${toStaff.name}: expired mandatory training — ${expiredTypes.join(', ')}` });
    }
    if (missingTypes.length > 0) {
      issues.push({ type: 'warning', msg: `${toStaff.name}: no training record — ${missingTypes.join(', ')}` });
    }
  }

  return {
    safe: !issues.some(i => i.type === 'error'),
    issues,
  };
}
