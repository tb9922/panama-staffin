import { pool } from '../db.js';
import * as dashboardService from './dashboardService.js';
import { computeCqcReadiness } from './assessmentService.js';
import * as actionItemRepo from '../repositories/actionItemRepo.js';
import * as agencyAttemptRepo from '../repositories/agencyAttemptRepo.js';
import * as outcomeMetricRepo from '../repositories/outcomeMetricRepo.js';
import * as overrideRepo from '../repositories/overrideRepo.js';
import * as staffRepo from '../repositories/staffRepo.js';
import { hasModuleAccess } from '../shared/roles.js';
import { PORTFOLIO_RAG_THRESHOLDS, buildPortfolioRag, overallRag, ragAtMost } from '../shared/portfolioRag.js';
import {
  addDays,
  formatDate,
  getStaffForDay,
  isCareRole,
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
            COUNT(*) FILTER (WHERE date >= CURRENT_DATE - INTERVAL '7 days')::int AS shifts_7d,
            COALESCE(SUM(total_cost), 0)::numeric AS cost_28d
       FROM agency_shifts
      WHERE home_id = ANY($1::int[])
        AND date >= CURRENT_DATE - INTERVAL '28 days'
      GROUP BY home_id`,
    [homeIds]
    ),
    agencyAttemptRepo.countEmergencyOverridesByHome(homeIds),
  ]);
  const overridesByHome = new Map(overrideRows.map(row => [row.home_id, row]));
  return new Map(rows.map(row => {
    const overrides = overridesByHome.get(row.home_id) || {};
    const emergencyOverrides = Number(overrides.emergency_overrides_7d || 0);
    const shifts7d = Number(row.shifts_7d || 0);
    return [row.home_id, {
      shifts_28d: row.shifts_28d,
      shifts_7d: shifts7d,
      cost_28d: Number(row.cost_28d || 0),
      emergency_overrides_7d: emergencyOverrides,
      emergency_override_pct: shifts7d > 0 ? Math.round((emergencyOverrides / shifts7d) * 100) : 0,
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
    cost_28d: 0,
    emergency_overrides_7d: 0,
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

function buildOutcomeKpis(outcomes) {
  const incidents = outcomes?.incidents || {};
  const thresholds = PORTFOLIO_RAG_THRESHOLDS;
  const rag = overallRag({
    falls: ragAtMost(incidents.falls, thresholds.falls28d),
    infections: ragAtMost(incidents.infections, thresholds.infections28d),
    pressure_sores: ragAtMost(incidents.pressure_sores, thresholds.pressureSores28d),
  });
  return {
    rag,
    falls_28d: incidents.falls ?? null,
    infections_28d: incidents.infections ?? null,
    pressure_sores_new_28d: incidents.pressure_sores ?? null,
    complaints_28d: outcomes?.complaints?.complaints_total ?? null,
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

export async function getStaffingPressure(home, days = 7) {
  const dates = dateRange(days);
  const from = formatDate(dates[0]);
  const to = formatDate(dates[dates.length - 1]);
  const [staffResult, overrides] = await Promise.all([
    staffRepo.findByHome(home.id, { limit: 1000 }),
    overrideRepo.findByHome(home.id, from, to),
  ]);
  const staff = staffResult.rows || [];
  let plannedSlots = 0;
  let gapSlots = 0;
  let shortfallPeriods = 0;

  for (const date of dates) {
    const staffForDay = getStaffForDay(staff, date, overrides || {}, home.config || {});
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
    gaps_per_100_planned_shifts: plannedSlots > 0 ? Math.round((gapSlots / plannedSlots) * 1000) / 10 : 0,
    fatigue_breaches: null,
  };
}

function buildHomeKpis(home, summary, actionCounts, agency, readiness, outcomes, staffing) {
  const m = summary.modules || {};
  const kpis = {
    home_id: home.id,
    home_slug: home.slug,
    home_name: home.config?.home_name || home.name,
    role_id: home.role_id,
    staffing,
    agency,
    training: {
      compliance_pct: m.training?.compliancePct ?? 100,
      expired: m.training?.expired || 0,
      expiring_30d: m.training?.expiringSoon || 0,
      not_started: m.training?.notStarted || 0,
    },
    supervisions: {
      overdue: m.supervisions?.overdue || 0,
      due_7d: m.supervisions?.dueSoon || 0,
      no_record: m.supervisions?.noRecord || 0,
    },
    incidents: {
      open: m.incidents?.open || 0,
      cqc_notifiable_overdue: m.incidents?.cqcOverdue || 0,
      riddor_overdue: m.incidents?.riddorOverdue || 0,
      duty_of_candour_overdue: m.incidents?.docOverdue || 0,
    },
    complaints: {
      open: m.complaints?.open || 0,
      ack_overdue: m.complaints?.unacknowledged || 0,
      response_overdue: m.complaints?.overdueResponse || 0,
    },
    audits: {
      overdue: m.policies?.overdue || 0,
      due_7d: null,
      policy_due_30d: m.policies?.dueSoon || 0,
    },
    cqc_evidence: {
      open_gaps: Array.isArray(readiness?.gaps) ? readiness.gaps.length : null,
      overall: readiness?.overall || null,
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
    outcomes: buildOutcomeKpis(outcomes),
  };
  return {
    ...kpis,
    rag: buildPortfolioRag(kpis),
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
      emergency_overrides_7d: home.agency?.emergency_overrides_7d || 0,
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
      rag: home.rag?.cqc_evidence || 'unknown',
    }))
    .filter(row => row.open_gaps == null || row.open_gaps > 0 || row.rag !== 'green')
    .sort((a, b) => (
      Number(b.open_gaps ?? -1) - Number(a.open_gaps ?? -1)
      || String(a.home_name).localeCompare(String(b.home_name))
    ));
}

export function buildPortfolioBoardPack(kpis, escalatedActions = []) {
  const homes = Array.isArray(kpis?.homes) ? kpis.homes : [];
  return {
    generated_at: kpis?.generated_at || new Date().toISOString(),
    summary: buildPortfolioSummary(homes),
    homes,
    weakest_homes: weakestHomes(homes),
    escalated_actions: escalatedActions,
    agency_pressure: agencyPressure(homes),
    training_gaps: trainingGaps(homes),
    cqc_evidence_gaps: cqcEvidenceGaps(homes),
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
    const [summary, readiness, outcomes, staffing] = await Promise.all([
      dashboardService.getDashboardSummary(home.id),
      computeCqcReadiness(home.id, 28).catch(() => null),
      outcomeMetricRepo.getDerivedMetrics(home.id).catch(() => null),
      getStaffingPressure(home).catch(() => ({
        gaps_7d: null,
        planned_shift_slots_7d: null,
        shortfall_periods_7d: null,
        gaps_per_100_planned_shifts: null,
        fatigue_breaches: null,
      })),
    ]);
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
  const escalatedActions = await actionItemRepo.findEscalatedByHomeIds(homeIds, 50);
  return buildPortfolioBoardPack(kpis, escalatedActions);
}
