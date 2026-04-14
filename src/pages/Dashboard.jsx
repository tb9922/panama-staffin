import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCycleDates, getStaffForDay, formatDate, isWorkingShift, isCareRole } from '../lib/rotation.js';
import { getDayCoverageStatus, calculateDayCost, checkFatigueRisk } from '../lib/escalation.js';
import { calculateAccrual } from '../lib/accrual.js';
import { getTrainingTypes, buildComplianceMatrix, getComplianceStats } from '../lib/training.js';
import { getMinimumWageRate } from '../../shared/nmw.js';
import { getHrAlerts } from '../lib/hr.js';
import { getCurrentHome, getSchedulingData, getHrStats, getHrWarnings, getFinanceAlerts, getDashboardSummary, isAbortLikeError } from '../lib/api.js';
import { getFinanceAlertsForDashboard } from '../lib/finance.js';
import { startOfNextLocalDay } from '../lib/localDates.js';
import { CARD, BADGE, BTN, ESC_COLORS, HEATMAP } from '../lib/design.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { useData } from '../contexts/DataContext.jsx';

const TYPE_ORDER = { error: 0, warning: 1, info: 2 };
const DEFAULT_PRIORITY = { error: 3, warning: 2, info: 1 };

function sortAlerts(a, b) {
  return (b.priority - a.priority) || ((TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99));
}

function withPriority(alert, priority = null) {
  return {
    ...alert,
    priority: alert.priority ?? priority ?? DEFAULT_PRIORITY[alert.type] ?? 1,
  };
}

const WORKSPACE_ROLES = new Set(['staff_member', 'finance_officer', 'training_lead', 'hr_officer', 'viewer']);

const ROLE_WORKSPACE_CONFIG = {
  staff_member: {
    title: 'My Workspace',
    subtitle: 'Everything you need for your own shifts, leave, handover, and pay view is gathered here.',
    tone: 'blue',
    cards: [
      { path: '/rotation', label: 'My Schedule', description: 'Check your upcoming shifts and any rota changes.', module: 'scheduling' },
      { path: '/leave', label: 'My Leave', description: 'Review leave requests and upcoming time off.', module: 'scheduling' },
      { path: '/handover', label: 'My Handover', description: 'Read and update your own handover notes safely.', module: 'scheduling' },
      { path: '/payroll/monthly-timesheet', label: 'Monthly Timesheet', description: 'Review your own hours in the payroll-ready timesheet view.', module: 'payroll' },
    ],
  },
  finance_officer: {
    title: 'Finance Workspace',
    subtitle: 'Your core billing, collections, payables, and payroll tools are front and centre here.',
    tone: 'emerald',
    cards: [
      { path: '/finance', label: 'Finance Dashboard', description: 'Start with the headline finance position for the home.', module: 'finance' },
      { path: '/finance/income', label: 'Income & Billing', description: 'Manage resident charges, fee history, and billing notes.', module: 'finance' },
      { path: '/finance/receivables', label: 'Receivables', description: 'Follow outstanding balances and incoming payments.', module: 'finance' },
      { path: '/finance/payables', label: 'Payables', description: 'Track supplier liabilities and payment status.', module: 'finance' },
      { path: '/payroll', label: 'Payroll Runs', description: 'Move through payroll runs and final approvals.', module: 'payroll' },
      { path: '/payroll/timesheets', label: 'Timesheets', description: 'Cross-check hours before payroll is calculated.', module: 'payroll' },
    ],
  },
  training_lead: {
    title: 'Learning Workspace',
    subtitle: 'Keep onboarding, training, and evidence tasks together in one place.',
    tone: 'purple',
    cards: [
      { path: '/training', label: 'Training', description: 'Monitor expiry, compliance, and individual training records.', module: 'compliance' },
      { path: '/care-cert', label: 'Care Certificate', description: 'Track care certificate progress and evidence.', module: 'compliance' },
      { path: '/onboarding', label: 'Onboarding', description: 'Finish new-starter checks and missing onboarding steps.', module: 'compliance' },
      { path: '/cqc', label: 'CQC Evidence', description: 'Link training evidence into the wider compliance picture.', module: 'compliance' },
    ],
  },
  hr_officer: {
    title: 'HR Workspace',
    subtitle: 'People cases, contracts, absence, and renewals are grouped here so the handoffs feel tighter.',
    tone: 'amber',
    cards: [
      { path: '/hr', label: 'HR Dashboard', description: 'Start from the HR overview and current case load.', module: 'hr' },
      { path: '/hr/absence', label: 'Absence', description: 'Manage sickness, return-to-work, and OH follow-up.', module: 'hr' },
      { path: '/hr/contracts', label: 'Contracts', description: 'Review contract changes and issued paperwork.', module: 'hr' },
      { path: '/hr/family-leave', label: 'Family Leave', description: 'Track statutory family leave cases and pay type.', module: 'hr' },
      { path: '/hr/renewals', label: 'DBS and Right to Work', description: 'Stay ahead of DBS renewal and right-to-work deadlines.', module: 'hr' },
    ],
  },
  viewer: {
    title: 'Read-Only Workspace',
    subtitle: 'Quick links to the parts of the home you can review without editing anything.',
    tone: 'slate',
    cards: [
      { path: '/rotation', label: 'Schedule', description: 'View the rota without stepping into edit-heavy tools.', module: 'scheduling' },
      { path: '/handover', label: 'Handover Book', description: 'Read the latest handover context and updates.', module: 'scheduling' },
      { path: '/reports', label: 'Reports', description: 'Jump straight into reporting and exported summaries.', module: 'reports' },
    ],
  },
};

function getWorkspaceToneClasses(tone) {
  switch (tone) {
    case 'emerald':
      return {
        hero: 'border-emerald-200 bg-emerald-50',
        eyebrow: 'text-emerald-700',
        icon: 'bg-emerald-100 text-emerald-700',
        accent: 'border-emerald-200',
        button: BTN.success,
      };
    case 'purple':
      return {
        hero: 'border-purple-200 bg-purple-50',
        eyebrow: 'text-purple-700',
        icon: 'bg-purple-100 text-purple-700',
        accent: 'border-purple-200',
        button: `${BTN.secondary} border-purple-200 text-purple-700 hover:bg-purple-50`,
      };
    case 'amber':
      return {
        hero: 'border-amber-200 bg-amber-50',
        eyebrow: 'text-amber-700',
        icon: 'bg-amber-100 text-amber-700',
        accent: 'border-amber-200',
        button: `${BTN.secondary} border-amber-200 text-amber-700 hover:bg-amber-50`,
      };
    case 'slate':
      return {
        hero: 'border-slate-200 bg-slate-50',
        eyebrow: 'text-slate-700',
        icon: 'bg-slate-200 text-slate-700',
        accent: 'border-slate-200',
        button: BTN.secondary,
      };
    default:
      return {
        hero: 'border-blue-200 bg-blue-50',
        eyebrow: 'text-blue-700',
        icon: 'bg-blue-100 text-blue-700',
        accent: 'border-blue-200',
        button: BTN.primary,
      };
  }
}

const GBP_FORMATTER = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatCurrency(value) {
  return GBP_FORMATTER.format(Number(value) || 0);
}

function getCoverageHealthLabel(level) {
  if (level <= 1) return 'Covered';
  if (level <= 2) return 'Covered with float or overtime';
  if (level <= 3) return 'Covered with agency';
  return 'Below minimum';
}

function CoverageGauge({ period, cov }) {
  if (!cov) return null;
  const headPct = cov.coverage.required.heads > 0
    ? Math.min((cov.coverage.headCount / cov.coverage.required.heads) * 100, 100) : 100;
  const skillPct = cov.coverage.required.skill_points > 0
    ? Math.min((cov.coverage.skillPoints / cov.coverage.required.skill_points) * 100, 100) : 100;
  const esc = ESC_COLORS[cov.escalation.color] || ESC_COLORS.green;
  return (
    <div className={`border rounded-xl p-3.5 ${esc.card}`}>
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-sm font-semibold capitalize">{period}</span>
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${esc.badge}`}>
          {cov.escalation.label}
        </span>
      </div>
      <div className="space-y-2">
        <div>
          <div className="flex justify-between text-xs text-gray-600 mb-1">
            <span>Staff on shift</span>
            <span className="font-mono font-bold">{cov.coverage.headCount}/{cov.coverage.required.heads}</span>
          </div>
          <div className="w-full bg-white/60 rounded-full h-2">
            <div className={`h-full rounded-full transition-all duration-300 ${esc.bar}`} style={{ width: `${headPct}%` }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-gray-600 mb-1">
            <span title="Available skill points against the minimum required">Skill points</span>
            <span className="font-mono font-bold">{cov.coverage.skillPoints.toFixed(1)}/{cov.coverage.required.skill_points}</span>
          </div>
          <div className="w-full bg-white/60 rounded-full h-2">
            <div className={`h-full rounded-full transition-all duration-300 ${esc.bar}`} style={{ width: `${skillPct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { homeRole } = useData();
  const [schedState, setSchedState] = useState({ homeSlug: null, data: null, error: null });
  const homeSlug = getCurrentHome();
  const usesWorkspaceHome = WORKSPACE_ROLES.has(homeRole);
  const scopedSchedState = schedState.homeSlug === homeSlug ? schedState : { homeSlug: null, data: null, error: null };
  const schedData = scopedSchedState.data;
  const error = scopedSchedState.error;
  const loading = Boolean(homeSlug && !usesWorkspaceHome && !schedData && !error);

  useEffect(() => {
    if (!homeSlug || usesWorkspaceHome) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    getSchedulingData(homeSlug, { signal: controller.signal })
      .then(data => {
        if (!cancelled) setSchedState({ homeSlug, data, error: null });
      })
      .catch(e => {
        if (!cancelled && !isAbortLikeError(e, controller.signal)) {
          setSchedState({ homeSlug, data: null, error: e.message || 'Failed to load' });
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [homeSlug, usesWorkspaceHome]);

  if (!homeSlug) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className={CARD.padded}>
          <EmptyState
            title="Dashboard"
            description="Select a home to view the dashboard."
            compact
          />
        </div>
      </div>
    );
  }

  if (usesWorkspaceHome) return <RoleWorkspaceHome roleId={homeRole} />;

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <LoadingState message="Loading dashboard..." card />
      </div>
    );
  }
  if (error || !schedData) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <ErrorState
          title="Dashboard needs attention"
          message={error || 'Failed to load scheduling data'}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  return <DashboardInner schedData={schedData} />;
}

function RoleWorkspaceHome({ roleId }) {
  const navigate = useNavigate();
  const { canRead } = useData();
  const config = ROLE_WORKSPACE_CONFIG[roleId] || ROLE_WORKSPACE_CONFIG.viewer;
  const tone = getWorkspaceToneClasses(config.tone);
  const visibleCards = config.cards.filter(card => !card.module || canRead(card.module));

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <section className={`${CARD.padded} ${tone.hero}`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="max-w-3xl">
            <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${tone.eyebrow}`}>Workspace</p>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">{config.title}</h1>
            <p className="mt-2 text-sm text-gray-600">{config.subtitle}</p>
          </div>
          <div className="rounded-2xl border border-white/60 bg-white/80 px-4 py-3 text-sm text-gray-600 shadow-sm">
            <p className="font-semibold text-gray-900">Start here</p>
            <p className="mt-1 max-w-xs">Use these pinned tools to jump straight into the parts of the app that match your role instead of landing on the operations dashboard.</p>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Pinned Tools</h2>
            <p className="text-sm text-gray-500">The links below stay intentionally focused so the workspace feels lighter than the full sidebar.</p>
          </div>
          <span className={BADGE.gray}>{visibleCards.length} shortcuts</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleCards.map(card => (
            <button
              key={card.path}
              type="button"
              onClick={() => navigate(card.path)}
              className={`${CARD.padded} ${tone.accent} text-left transition hover:-translate-y-0.5 hover:shadow-md`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">{card.label}</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-600">{card.description}</p>
                </div>
                <span className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${tone.icon}`}>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </div>
              <div className="mt-5">
                <span className={`${tone.button} ${BTN.sm}`}>Open {card.label}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className={CARD.padded}>
        <h2 className="text-base font-semibold text-gray-900">What changed</h2>
        <p className="mt-2 text-sm text-gray-600">
          This dashboard is now role-aware. We keep the full operational dashboard for management roles, and give everyone else a faster workspace home so the app feels clearer from the first click.
        </p>
      </section>
    </div>
  );
}

function DashboardInner({ schedData }) {
  const config = schedData.config;
  const staff = schedData.staff;
  const overrides = schedData.overrides;
  const training = schedData.training || {};

  const { canWrite, canRead } = useData();
  const canEdit = canWrite('scheduling');
  const canViewHr = canRead('hr');
  const canViewFinance = canRead('finance');
  const navigate = useNavigate();

  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const now = new Date();
    const timer = setTimeout(() => setToday(new Date()), startOfNextLocalDay(now).getTime() - now.getTime());
    return () => clearTimeout(timer);
  }, [today]);

  const [auxState, setAuxState] = useState({
    home: null,
    hrData: { stats: null, warnings: [] },
    financeAlerts: [],
    summary: null,
    auxFailures: [],
  });
  const home = getCurrentHome();
  const scopedAuxState = auxState.home === home
    ? auxState
    : {
        home: null,
        hrData: { stats: null, warnings: [] },
        financeAlerts: [],
        summary: null,
        auxFailures: [],
      };
  const hrData = scopedAuxState.hrData;
  const financeAlerts = scopedAuxState.financeAlerts;
  const summary = scopedAuxState.summary;
  const auxFailures = scopedAuxState.auxFailures;

  useEffect(() => {
    if (!home) return undefined;

    let cancelled = false;
    const controller = new AbortController();

    Promise.all([
      canViewHr ? getHrStats(home, { signal: controller.signal }) : Promise.resolve(null),
      canViewHr ? getHrWarnings(home, { signal: controller.signal }) : Promise.resolve([]),
      canViewFinance ? getFinanceAlerts(home, { signal: controller.signal }) : Promise.resolve([]),
      getDashboardSummary(home, { signal: controller.signal }),
    ].map(p => Promise.resolve(p).then(
      value => ({ ok: true, value }),
      error => ({ ok: false, error }),
    ))).then(([statsResult, warningsResult, financeResult, summaryResult]) => {
      if (cancelled) return;

      const nextHrData = { stats: null, warnings: [] };
      const nextFinanceAlerts = [];
      let nextSummary = null;
      const failures = [];

      if (statsResult.ok) {
        nextHrData.stats = statsResult.value;
      } else if (!isAbortLikeError(statsResult.error, controller.signal)) {
        console.warn('Failed to load HR stats:', statsResult.error?.message);
        failures.push('HR stats');
      }

      if (warningsResult.ok) {
        nextHrData.warnings = Array.isArray(warningsResult.value) ? warningsResult.value : [];
      } else if (!isAbortLikeError(warningsResult.error, controller.signal)) {
        console.warn('Failed to load HR warnings:', warningsResult.error?.message);
        failures.push('HR warnings');
      }

      if (financeResult.ok) {
        nextFinanceAlerts.push(...(Array.isArray(financeResult.value) ? financeResult.value : []));
      } else if (!isAbortLikeError(financeResult.error, controller.signal)) {
        console.warn('Failed to load finance alerts:', financeResult.error?.message);
        failures.push('Finance alerts');
      }

      if (summaryResult.ok) {
        nextSummary = summaryResult.value;
      } else if (!isAbortLikeError(summaryResult.error, controller.signal)) {
        console.warn('Failed to load dashboard summary:', summaryResult.error?.message);
        failures.push('Dashboard summary');
      }

      setAuxState({
        home,
        hrData: nextHrData,
        financeAlerts: nextFinanceAlerts,
        summary: nextSummary,
        auxFailures: failures,
      });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [home, canViewFinance, canViewHr]);

  const degradedSources = useMemo(() => {
    const sources = [...auxFailures];
    if (summary?._degraded && summary._failedModules?.length) {
      sources.push(`Summary modules: ${summary._failedModules.join(', ')}`);
    }
    return [...new Set(sources)];
  }, [auxFailures, summary]);

  const cycleDates = useMemo(() => getCycleDates(config.cycle_start_date, today, 28), [config.cycle_start_date, today]);

  const cycleData = useMemo(() => {
    return cycleDates.map(date => {
      const staffForDay = getStaffForDay(staff, date, overrides, config);
      const coverage = getDayCoverageStatus(staffForDay, config);
      const cost = calculateDayCost(staffForDay, config);
      return { date, staffForDay, coverage, cost };
    });
  }, [staff, overrides, config, cycleDates]);

  const todayIdx = useMemo(() => {
    const todayStr = formatDate(today);
    return cycleData.findIndex(d => formatDate(d.date) === todayStr);
  }, [cycleData, today]);

  const todayData = todayIdx >= 0 ? cycleData[todayIdx] : cycleData[0];
  const todayStaff = todayData.staffForDay;
  const onDuty = todayStaff.filter(s => isWorkingShift(s.shift));
  const sick = todayStaff.filter(s => s.shift === 'SICK');
  const al = todayStaff.filter(s => s.shift === 'AL');
  const agencyToday = todayStaff.filter(s => s.shift?.startsWith('AG-'));
  const floatDeployed = todayStaff.filter(s => s.team === 'Float' && isWorkingShift(s.shift) && s.shift !== 'AVL');

  const cycleCost = useMemo(() => cycleData.reduce((s, d) => s + d.cost.total, 0), [cycleData]);
  const monthlyProj = cycleCost / 28 * 30.44;
  const annualProj = cycleCost / 28 * 365;
  const agencyTotal = cycleData.reduce((s, d) => s + d.cost.agency, 0);
  const agencyPct = cycleCost > 0 ? (agencyTotal / cycleCost) * 100 : 0;

  const alerts = useMemo(() => {
    const list = [];

    cycleData.forEach(d => {
      const dateLabel = d.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
      ['early', 'late', 'night'].forEach(period => {
        const esc = d.coverage[period]?.escalation;
        if (!esc) return;
        if (esc.level >= 4) list.push(withPriority({ type: 'error', msg: `${dateLabel}: ${period} — ${esc.status}` }, 4));
        else if (esc.level >= 3) list.push(withPriority({ type: 'warning', msg: `${dateLabel}: ${period} — ${esc.status}` }, 3));
      });
    });

    const activeCareStaff = staff.filter(s => s.active !== false && isCareRole(s.role));

    activeCareStaff.forEach((s, idx) => {
      const fatigue = checkFatigueRisk(s, today, overrides, config);
      const label = canEdit ? s.name : `Staff Member ${idx + 1}`;
      if (fatigue.exceeded) {
        list.push(withPriority({ type: 'error', msg: `${label}: ${fatigue.consecutive} consecutive days (max ${config.max_consecutive_days})` }, 4));
      } else if (fatigue.atRisk) {
        list.push(withPriority({ type: 'warning', msg: `${label}: ${fatigue.consecutive} consecutive days — at limit` }, 3));
      }
    });

    activeCareStaff.forEach((s, idx) => {
      if (s.hourly_rate == null) return;
      const { rate, label: rateLabel } = getMinimumWageRate(s.date_of_birth, config);
      if (s.hourly_rate < rate) {
        const label = canEdit ? s.name : `Staff Member ${idx + 1}`;
        list.push(withPriority({ type: 'error', msg: `${label}: £${canEdit ? s.hourly_rate.toFixed(2) : '**.**'}/hr is below ${rateLabel} £${rate.toFixed(2)}` }, 4));
      }
    });

    activeCareStaff.forEach((s, idx) => {
      const acc = calculateAccrual(s, config, overrides, today);
      if (acc.remainingHours < 0) {
        const label = canEdit ? s.name : `Staff Member ${idx + 1}`;
        list.push(withPriority({ type: 'warning', msg: `${label}: ${Math.abs(acc.remainingHours).toFixed(1)} AL hours over earned balance` }, 2));
      }
    });

    if (summary?.alerts) {
      summary.alerts.forEach(a => list.push(withPriority({
        type: a.type,
        msg: a.message,
        link: a.link,
        priority: a.priority,
      })));
    }

    getHrAlerts(hrData.stats, hrData.warnings).forEach(a => {
      const type = a.severity === 'red' ? 'error' : 'warning';
      list.push(withPriority({ type, msg: `HR: ${a.label}` }, type === 'error' ? 3 : 2));
    });

    getFinanceAlertsForDashboard(financeAlerts).forEach(a => list.push(withPriority(a)));

    list.sort(sortAlerts);
    return list.slice(0, 24);
  }, [cycleData, staff, overrides, config, hrData, financeAlerts, summary, canEdit, today]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{config.home_name} — Dashboard</h1>
        <p className="text-xs text-gray-500">Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white rounded-2xl p-5 mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between shadow-lg shadow-blue-900/20">
        <div>
          <h1 className="text-xl font-bold">{config.home_name}</h1>
          <p className="text-blue-200 text-sm">{config.registered_beds} beds — {config.care_type}</p>
        </div>
        <div className="text-left sm:text-right">
          <div className="text-2xl font-bold">{today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end mt-1">
            <span className="text-blue-200 text-xs">Rota cycle</span>
            <button type="button" onClick={() => window.print()} className="text-blue-200 hover:text-white text-xs border border-blue-400/50 rounded-lg px-2.5 py-1 print:hidden transition-colors">Print</button>
          </div>
        </div>
      </div>

      {degradedSources.length > 0 && (
        <div className="mb-4 rounded-md bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800">
          Some dashboard data could not be loaded ({degradedSources.join('; ')}). Alerts and counts may be incomplete.
        </div>
      )}

      <button type="button" className={`${CARD.padded} mb-6 w-full text-left transition-shadow hover:shadow-md`} onClick={() => navigate(`/day/${formatDate(today)}`)} aria-label={`Open daily status for ${formatDate(today)}`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Today's Coverage — Live Status</h2>
          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
            todayData.coverage.overallLevel <= 1 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
            todayData.coverage.overallLevel <= 2 ? 'bg-amber-50 text-amber-700 border-amber-200' :
            todayData.coverage.overallLevel <= 3 ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
            'bg-red-50 text-red-700 border-red-200'
          }`}>
            {todayData.coverage.overallLevel <= 1 ? 'ALL CLEAR' :
             todayData.coverage.overallLevel <= 2 ? 'MONITOR' :
             todayData.coverage.overallLevel <= 3 ? 'ACTION NEEDED' :
             'CRITICAL'}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <CoverageGauge period="early" cov={todayData.coverage.early} />
          <CoverageGauge period="late" cov={todayData.coverage.late} />
          <CoverageGauge period="night" cov={todayData.coverage.night} />
        </div>
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={CARD.padded}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Staffing Summary</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {[
              ['On Duty', onDuty.length, onDuty.length === 0 ? 'text-red-600' : 'text-emerald-600', onDuty.length === 0 ? 'border-l-red-500' : 'border-l-emerald-500'],
              ['Sick', sick.length, sick.length > 0 ? 'text-red-600' : 'text-gray-400', 'border-l-red-500'],
              ['Annual Leave', al.length, al.length > 0 ? 'text-yellow-600' : 'text-gray-400', 'border-l-yellow-500'],
              ['Covering Staff', floatDeployed.length, floatDeployed.length > 0 ? 'text-orange-600' : 'text-gray-400', 'border-l-orange-500'],
              ['Agency', agencyToday.length, agencyToday.length > 0 ? 'text-pink-600' : 'text-gray-400', 'border-l-pink-500'],
              ['Total Staff', staff.filter(s => s.active !== false).length, 'text-gray-700', 'border-l-blue-500'],
            ].map(([label, count, color, accent]) => (
              <div key={label} className={`border rounded-xl p-3 text-center border-l-4 ${accent}`}>
                <div className={`text-2xl font-bold ${color}`}>{count}</div>
                <div className="text-xs text-gray-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {canViewFinance ? (
          <button type="button" className={`${CARD.padded} w-full text-left transition-shadow hover:shadow-md`} onClick={() => navigate('/costs')} aria-label={`Open staffing costs. Current 28-day cycle cost ${formatCurrency(cycleCost)}.`}>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Cost Summary (28-day)</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-600 text-sm">This cycle:</span>
                <span className="text-xl font-bold">£{Math.round(cycleCost).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 text-sm">Monthly projection:</span>
                <span className="font-semibold">£{Math.round(monthlyProj).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 text-sm">Annual projection:</span>
                <span className="font-semibold">£{Math.round(annualProj).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 text-sm">Today's cost:</span>
                <span className="font-semibold">£{todayData.cost.total.toFixed(0)}</span>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <span className="text-gray-600 text-sm">Agency %:</span>
                <span className={agencyPct <= (config.agency_target_pct ?? 0.05) * 100 ? BADGE.green : BADGE.red}>
                  {agencyPct.toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-gray-500">Target: {((config.agency_target_pct ?? 0.05) * 100).toFixed(1)}% or lower.</p>
            </div>
          </button>
        ) : (
          <div className={CARD.padded}>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Cost Summary</h2>
            <p className="text-sm text-gray-400">Ask a finance lead or admin if you need access to staffing costs.</p>
          </div>
        )}

        <div className={`${CARD.padded} lg:col-span-2`}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">28-Day Coverage Heatmap</h2>
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {cycleData.map((d, i) => {
              const isToday = i === todayIdx;
              const dateStr = formatDate(d.date);
              return (
                <button
                  type="button"
                  key={dateStr}
                  onClick={() => navigate(`/day/${dateStr}`)}
                  className={`flex flex-col items-center p-1 rounded-lg transition-all hover:scale-105 ${isToday ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
                  aria-label={`${isToday ? 'Today, ' : ''}${d.date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}: ${getCoverageHealthLabel(d.coverage.overall)}`}
                  title={`${d.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`}
                >
                  <div className="text-[11px] text-gray-400 mb-0.5">Day {i + 1}</div>
                  <div className={`w-8 h-8 rounded-lg ${HEATMAP[d.coverage.overall] || HEATMAP.empty} flex items-center justify-center text-white text-[11px] font-bold shadow-sm`}>
                    {d.date.getUTCDate()}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{d.date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</div>
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5"><span className={`inline-block w-3 h-3 rounded ${HEATMAP.green}`} /> Covered</span>
            <span className="flex items-center gap-1.5"><span className={`inline-block w-3 h-3 rounded ${HEATMAP.amber}`} /> Float or overtime</span>
            <span className="flex items-center gap-1.5"><span className={`inline-block w-3 h-3 rounded ${HEATMAP.yellow}`} /> Agency</span>
            <span className="flex items-center gap-1.5"><span className={`inline-block w-3 h-3 rounded ${HEATMAP.red}`} /> Below minimum</span>
          </div>
        </div>

        {(() => {
          const trainingTypes = getTrainingTypes(config);
          const activeStaff = staff.filter(s => s.active !== false);
          const matrix = buildComplianceMatrix(activeStaff, trainingTypes, training, today);
          const stats = getComplianceStats(matrix);
          const pctColor = stats.compliancePct >= 90 ? 'text-emerald-600' : stats.compliancePct >= 70 ? 'text-amber-600' : 'text-red-600';
          return (
            <button type="button" className={`${CARD.padded} w-full text-left transition-shadow hover:shadow-md`} onClick={() => navigate('/training')} aria-label="Open training compliance">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Training Compliance</h2>
              <div className="flex items-center justify-between mb-3">
                <span className={`text-3xl font-bold ${pctColor}`}>{stats.compliancePct}%</span>
                <span className={stats.compliancePct >= 90 ? BADGE.green : stats.compliancePct >= 70 ? BADGE.amber : BADGE.red}>
                  {stats.compliancePct >= 90 ? 'Compliant' : stats.compliancePct >= 70 ? 'At Risk' : 'Non-Compliant'}
                </span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Compliant</span>
                  <span className="font-semibold text-emerald-600">{stats.compliant}</span>
                </div>
                {stats.expired > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Expired</span>
                    <span className="font-semibold text-red-600">{stats.expired}</span>
                  </div>
                )}
                {stats.expiringSoon > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Expiring Soon</span>
                    <span className="font-semibold text-amber-600">{stats.expiringSoon}</span>
                  </div>
                )}
                {stats.urgent > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Urgent</span>
                    <span className="font-semibold text-red-600">{stats.urgent}</span>
                  </div>
                )}
                {stats.notStarted > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Not Started</span>
                    <span className="font-semibold text-gray-500">{stats.notStarted}</span>
                  </div>
                )}
              </div>
            </button>
          );
        })()}

        {canEdit && (
          <div className={`${CARD.padded} lg:col-span-2`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Action This Week</h2>
              <span className={(summary?.weekActions?.length || 0) > 0 ? BADGE.red : BADGE.gray}>{summary?.weekActions?.length || 0}</span>
            </div>
            {(summary?.weekActions?.length || 0) === 0 ? (
              <p className="text-sm text-gray-500">No actions this week.</p>
            ) : (
              <ul className="space-y-2">
                {summary.weekActions.slice(0, 10).map((action, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${
                      action.priority >= 5 ? 'bg-red-500' :
                      action.priority >= 4 ? 'bg-orange-500' :
                      'bg-amber-500'
                    }`} />
                    <button type="button" className="text-gray-700 hover:text-gray-900 text-left" onClick={() => navigate(action.link)}>
                      {action.message}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className={`${CARD.padded} lg:col-span-2`}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Alerts</h2>
          {alerts.length === 0 ? (
            degradedSources.length > 0 ? (
              <div className="flex items-center gap-2 text-sm text-amber-700 font-medium">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.07 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                No alerts available while some dashboard data is unavailable
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                All clear — full coverage this cycle
              </div>
            )
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {alerts.map((alert, i) => {
                const cls = `flex items-start gap-2 text-xs px-3 py-2 rounded-lg border ${
                  alert.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' :
                  alert.type === 'info' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                  'bg-amber-50 text-amber-700 border-amber-200'
                }`;
                const icon = (
                  <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={
                      alert.type === 'error'
                        ? 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.07 16.5c-.77.833.192 2.5 1.732 2.5z'
                        : 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                    } />
                  </svg>
                );
                return alert.link ? (
                  <button
                    key={i}
                    className={`${cls} cursor-pointer hover:brightness-95 transition-all w-full text-left`}
                    onClick={() => navigate(alert.link)}
                  >
                    {icon}
                    <span>{alert.msg}</span>
                  </button>
                ) : (
                  <div key={i} className={cls}>
                    {icon}
                    <span>{alert.msg}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
