import { pool } from '../db.js';
import * as dashboardService from './dashboardService.js';
import { computeCqcReadiness } from './assessmentService.js';
import * as actionItemRepo from '../repositories/actionItemRepo.js';
import * as agencyAttemptRepo from '../repositories/agencyAttemptRepo.js';
import * as outcomeMetricRepo from '../repositories/outcomeMetricRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import { hasModuleAccess } from '../shared/roles.js';
import { PORTFOLIO_RAG_THRESHOLDS, buildPortfolioRag, overallRag, ragAtLeast, ragAtMost } from '../shared/portfolioRag.js';
import {
  addDays,
  formatDate,
  getStaffForDay,
  isCareRole,
  isAgencyShift,
  isEarlyShift,
  isLateShift,
  isNightShift,
} from '../shared/rotation.js';

const CACHE_TTL_MS = 60_000;
const cache = new Map();

function cacheKey(username, isPlatformAdmin) {
  return `${isPlatformAdmin ? 'platform' : 'user'}:${String(username).toLowerCase()}`;
}

export function clearPortfolioCache() {
  cache.clear();
}

async function getAccessibleHomes(username, isPlatformAdmin) {
  if (isPlatformAdmin) {
    const { rows } = await pool.query(
      `SELECT id, slug, name, config, 'platform_admin' AS role_id
         FROM homes
        WHERE deleted_at IS NULL
        ORDER BY name`
    );
    return rows;
  }

  const { rows } = await pool.query(
    `SELECT h.id, h.slug, h.name, h.config, uhr.role_id
       FROM user_home_roles uhr
       JOIN homes h ON h.id = uhr.home_id AND h.deleted_at IS NULL
       JOIN users u ON u.username = uhr.username AND u.active = true
      WHERE uhr.username = $1
      ORDER BY h.name`,
    [String(username).trim().toLowerCase()]
  );
  return rows.filter(row => hasModuleAccess(row.role_id, 'reports', 'read', { includeOwn: false }));
}

async function getAgencyByHome(homeIds) {
  if (homeIds.length === 0) return new Map();
  const [{ rows }, overrideRows] = await Promise.all([
    pool.query(
    `SELECT home_id,
            COUNT(*)::int AS shifts_28d,
            COUNT(*) FILTER (
              WHERE date >= CURRENT_DATE - INTERVAL '7 days'
                AND date <= CURRENT_DATE
            )::int AS shifts_7d,
            COALESCE(SUM(total_cost), 0)::numeric AS cost_28d
       FROM agency_shifts
      WHERE home_id = ANY($1::int[])
        AND date >= CURRENT_DATE - INTERVAL '28 days'
        AND date <= CURRENT_DATE
      GROUP BY home_id`,
    [homeIds]
    ),
    agencyAttemptRepo.countEmergencyOverridesByHome(homeIds),
  ]);
  const shiftsByHome = new Map(rows.map(row => [row.home_id, row]));
  const overridesByHome = new Map(overrideRows.map(row => [row.home_id, row]));
  return new Map(homeIds.map(homeId => {
    const row = shiftsByHome.get(homeId) || {};
    const overrides = overridesByHome.get(homeId) || {};
    const emergencyOverrides = Number(overrides.emergency_overrides_7d || 0);
    const linkedEmergencyOverrides = Number(overrides.linked_emergency_override_shifts_7d || 0);
    const attempts7d = Number(overrides.attempts_7d || 0);
    const shifts7d = Number(row.shifts_7d || 0);
    const overrideDenominator = Math.max(shifts7d, linkedEmergencyOverrides);
    return [homeId, {
      shifts_28d: Number(row.shifts_28d || 0),
      shifts_7d: shifts7d,
      agency_attempts_7d: attempts7d,
      cost_28d: Number(row.cost_28d || 0),
      emergency_overrides_7d: emergencyOverrides,
      linked_emergency_override_shifts_7d: linkedEmergencyOverrides,
      emergency_override_pct: overrideDenominator > 0 ? Math.round((linkedEmergencyOverrides / overrideDenominator) * 100) : 0,
    }];
  }));
}

function actionCountsByHome(rows) {
  return new Map(rows.map(row => [row.home_id, {
    open: row.open || 0,
    overdue: row.overdue || 0,
    escalated_l3_plus: row.escalated_l3_plus || 0,
    completed_28d: row.completed_28d || 0,
  }]));
}

function withDefaultAgency(map, homeId) {
  return map.get(homeId) || {
    shifts_28d: 0,
    shifts_7d: 0,
    agency_attempts_7d: 0,
    cost_28d: 0,
    emergency_overrides_7d: 0,
    linked_emergency_override_shifts_7d: 0,
    emergency_override_pct: 0,
  };
}

function withDefaultActions(map, homeId) {
  return map.get(homeId) || {
    open: 0,
    overdue: 0,
    escalated_l3_plus: 0,
    completed_28d: 0,
  };
}

function inclusiveDays(start, end) {
  const startDate = start ? new Date(`${String(start).slice(0, 10)}T00:00:00Z`) : null;
  const endDate = end ? new Date(`${String(end).slice(0, 10)}T00:00:00Z`) : null;
  if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 28;
  return Math.max(1, Math.round((endDate - startDate) / 86400000) + 1);
}

function residentMonthsForPeriod(home, outcomes) {
  const registeredBeds = Number(home?.config?.registered_beds || home?.config?.beds || 0);
  if (!Number.isFinite(registeredBeds) || registeredBeds <= 0) return null;
  const days = inclusiveDays(outcomes?.period_start, outcomes?.period_end);
  return registeredBeds * (days / 30.4375);
}

function ratePerResidentMonth(count, home, outcomes) {
  const residentMonths = residentMonthsForPeriod(home, outcomes);
  if (!residentMonths) return null;
  return Math.round((Number(count || 0) / residentMonths) * 1000) / 1000;
}

const MANUAL_OUTCOME_THRESHOLDS = Object.freeze({
  prn_antipsychotic_pct: { direction: 'atMost', greenAtMost: 5, amberAtMost: 10 },
  antibiotic_courses: { direction: 'atMost', greenAtMost: 5, amberAtMost: 10 },
  pressure_sores_new: { direction: 'atMost', greenAtMost: 0, amberAtMost: 1 },
  doc_contact_ratio: { direction: 'atLeast', greenAtLeast: 95, amberAtLeast: 90 },
  staff_turnover_pct: { direction: 'atMost', greenAtMost: 8, amberAtMost: 12 },
  occupancy_pct: { direction: 'atLeast', greenAtLeast: 90, amberAtLeast: 80 },
});

function manualMetricValue(metric) {
  const numerator = metric?.numerator == null ? null : Number(metric.numerator);
  const denominator = metric?.denominator == null ? null : Number(metric.denominator);
  if (numerator == null || Number.isNaN(numerator)) return null;
  const key = String(metric?.metric_key || '');
  if (
    denominator != null
    && Number.isFinite(denominator)
    && denominator > 0
    && (key.endsWith('_pct') || key.endsWith('_ratio'))
  ) {
    return Math.round((numerator / denominator) * 1000) / 10;
  }
  return numerator;
}

function ragForManualMetric(metric, value) {
  const thresholds = MANUAL_OUTCOME_THRESHOLDS[metric?.metric_key];
  if (!thresholds || value == null) return null;
  if (thresholds.direction === 'atLeast') return ragAtLeast(value, thresholds);
  return ragAtMost(value, thresholds);
}

function latestManualOutcomeMetrics(outcomes) {
  const rows = Array.isArray(outcomes?.manual_metrics) ? outcomes.manual_metrics : [];
  const byKey = new Map();
  for (const metric of rows) {
    const key = metric?.metric_key;
    if (!key) continue;
    const current = byKey.get(key);
    const currentDate = current?.period_end || current?.recorded_at || '';
    const nextDate = metric.period_end || metric.recorded_at || '';
    if (!current || String(nextDate).localeCompare(String(currentDate)) >= 0) {
      byKey.set(key, metric);
    }
  }
  return [...byKey.values()];
}

function buildManualOutcomeSignals(outcomes) {
  const signals = latestManualOutcomeMetrics(outcomes)
    .map((metric) => {
      const value = manualMetricValue(metric);
      const rag = ragForManualMetric(metric, value);
      return {
        key: metric.metric_key,
        value,
        numerator: metric.numerator,
        denominator: metric.denominator,
        period_start: metric.period_start,
        period_end: metric.period_end,
        rag,
      };
    })
    .filter(signal => signal.rag);

  return {
    signals,
    rag: signals.length > 0
      ? overallRag(Object.fromEntries(signals.map(signal => [signal.key, signal.rag])))
      : null,
  };
}

function manualSignalValue(manualSignals, key) {
  const signal = manualSignals.signals.find(item => item.key === key);
  return signal?.value ?? null;
}

function buildOutcomeKpis(outcomes, home) {
  const incidents = outcomes?.incidents || {};
  const manualSignals = buildManualOutcomeSignals(outcomes);
  const pressureSoresNew = manualSignalValue(manualSignals, 'pressure_sores_new') ?? incidents.pressure_sores;
  const thresholds = PORTFOLIO_RAG_THRESHOLDS;
  const ragInputs = {
    falls: ragAtMost(incidents.falls, thresholds.falls28d),
    infections: ragAtMost(incidents.infections, thresholds.infections28d),
    pressure_sores: ragAtMost(pressureSoresNew, thresholds.pressureSores28d),
  };
  if (manualSignals.rag) ragInputs.manual = manualSignals.rag;
  const rag = overallRag(ragInputs);
  return {
    rag,
    falls_28d: incidents.falls ?? null,
    infections_28d: incidents.infections ?? null,
    pressure_sores_new_28d: pressureSoresNew ?? null,
    complaints_28d: outcomes?.complaints?.complaints_total ?? null,
    incidents_per_resident_month: ratePerResidentMonth(incidents.incidents_total, home, outcomes),
    complaints_per_resident_month: ratePerResidentMonth(outcomes?.complaints?.complaints_total, home, outcomes),
    manual_rag: manualSignals.rag,
    manual_metrics: manualSignals.signals,
  };
}

const UNKNOWN_SIGNAL_FIXES = Object.freeze({
  staffing: {
    label: 'Staffing',
    reason: 'No planned staffing baseline is available for the next 7 days.',
    fix: 'Set minimum staffing rules and rota patterns in Settings.',
    route: '/settings',
  },
  agency: {
    label: 'Agency',
    reason: 'Agency pressure cannot be calculated from current agency data.',
    fix: 'Check agency shift logging and agency-attempt links.',
    route: '/agency',
  },
  training: {
    label: 'Training',
    reason: 'Mandatory training requirements have not been configured or no required records exist.',
    fix: 'Configure role-required training and upload current certificates.',
    route: '/training',
  },
  care_certificate: {
    label: 'Care Certificate',
    reason: 'Care Certificate evidence is not available for active care staff.',
    fix: 'Start or update Care Certificate trackers for active carers.',
    route: '/care-cert',
  },
  incidents: {
    label: 'Incidents',
    reason: 'Incident trend rates cannot be calculated from the current resident/period baseline.',
    fix: 'Check resident capacity and incident outcome data.',
    route: '/incidents',
  },
  complaints: {
    label: 'Complaints',
    reason: 'Complaint trend rates cannot be calculated from the current resident/period baseline.',
    fix: 'Check resident capacity and complaint outcome data.',
    route: '/complaints',
  },
  audits: {
    label: 'Audits',
    reason: 'Audit calendar status is not available.',
    fix: 'Generate recurring audit tasks for this home.',
    route: '/audit-calendar',
  },
  supervisions: {
    label: 'Supervisions',
    reason: 'Supervision status is not available.',
    fix: 'Review the supervision matrix.',
    route: '/training',
  },
  cqc_evidence: {
    label: 'CQC Evidence',
    reason: 'CQC evidence readiness could not be calculated.',
    fix: 'Review CQC evidence domains and quality statements.',
    route: '/cqc',
  },
  maintenance: {
    label: 'Maintenance',
    reason: 'Maintenance/certificate status is not available.',
    fix: 'Review maintenance checks and statutory certificate records.',
    route: '/maintenance',
  },
  manager_actions: {
    label: 'Manager Actions',
    reason: 'Manager action status is not available.',
    fix: 'Review the action tracker.',
    route: '/actions',
  },
  occupancy: {
    label: 'Occupancy',
    reason: 'Occupancy cannot be calculated because bed capacity or occupancy records are missing.',
    fix: 'Review beds, residents, and registered capacity.',
    route: '/beds',
  },
  outcomes: {
    label: 'Outcomes',
    reason: 'Outcome metrics are missing or cannot be derived yet.',
    fix: 'Review outcome metrics and incident categories.',
    route: '/outcomes',
  },
});

function buildDataQuality(rag) {
  const unknownSignals = Object.entries(rag || {})
    .filter(([key, value]) => key !== 'overall' && value === 'unknown')
    .map(([key]) => ({
      key,
      ...(UNKNOWN_SIGNAL_FIXES[key] || {
        label: key.replace(/_/g, ' '),
        reason: 'This KPI could not be calculated from current data.',
        fix: 'Review source records for this signal.',
        route: '/',
      }),
    }));

  return {
    unknown_count: unknownSignals.length,
    unknown_signals: unknownSignals,
  };
}

function calculatePeriodCoverage(staffForDay, period, config) {
  const required = config?.minimum_staffing?.[period] || { heads: 0, skill_points: 0 };
  const staff = staffForDay.filter((member) => {
    if (!isCareRole(member.role)) return false;
    if (period === 'early') return isEarlyShift(member.shift);
    if (period === 'late') return isLateShift(member.shift);
    return isNightShift(member.shift);
  });
  const headCount = staff.length;
  const skillPoints = staff.reduce((sum, member) => sum + Number(member.skill || 0), 0);
  const headGap = Math.max(0, Number(required.heads || 0) - headCount);
  const skillGap = Math.max(0, Number(required.skill_points || 0) - skillPoints);
  const gapSlots = headGap + (headGap === 0 && skillGap > 0 ? 1 : 0);
  return {
    required_heads: Number(required.heads || 0),
    head_count: headCount,
    skill_points: skillPoints,
    head_gap: headGap,
    skill_gap: skillGap,
    gap_slots: gapSlots,
  };
}

function dateRange(days = 7) {
  const start = new Date();
  const dates = [];
  for (let i = 0; i < days; i += 1) dates.push(addDays(start, i));
  return dates;
}

function mergeOverrideMaps(base = {}, overlay = {}) {
  const merged = { ...(base || {}) };
  for (const [date, entries] of Object.entries(overlay || {})) {
    merged[date] = {
      ...(merged[date] || {}),
      ...(entries || {}),
    };
  }
  return merged;
}

function isoDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function hasAgencyOverrideForShift(overrides, date, shift) {
  return Object.values(overrides?.[date] || {}).some(entry => entry?.shift === shift && isAgencyShift(entry.shift));
}

async function findAgencyShiftOverrides(homeId, from, to, existingOverrides = {}) {
  const { rows } = await pool.query(
    `SELECT id, date, shift_code
       FROM agency_shifts
      WHERE home_id = $1
        AND date >= $2
        AND date <= $3
      ORDER BY date, id`,
    [homeId, from, to],
  );
  const agencyOverrides = {};
  for (const row of rows) {
    const date = isoDate(row.date);
    const shift = row.shift_code;
    if (!date || !shift || hasAgencyOverrideForShift(existingOverrides, date, shift)) continue;
    if (!agencyOverrides[date]) agencyOverrides[date] = {};
    agencyOverrides[date][`agency-shift-${row.id}`] = {
      shift,
      source: 'agency-tracker',
    };
  }
  return agencyOverrides;
}

export async function getStaffingPressure(home, days = 7) {
  const dates = dateRange(days);
  const from = formatDate(dates[0]);
  const to = formatDate(dates[dates.length - 1]);
  const [staffResult, overrides] = await Promise.all([
    staffRepo.findByHome(home.id, { limit: 1000 }),
    overrideRepo.findByHome(home.id, from, to),
  ]);
  const staffingOverrides = mergeOverrideMaps(
    overrides || {},
    await findAgencyShiftOverrides(home.id, from, to, overrides || {}),
  );
  const staff = staffResult.rows || [];
  let plannedSlots = 0;
  let gapSlots = 0;
  let shortfallPeriods = 0;

  for (const date of dates) {
    const staffForDay = getStaffForDay(staff, date, staffingOverrides, home.config || {});
    for (const period of ['early', 'late', 'night']) {
      const coverage = calculatePeriodCoverage(staffForDay, period, home.config || {});
      plannedSlots += coverage.required_heads;
      gapSlots += coverage.gap_slots;
      if (coverage.gap_slots > 0) shortfallPeriods += 1;
    }
  }

  return {
    gaps_7d: gapSlots,
    planned_shift_slots_7d: plannedSlots,
    shortfall_periods_7d: shortfallPeriods,
    gaps_per_100_planned_shifts: plannedSlots > 0 ? Math.round((gapSlots / plannedSlots) * 1000) / 10 : null,
    fatigue_breaches: null,
  };
}

function buildHomeKpis(home, summary, actionCounts, agency, readiness, outcomes, staffing) {
  const m = summary.modules || {};
  const outcomeKpis = buildOutcomeKpis(outcomes, home);
  const trainingTotalRequired = Number(m.training?.totalRequired || 0);
  const trainingCompliancePct = trainingTotalRequired > 0 ? m.training?.compliancePct : null;
  const kpis = {
    home_id: home.id,
    home_slug: home.slug,
    home_name: home.config?.home_name || home.name,
    role_id: home.role_id,
    staffing,
    agency,
    training: {
      compliance_pct: trainingCompliancePct,
      baseline_configured: trainingTotalRequired > 0,
      total_required: trainingTotalRequired,
      expired: m.training?.expired || 0,
      expiring_30d: m.training?.expiringSoon || 0,
      not_started: m.training?.notStarted || 0,
    },
    care_certificate: {
      in_progress: m.careCertificate?.inProgress || 0,
      overdue: m.careCertificate?.overdue || 0,
      missing: m.careCertificate?.missing || 0,
    },
    supervisions: {
      overdue: m.supervisions?.overdue || 0,
      due_7d: m.supervisions?.dueSoon || 0,
      no_record: m.supervisions?.noRecord || 0,
    },
    incidents: {
      open: m.incidents?.open || 0,
      rate_per_resident_month: outcomeKpis.incidents_per_resident_month,
      cqc_notifiable_overdue: m.incidents?.cqcOverdue || 0,
      riddor_overdue: m.incidents?.riddorOverdue || 0,
      duty_of_candour_overdue: m.incidents?.docOverdue || 0,
    },
    complaints: {
      open: m.complaints?.open || 0,
      rate_per_resident_month: outcomeKpis.complaints_per_resident_month,
      ack_overdue: m.complaints?.unacknowledged || 0,
      response_overdue: m.complaints?.overdueResponse || 0,
    },
    audits: {
      overdue: m.auditTasks?.overdue || 0,
      due_7d: m.auditTasks?.dueSoon || 0,
      pending_qa: m.auditTasks?.pendingQa || 0,
      evidence_missing: m.auditTasks?.evidenceMissing || 0,
      policy_due_30d: m.policies?.dueSoon || 0,
    },
    cqc_evidence: {
      open_gaps: Array.isArray(readiness?.gaps) ? readiness.gaps.length : null,
      overall: readiness?.overall || null,
      gap_examples: Array.isArray(readiness?.gaps)
        ? readiness.gaps.slice(0, 3).map(gap => ({
          statement_id: gap.statementId,
          statement_name: gap.statementName,
          status: gap.status,
          summary: gap.summary || gap.statusReason || null,
          reasons: Array.isArray(gap.reasons) ? gap.reasons.slice(0, 3) : [],
        }))
        : [],
    },
    maintenance: {
      overdue: m.maintenance?.overdue || 0,
      due_30d: m.maintenance?.dueSoon || 0,
      certs_expired: m.maintenance?.expiredCerts || 0,
    },
    manager_actions: actionCounts,
    occupancy: {
      pct: m.beds?.occupancyRate ?? null,
      available: m.beds?.available || 0,
      hospital_hold: m.beds?.hospitalHold || 0,
    },
    outcomes: outcomeKpis,
  };
  const rag = buildPortfolioRag(kpis);
  return {
    ...kpis,
    rag,
    data_quality: buildDataQuality(rag),
  };
}

function countRag(home, value) {
  return Object.entries(home.rag || {})
    .filter(([key, rag]) => key !== 'overall' && rag === value)
    .length;
}

function buildPortfolioSummary(homes) {
  const summary = {
    home_count: homes.length,
    red_homes: 0,
    amber_homes: 0,
    green_homes: 0,
    unknown_homes: 0,
    homes_with_unknown_kpis: 0,
    unknown_kpi_signals: 0,
    cqc_open_gaps: 0,
    cqc_gap_homes: 0,
    escalated_actions_l3_plus: 0,
    overdue_actions: 0,
    emergency_override_pct_red_homes: 0,
  };

  for (const home of homes) {
    const overall = home.rag?.overall || 'unknown';
    if (overall === 'red') summary.red_homes += 1;
    else if (overall === 'amber') summary.amber_homes += 1;
    else if (overall === 'green') summary.green_homes += 1;
    else summary.unknown_homes += 1;

    const unknownCount = Number(home.data_quality?.unknown_count || 0);
    if (unknownCount > 0) summary.homes_with_unknown_kpis += 1;
    summary.unknown_kpi_signals += unknownCount;

    const cqcOpenGaps = home.cqc_evidence?.open_gaps;
    if (cqcOpenGaps == null || Number(cqcOpenGaps || 0) > 0 || home.rag?.cqc_evidence !== 'green') {
      summary.cqc_gap_homes += 1;
    }
    if (cqcOpenGaps != null) summary.cqc_open_gaps += Number(cqcOpenGaps || 0);

    summary.escalated_actions_l3_plus += Number(home.manager_actions?.escalated_l3_plus || 0);
    summary.overdue_actions += Number(home.manager_actions?.overdue || 0);
    if (Number(home.agency?.emergency_override_pct || 0) > 20) {
      summary.emergency_override_pct_red_homes += 1;
    }
  }

  return summary;
}

function weakestHomes(homes, limit = 3) {
  return [...homes]
    .map(home => ({
      ...home,
      red_count: countRag(home, 'red'),
      amber_count: countRag(home, 'amber'),
    }))
    .sort((a, b) => (
      b.red_count - a.red_count
      || b.amber_count - a.amber_count
      || Number(b.manager_actions?.overdue || 0) - Number(a.manager_actions?.overdue || 0)
      || String(a.home_name).localeCompare(String(b.home_name))
    ))
    .slice(0, limit);
}

function agencyPressure(homes) {
  return [...homes]
    .map(home => ({
      home_id: home.home_id,
      home_slug: home.home_slug,
      home_name: home.home_name,
      shifts_28d: home.agency?.shifts_28d || 0,
      shifts_7d: home.agency?.shifts_7d || 0,
      agency_attempts_7d: home.agency?.agency_attempts_7d || 0,
      emergency_overrides_7d: home.agency?.emergency_overrides_7d || 0,
      linked_emergency_override_shifts_7d: home.agency?.linked_emergency_override_shifts_7d || 0,
      emergency_override_pct: home.agency?.emergency_override_pct || 0,
      rag: home.rag?.agency || 'unknown',
    }))
    .sort((a, b) => (
      b.emergency_override_pct - a.emergency_override_pct
      || b.shifts_28d - a.shifts_28d
      || String(a.home_name).localeCompare(String(b.home_name))
    ));
}

function trainingGaps(homes) {
  return homes
    .map(home => ({
      home_id: home.home_id,
      home_slug: home.home_slug,
      home_name: home.home_name,
      compliance_pct: home.training?.compliance_pct,
      expired: home.training?.expired || 0,
      expiring_30d: home.training?.expiring_30d || 0,
      not_started: home.training?.not_started || 0,
      rag: home.rag?.training || 'unknown',
    }))
    .filter(row => row.rag !== 'green' || row.expired > 0 || row.expiring_30d > 0 || row.not_started > 0)
    .sort((a, b) => (
      Number(a.compliance_pct ?? -1) - Number(b.compliance_pct ?? -1)
      || b.expired - a.expired
      || String(a.home_name).localeCompare(String(b.home_name))
    ));
}

function cqcEvidenceGaps(homes) {
  return homes
    .map(home => ({
      home_id: home.home_id,
      home_slug: home.home_slug,
      home_name: home.home_name,
      open_gaps: home.cqc_evidence?.open_gaps,
      overall: home.cqc_evidence?.overall || null,
      gap_examples: home.cqc_evidence?.gap_examples || [],
      rag: home.rag?.cqc_evidence || 'unknown',
    }))
    .filter(row => row.open_gaps == null || row.open_gaps > 0 || row.rag !== 'green')
    .sort((a, b) => (
      Number(b.open_gaps ?? -1) - Number(a.open_gaps ?? -1)
      || String(a.home_name).localeCompare(String(b.home_name))
    ));
}

function dataQualityIssues(homes) {
  return homes
    .flatMap(home => (home.data_quality?.unknown_signals || []).map(signal => ({
      home_id: home.home_id,
      home_slug: home.home_slug,
      home_name: home.home_name,
      key: signal.key,
      label: signal.label,
      reason: signal.reason,
      fix: signal.fix,
      route: signal.route,
    })))
    .sort((a, b) => (
      String(a.home_name).localeCompare(String(b.home_name))
      || String(a.label).localeCompare(String(b.label))
    ));
}

export function buildPortfolioBoardPack(kpis, escalatedActions = []) {
  const homes = Array.isArray(kpis?.homes) ? kpis.homes : [];
  const actionExceptions = Array.isArray(escalatedActions)
    ? {
      rows: escalatedActions,
      total: escalatedActions.length,
      omitted: 0,
    }
    : {
      rows: Array.isArray(escalatedActions?.rows) ? escalatedActions.rows : [],
      total: Number(escalatedActions?.total ?? escalatedActions?.rows?.length ?? 0),
      omitted: Number(escalatedActions?.omitted ?? 0),
    };
  return {
    generated_at: kpis?.generated_at || new Date().toISOString(),
    summary: buildPortfolioSummary(homes),
    homes,
    weakest_homes: weakestHomes(homes),
    escalated_actions: actionExceptions.rows,
    action_exceptions: actionExceptions.rows,
    action_exception_count: actionExceptions.total,
    action_exception_omitted_count: actionExceptions.omitted,
    agency_pressure: agencyPressure(homes),
    training_gaps: trainingGaps(homes),
    cqc_evidence_gaps: cqcEvidenceGaps(homes),
    data_quality_issues: dataQualityIssues(homes),
  };
}

export async function getPortfolioKpisForUser({ username, isPlatformAdmin = false } = {}) {
  const key = cacheKey(username, isPlatformAdmin);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.value;

  const homes = await getAccessibleHomes(username, isPlatformAdmin);
  const homeIds = homes.map(home => home.id);
  const [actionsMap, agencyMap] = await Promise.all([
    actionItemRepo.countByHome(homeIds).then(actionCountsByHome),
    getAgencyByHome(homeIds),
  ]);

  const rows = await Promise.all(homes.map(async (home) => {
    const [summary, readiness, derivedOutcomes, manualMetrics, staffing] = await Promise.all([
      dashboardService.getDashboardSummary(home.id),
      computeCqcReadiness(home.id, 28).catch(() => null),
      outcomeMetricRepo.getDerivedMetrics(home.id).catch(() => null),
      outcomeMetricRepo.findManualMetrics(home.id).catch(() => []),
      getStaffingPressure(home).catch(() => ({
        gaps_7d: null,
        planned_shift_slots_7d: null,
        shortfall_periods_7d: null,
        gaps_per_100_planned_shifts: null,
        fatigue_breaches: null,
      })),
    ]);
    const outcomes = derivedOutcomes
      ? { ...derivedOutcomes, manual_metrics: Array.isArray(manualMetrics) ? manualMetrics : [] }
      : { manual_metrics: Array.isArray(manualMetrics) ? manualMetrics : [] };
    return buildHomeKpis(
      home,
      summary,
      withDefaultActions(actionsMap, home.id),
      withDefaultAgency(agencyMap, home.id),
      readiness,
      outcomes,
      staffing,
    );
  }));

  const value = {
    generated_at: new Date().toISOString(),
    homes: rows,
  };
  cache.set(key, { ts: now, value });
  return value;
}

export async function getPortfolioBoardPackForUser({ username, isPlatformAdmin = false } = {}) {
  const kpis = await getPortfolioKpisForUser({ username, isPlatformAdmin });
  const homeIds = (kpis.homes || []).map(home => home.home_id);
  const actionExceptions = await actionItemRepo.findBoardPackExceptionsByHomeIds(homeIds, 50);
  return buildPortfolioBoardPack(kpis, actionExceptions);
}
