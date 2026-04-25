import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStaffForDay, formatDate, parseDate, addDays, isWorkingShift, isCareRole } from '../lib/rotation.js';
import { getDayCoverageStatus, calculateDayCost, checkFatigueRisk } from '../lib/escalation.js';
import { calculateAccrual } from '../lib/accrual.js';
import { getTrainingTypes, buildComplianceMatrix, getComplianceStats } from '../lib/training.js';
import { getMinimumWageRate } from '../../shared/nmw.js';
import { getHrAlerts } from '../lib/hr.js';
import { getCurrentHome, getSchedulingData, getHrStats, getHrWarnings, getFinanceAlerts, getDashboardSummary } from '../lib/api.js';
import { getFinanceAlertsForDashboard } from '../lib/finance.js';
import { CARD, BADGE, ESC_COLORS, HEATMAP } from '../lib/design.js';
import { useData } from '../contexts/DataContext.jsx';
import { useLiveDate } from '../hooks/useLiveDate.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import OverrideRequestReview from '../components/staff/OverrideRequestReview.jsx';
import { loadAllPayrollRuns } from '../lib/payrollRuns.js';

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

function CoverageGauge({ period, cov }) {
  if (!cov) return null;
  const headPct = cov.coverage.required.heads > 0
    ? Math.min((cov.coverage.headCount / cov.coverage.required.heads) * 100, 100) : 100;
  const skillPct = cov.coverage.required.skill_points > 0
    ? Math.min((cov.coverage.skillPoints / cov.coverage.required.skill_points) * 100, 100) : 100;
  const esc = ESC_COLORS[cov.escalation.color] || ESC_COLORS.green;
  return (
    <div className={`rounded-xl border p-3.5 ${esc.card}`}>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-sm font-semibold capitalize text-[var(--ink)]">{period}</span>
        <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.06em] ${esc.badge}`}>
          {cov.escalation.label}
        </span>
      </div>
      <div className="space-y-2">
        <div>
          <div className="mb-1 flex justify-between text-xs text-[var(--ink-3)]">
            <span>Heads</span>
            <span className="font-mono font-bold">{cov.coverage.headCount}/{cov.coverage.required.heads}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-[var(--paper)]">
            <div className={`h-full rounded-full transition-all duration-300 ${esc.bar}`} style={{ width: `${headPct}%` }} />
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs text-[var(--ink-3)]">
            <span>Skill</span>
            <span className="font-mono font-bold">{cov.coverage.skillPoints.toFixed(1)}/{cov.coverage.required.skill_points}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-[var(--paper)]">
            <div className={`h-full rounded-full transition-all duration-300 ${esc.bar}`} style={{ width: `${skillPct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
const DASHBOARD_HEATMAP_DAY_STYLES = {
  green: 'border-[var(--ok)] bg-[var(--ok-soft)] text-[var(--ok)]',
  amber: 'border-[var(--caution)] bg-[var(--caution-soft)] text-[var(--caution)]',
  yellow: 'border-[var(--warn)] bg-[var(--warn-soft)] text-[var(--warn)]',
  red: 'border-[var(--alert)] bg-[var(--alert-soft)] text-[var(--alert)]',
  empty: 'border-[var(--line)] bg-[var(--paper-2)] text-[var(--ink-3)]',
};

function getCalendarMonthDates(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  const dates = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function getCalendarMonthLabel(date) {
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export default function Dashboard() {
  const { homeRole } = useData();
  const [schedData, setSchedData] = useState(null);
  const [staffRuns, setStaffRuns] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const homeSlug = getCurrentHome();
  const isOwnDataDashboard = homeRole === 'staff_member';

  useEffect(() => {
    let cancelled = false;
    if (!homeSlug) return () => { cancelled = true; };

    async function loadDashboard() {
      setLoading(true);
      setError(null);
      setSchedData(null);
      setStaffRuns([]);
      try {
        const [data, runs] = await Promise.all([
          getSchedulingData(homeSlug),
          isOwnDataDashboard ? loadAllPayrollRuns(homeSlug) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setSchedData(data);
        setStaffRuns(Array.isArray(runs) ? runs : []);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadDashboard();

    return () => { cancelled = true; };
  }, [homeSlug, isOwnDataDashboard, refreshKey]);

  function retryLoad() {
    setError(null);
    setSchedData(null);
    setStaffRuns([]);
    setRefreshKey((current) => current + 1);
  }

  if (!homeSlug) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className={CARD.padded}>
          <h1 className="mb-2 text-lg font-semibold text-[var(--ink)]">Dashboard</h1>
          <p className="text-sm text-[var(--ink-3)]">Select a home to view the dashboard.</p>
        </div>
      </div>
    );
  }

  if (isOwnDataDashboard) {
    if (loading) return <LoadingState message="Loading your staff portal..." className="p-6" card />;
    if (error) return <div className="p-6 max-w-5xl mx-auto"><ErrorState title="Unable to load your staff portal" message={error} onRetry={retryLoad} /></div>;
    if (!schedData?.staff?.length) {
      return (
        <div className="p-6 max-w-5xl mx-auto">
          <EmptyState
            title="Your staff portal is not ready yet"
            description="We couldn't find a linked staff record for this account. Ask a manager to finish your staff link and try again."
          />
        </div>
      );
    }
    return <StaffSelfServiceDashboard schedData={schedData} payrollRuns={staffRuns} />;
  }

  if (loading) return <LoadingState message="Loading dashboard..." className="p-6" card />;
  if (error || !schedData) return <div className="p-6 max-w-5xl mx-auto"><ErrorState title="Unable to load the dashboard" message={error || 'Failed to load scheduling data'} onRetry={retryLoad} /></div>;

  return <DashboardInner schedData={schedData} />;
}

function StaffSelfServiceDashboard({ schedData, payrollRuns }) {
  const navigate = useNavigate();
  const staffMember = schedData.staff?.[0] || null;
  const todayIso = useLiveDate();
  const upcomingShifts = useMemo(() => {
    if (!staffMember) return [];
    const list = [];
    const start = parseDate(todayIso);
    for (let index = 0; index < 7; index += 1) {
      const date = addDays(start, index);
      const [staffForDay] = getStaffForDay(schedData.staff, date, schedData.overrides || {}, schedData.config) || [];
      list.push({
        date: formatDate(date),
        label: date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }),
        shift: staffForDay?.shift || 'OFF',
      });
    }
    return list;
  }, [schedData, staffMember, todayIso]);

  const upcomingLeave = useMemo(() => upcomingShifts.filter(shift => shift.shift === 'AL').length, [upcomingShifts]);
  const nextWorkingShift = upcomingShifts.find(shift => !['OFF', 'AL', 'SICK', 'NS'].includes(shift.shift));
  const recentRuns = payrollRuns.slice(0, 3);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className={`${CARD.padded} border-[var(--accent)] bg-[var(--accent-soft)]`}>
        <h1 className="text-2xl font-bold text-[var(--ink)]">Welcome back, {staffMember?.name || 'team member'}</h1>
        <p className="mt-2 text-sm text-[var(--ink-2)]">
          This is your staff portal. From here you can check your rota, your leave picture, your recent payroll runs, and the latest handover without landing in manager-only tools.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <PortalCard title="My Rota" description="See this month's shifts and quick upcoming days." actionLabel="Open rota" onClick={() => navigate('/rotation')} />
        <PortalCard title="My Leave" description="Check booked leave and your current annual leave balance." actionLabel="Open leave" onClick={() => navigate('/leave')} />
        <PortalCard title="My Payslips" description="Open payroll runs and download your own payslips when they're available." actionLabel="Open payroll" onClick={() => navigate('/payroll')} />
        <PortalCard title="Handover Book" description="Read the latest handover notes for your next shift." actionLabel="Open handover" onClick={() => navigate('/handover')} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className={CARD.padded}>
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-3)]">Next 7 Days</h2>
            {nextWorkingShift && <span className="text-xs font-medium text-[var(--ink-3)]">Next working shift: {nextWorkingShift.label} ({nextWorkingShift.shift})</span>}
          </div>
          <div className="mt-4 divide-y divide-[var(--line)]">
            {upcomingShifts.map(shift => (
              <div key={shift.date} className="flex items-center justify-between py-3 text-sm">
                <span className="font-medium text-[var(--ink)]">{shift.label}</span>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${shift.shift === 'OFF' ? 'border-[var(--line)] bg-[var(--paper-2)] text-[var(--ink-3)]' : shift.shift === 'AL' ? 'border-[var(--caution)] bg-[var(--caution-soft)] text-[var(--caution)]' : ['SICK', 'NS'].includes(shift.shift) ? 'border-[var(--alert)] bg-[var(--alert-soft)] text-[var(--alert)]' : 'border-[var(--info)] bg-[var(--info-soft)] text-[var(--info)]'}`}>
                  {shift.shift}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className={CARD.padded}>
            <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-3)]">Quick Snapshot</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <MetricCard label="Upcoming leave days" value={String(upcomingLeave)} />
              <MetricCard label="Recent payroll runs" value={String(payrollRuns.length)} />
            </div>
          </div>
          <div className={CARD.padded}>
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-3)]">Recent Payroll Runs</h2>
              <button type="button" className="text-xs font-medium text-[var(--accent)] hover:brightness-95" onClick={() => navigate('/payroll')}>View all</button>
            </div>
            {recentRuns.length === 0 ? (
              <EmptyState compact title="No payroll runs yet" description="Your payslips will appear here once the next payroll run is processed." />
            ) : (
              <div className="mt-3 space-y-2">
                {recentRuns.map(run => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => navigate(`/payroll/${run.id}`)}
                    className="flex w-full items-center justify-between rounded-xl border border-[var(--line)] px-3 py-3 text-left transition hover:border-[var(--line-2)] hover:bg-[var(--paper-2)]"
                  >
                    <div>
                      <p className="text-sm font-semibold text-[var(--ink)]">{run.period_start} to {run.period_end}</p>
                      <p className="text-xs text-[var(--ink-3)]">{run.status}</p>
                    </div>
                    <span className="text-xs font-medium text-[var(--accent)]">Open</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PortalCard({ title, description, actionLabel, onClick }) {
  return (
    <div className={CARD.padded}>
      <h2 className="text-lg font-semibold text-[var(--ink)]">{title}</h2>
      <p className="mt-2 text-sm text-[var(--ink-2)]">{description}</p>
      <button type="button" className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-ink)] transition hover:brightness-95" onClick={onClick}>
        {actionLabel}
      </button>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-2)] px-3 py-3">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--ink-3)]">{label}</p>
      <p className="mt-2 text-2xl font-bold text-[var(--ink)]">{value}</p>
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
  const canViewCompliance = canRead('compliance');
  const navigate = useNavigate();

  const todayIso = useLiveDate();
  const today = useMemo(() => parseDate(todayIso), [todayIso]);

  const [hrData, setHrData] = useState({ stats: null, warnings: [] });
  const [financeAlerts, setFinanceAlerts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [auxLoading, setAuxLoading] = useState(true);
  const [auxFailures, setAuxFailures] = useState([]);
  const home = getCurrentHome();

  useEffect(() => {
    if (!home) return;

    let cancelled = false;
    async function loadAuxData() {
      setHrData({ stats: null, warnings: [] });
      setFinanceAlerts([]);
      setSummary(null);
      setAuxLoading(true);
      setAuxFailures([]);

      const [statsResult, warningsResult, financeResult, summaryResult] = await Promise.all([
        canViewHr ? getHrStats(home) : Promise.resolve(null),
        canViewHr ? getHrWarnings(home) : Promise.resolve([]),
        canViewFinance ? getFinanceAlerts(home) : Promise.resolve([]),
        getDashboardSummary(home),
      ].map(p => Promise.resolve(p).then(
        value => ({ ok: true, value }),
        error => ({ ok: false, error }),
      )));

      if (cancelled) return;

      const failures = [];

      if (statsResult.ok) {
        setHrData(current => ({ ...current, stats: statsResult.value }));
      } else {
        console.warn('Failed to load HR stats:', statsResult.error?.message);
        failures.push('HR stats');
      }

      if (warningsResult.ok) {
        setHrData(current => ({ ...current, warnings: Array.isArray(warningsResult.value) ? warningsResult.value : [] }));
      } else {
        console.warn('Failed to load HR warnings:', warningsResult.error?.message);
        failures.push('HR warnings');
      }

      if (financeResult.ok) {
        setFinanceAlerts(Array.isArray(financeResult.value) ? financeResult.value : []);
      } else {
        console.warn('Failed to load finance alerts:', financeResult.error?.message);
        failures.push('Finance alerts');
      }

      if (summaryResult.ok) {
        setSummary(summaryResult.value);
      } else {
        console.warn('Failed to load dashboard summary:', summaryResult.error?.message);
        failures.push('Dashboard summary');
      }

      setAuxFailures(failures);
      setAuxLoading(false);
    }

    void loadAuxData();

    return () => { cancelled = true; };
  }, [home, canViewFinance, canViewHr]);

  const degradedSources = useMemo(() => {
    const sources = [...auxFailures];
    if (summary?._degraded && summary._failedModules?.length) {
      sources.push(`Summary modules: ${summary._failedModules.join(', ')}`);
    }
    return [...new Set(sources)];
  }, [auxFailures, summary]);

  const monthDates = useMemo(() => getCalendarMonthDates(today), [today]);
  const monthLabel = useMemo(() => getCalendarMonthLabel(today), [today]);

  const cycleData = useMemo(() => {
    return monthDates.map(date => {
      const staffForDay = getStaffForDay(staff, date, overrides, config);
      const coverage = getDayCoverageStatus(staffForDay, config);
      const cost = calculateDayCost(staffForDay, config);
      return { date, staffForDay, coverage, cost };
    });
  }, [staff, overrides, config, monthDates]);

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
  const activeStaffCount = staff.filter(s => s.active !== false).length;

  const periodDays = cycleData.length || 1;
  const periodCost = useMemo(() => cycleData.reduce((s, d) => s + d.cost.total, 0), [cycleData]);
  const dailyAvg = periodCost / periodDays;
  const annualProj = dailyAvg * 365;
  const agencyTotal = cycleData.reduce((s, d) => s + d.cost.agency, 0);
  const agencyPct = periodCost > 0 ? (agencyTotal / periodCost) * 100 : 0;

  const alerts = (() => {
    const list = [];
    const hourAdjustments = schedData?.hour_adjustments || {};

    cycleData.forEach(d => {
      const dateLabel = d.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
      ['early', 'late', 'night'].forEach(period => {
        const esc = d.coverage[period]?.escalation;
        if (!esc) return;
        if (esc.level >= 4) list.push(withPriority({ type: 'error', msg: `${dateLabel}: ${period} - ${esc.status}` }, 4));
        else if (esc.level >= 3) list.push(withPriority({ type: 'warning', msg: `${dateLabel}: ${period} - ${esc.status}` }, 3));
      });
    });

    const activeCareStaff = staff.filter(s => s.active !== false && isCareRole(s.role));

    activeCareStaff.forEach((s, idx) => {
      const fatigue = checkFatigueRisk(s, today, overrides, config);
      const label = canEdit ? s.name : `Staff Member ${idx + 1}`;
      if (fatigue.exceeded) {
        list.push(withPriority({ type: 'error', msg: `${label}: ${fatigue.consecutive} consecutive days (max ${config.max_consecutive_days})` }, 4));
      } else if (fatigue.atRisk) {
        list.push(withPriority({ type: 'warning', msg: `${label}: ${fatigue.consecutive} consecutive days - at limit` }, 3));
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
      const acc = calculateAccrual(s, config, overrides, today, hourAdjustments);
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
  })();
  const highPriorityActions = Array.isArray(summary?.highPriorityActions)
    ? summary.highPriorityActions
    : (summary?.weekActions || []);

  const overallStatus = todayData.coverage.overallLevel <= 1
    ? { label: 'ALL CLEAR', badge: BADGE.green, hero: 'Covered and calm' }
    : todayData.coverage.overallLevel <= 2
      ? { label: 'MONITOR', badge: BADGE.amber, hero: 'Covered, with one thing to watch' }
      : todayData.coverage.overallLevel <= 3
        ? { label: 'ACTION NEEDED', badge: BADGE.orange, hero: 'Coverage needs manager action' }
        : { label: 'CRITICAL', badge: BADGE.red, hero: 'Critical cover gap' };
  const todayLabel = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const nextChangeLabel = addDays(today, 1).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <div className="mx-auto max-w-[1500px] p-5 lg:p-7">
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{config.home_name} - Dashboard</h1>
        <p className="text-xs text-[var(--ink-3)]">Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className="mb-5 flex flex-col gap-5 rounded-2xl border border-[var(--accent)] bg-[var(--accent)] p-5 text-[var(--accent-ink)] shadow-[0_18px_42px_-30px_rgba(20,20,40,0.55)] lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] opacity-80">{config.home_name} - {config.registered_beds} beds - {config.care_type}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{config.home_name}</h1>
          <p className="mt-1 text-sm font-semibold opacity-90">{overallStatus.hero}</p>
          <p className="mt-2 text-sm opacity-85">Panama rotation - next rota change {nextChangeLabel}</p>
        </div>
        <div className="flex flex-col gap-3 text-left lg:items-end lg:text-right">
          <div>
            <div className="text-2xl font-semibold tracking-tight">{todayLabel}</div>
            <div className="mt-1 text-xs opacity-80">{monthLabel} operating view</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {degradedSources.length > 0 && (
              <span className="inline-flex items-center gap-2 rounded-full border border-white/35 bg-white/15 px-3 py-1 font-mono text-[11px] font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--warn)]" />
                Partial data
              </span>
            )}
            <button type="button" onClick={() => window.print()} className="rounded-lg border border-white/35 bg-white/10 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/20 print:hidden">Print</button>
          </div>
        </div>
      </div>

      {degradedSources.length > 0 && (
        <div className="mb-5 rounded-lg border border-[var(--warn)] bg-[var(--warn-soft)] px-4 py-2 text-sm text-[var(--warn)]">
          Some dashboard data could not be loaded ({degradedSources.join('; ')}). Alerts and counts may be incomplete.
        </div>
      )}

      {/* Pending staff leave requests - surface here so managers act on them
          before falling through to general alerts. Component handles its own
          empty/loading state and only renders if user has scheduling write. */}
      {canEdit && (
        <div className="mb-5">
          <OverrideRequestReview />
        </div>
      )}

      <button
        type="button"
        className={`${CARD.padded} mb-6 w-full text-left transition hover:border-[var(--line-2)] hover:shadow-md`}
        onClick={() => navigate(`/day/${formatDate(today)}`)}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Today's Coverage - Live Status</h2>
          <span className={overallStatus.badge}>{overallStatus.label}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <CoverageGauge period="early" cov={todayData.coverage.early} />
          <CoverageGauge period="late" cov={todayData.coverage.late} />
          <CoverageGauge period="night" cov={todayData.coverage.night} />
        </div>
      </button>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
        <div className={CARD.padded}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Staffing Summary</h2>
            <span className="text-xs text-[var(--ink-4)]">of {activeStaffCount} active</span>
          </div>
          {activeStaffCount === 0 ? (
            <div className="rounded-xl border border-[var(--info)] bg-[var(--info-soft)] px-4 py-3 text-sm text-[var(--info)]">
              No active staff are set up for this home yet.
              <button type="button" onClick={() => navigate('/staff')} className="ml-2 font-semibold underline underline-offset-2">
                Open Staff Register
              </button>
            </div>
          ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ['On Duty', onDuty.length, 'text-[var(--ok)]', 'border-[var(--ok)]'],
              ['Sick', sick.length, sick.length > 0 ? 'text-[var(--alert)]' : 'text-[var(--ink-4)]', 'border-[var(--alert)]'],
              ['Annual Leave', al.length, al.length > 0 ? 'text-[var(--warn)]' : 'text-[var(--ink-4)]', 'border-[var(--warn)]'],
              ['Float Deployed', floatDeployed.length, floatDeployed.length > 0 ? 'text-[var(--caution)]' : 'text-[var(--ink-4)]', 'border-[var(--caution)]'],
              ['Agency', agencyToday.length, agencyToday.length > 0 ? 'text-[var(--alert)]' : 'text-[var(--ink-4)]', 'border-[var(--alert)]'],
              ['Total Staff', activeStaffCount, 'text-[var(--ink)]', 'border-[var(--accent)]'],
            ].map(([label, count, color, accent]) => (
              <div key={label} className={`rounded-xl border border-[var(--line)] border-l-4 bg-[var(--paper)] p-3 text-center ${accent}`}>
                <div className={`text-2xl font-bold ${color}`}>{count}</div>
                <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ink-3)]">{label}</div>
              </div>
            ))}
          </div>
          )}
        </div>

        {canViewFinance ? (
          <button
            type="button"
            className={`${CARD.padded} w-full text-left transition hover:border-[var(--line-2)] hover:shadow-md`}
            onClick={() => navigate('/costs')}
          >
            <h2 className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Cost Summary ({monthLabel})</h2>
            <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--paper-2)] px-4 py-3 text-sm text-[var(--ink-2)]">
              <b className={agencyPct > (config.agency_target_pct ?? 0.05) * 100 ? 'text-[var(--warn)]' : 'text-[var(--ok)]'}>
                £{Math.round(agencyTotal).toLocaleString()} agency
              </b>{' '}
              this month, {agencyPct.toFixed(1)}% of spend.
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--ink-2)]">This month:</span>
                <span className="text-xl font-bold text-[var(--ink)]">£{Math.round(periodCost).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--ink-2)]">Daily avg:</span>
                <span className="font-semibold text-[var(--ink)]">£{Math.round(dailyAvg).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--ink-2)]">Annual proj:</span>
                <span className="font-semibold text-[var(--ink)]">£{Math.round(annualProj).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--ink-2)]">Today's cost:</span>
                <span className="font-semibold text-[var(--ink)]">£{todayData.cost.total.toFixed(0)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-[var(--line)] pt-3">
                <span className="text-sm text-[var(--ink-2)]">Agency %:</span>
                <span className={agencyPct <= (config.agency_target_pct ?? 0.05) * 100 ? BADGE.green : BADGE.red}>
                  {agencyPct.toFixed(1)}%
                </span>
              </div>
            </div>
          </button>
        ) : (
          <div className={CARD.padded}>
            <h2 className="mb-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Cost Summary</h2>
            <p className="text-sm text-[var(--ink-2)]">Admin access required</p>
          </div>
        )}

        <div className={`${CARD.padded} lg:col-span-2`}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">{monthLabel} Coverage Heatmap</h2>
            <div className="flex flex-wrap gap-4 text-[10px] text-[var(--ink-3)]">
              <span className="flex items-center gap-1.5"><span className={`inline-block h-3 w-3 rounded ${HEATMAP.green}`} /> Covered</span>
              <span className="flex items-center gap-1.5"><span className={`inline-block h-3 w-3 rounded ${HEATMAP.amber}`} /> Float/OT</span>
              <span className="flex items-center gap-1.5"><span className={`inline-block h-3 w-3 rounded ${HEATMAP.yellow}`} /> Agency</span>
              <span className="flex items-center gap-1.5"><span className={`inline-block h-3 w-3 rounded ${HEATMAP.red}`} /> Short/Unsafe</span>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-[repeat(14,minmax(0,1fr))] lg:grid-cols-[repeat(auto-fit,minmax(34px,1fr))]">
            {cycleData.map((d, i) => {
              const isToday = i === todayIdx;
              const dateStr = formatDate(d.date);
              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => navigate(`/day/${dateStr}`)}
                  className={`flex min-h-14 flex-col items-center justify-center rounded-lg border p-1 transition hover:-translate-y-0.5 hover:shadow-sm ${isToday ? 'ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--paper)]' : ''} ${DASHBOARD_HEATMAP_DAY_STYLES[d.coverage.overall] || DASHBOARD_HEATMAP_DAY_STYLES.empty}`}
                  title={`${d.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`}
                >
                  <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-[var(--ink-4)]">D{i + 1}</span>
                  <span className="mt-0.5 font-mono text-xs font-bold">{d.date.getUTCDate()}</span>
                  <span className="mt-0.5 text-[9px] text-[var(--ink-4)]">{d.date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
                </button>
              );
            })}
          </div>
        </div>

        {canViewCompliance ? (() => {
          const trainingTypes = getTrainingTypes(config);
          const activeStaff = staff.filter(s => s.active !== false);
          const matrix = buildComplianceMatrix(activeStaff, trainingTypes, training, today);
          const stats = getComplianceStats(matrix);
          const pctColor = stats.compliancePct >= 90 ? 'text-[var(--ok)]' : stats.compliancePct >= 70 ? 'text-[var(--caution)]' : 'text-[var(--alert)]';
          const strokeColor = stats.compliancePct >= 90 ? 'var(--ok)' : stats.compliancePct >= 70 ? 'var(--caution)' : 'var(--alert)';
          const circumference = 2 * Math.PI * 36;
          return (
            <button
              type="button"
              className={`${CARD.padded} w-full text-left transition hover:border-[var(--line-2)] hover:shadow-md lg:col-span-2`}
              onClick={() => navigate('/training')}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Training Compliance</h2>
                <span className={stats.compliancePct >= 90 ? BADGE.green : stats.compliancePct >= 70 ? BADGE.amber : BADGE.red}>
                  {stats.compliancePct >= 90 ? 'Compliant' : stats.compliancePct >= 70 ? 'At Risk' : 'Non-Compliant'}
                </span>
              </div>
              <div className="grid gap-5 md:grid-cols-[110px_1fr] md:items-center">
                <div className="relative h-24 w-24">
                  <svg width="96" height="96" viewBox="0 0 88 88" aria-hidden="true">
                    <circle cx="44" cy="44" r="36" fill="none" stroke="var(--line)" strokeWidth="8" />
                    <circle
                      cx="44"
                      cy="44"
                      r="36"
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth="8"
                      strokeDasharray={circumference}
                      strokeDashoffset={circumference * (1 - stats.compliancePct / 100)}
                      transform="rotate(-90 44 44)"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-2xl font-bold ${pctColor}`}>{stats.compliancePct}%</span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--ink-4)]">trained</span>
                  </div>
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="flex justify-between rounded-lg border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2">
                  <span className="text-[var(--ink-2)]">Compliant</span>
                  <span className="font-semibold text-[var(--ok)]">{stats.compliant}</span>
                </div>
                {stats.expired > 0 && (
                  <div className="flex justify-between rounded-lg border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2">
                    <span className="text-[var(--ink-2)]">Expired</span>
                    <span className="font-semibold text-[var(--alert)]">{stats.expired}</span>
                  </div>
                )}
                {stats.expiringSoon > 0 && (
                  <div className="flex justify-between rounded-lg border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2">
                    <span className="text-[var(--ink-2)]">Expiring Soon</span>
                    <span className="font-semibold text-[var(--caution)]">{stats.expiringSoon}</span>
                  </div>
                )}
                {stats.urgent > 0 && (
                  <div className="flex justify-between rounded-lg border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2">
                    <span className="text-[var(--ink-2)]">Urgent</span>
                    <span className="font-semibold text-[var(--alert)]">{stats.urgent}</span>
                  </div>
                )}
                {stats.notStarted > 0 && (
                  <div className="flex justify-between rounded-lg border border-[var(--line)] bg-[var(--paper-2)] px-3 py-2">
                    <span className="text-[var(--ink-2)]">Not Started</span>
                    <span className="font-semibold text-[var(--ink-3)]">{stats.notStarted}</span>
                  </div>
                )}
                </div>
              </div>
            </button>
          );
        })() : (
          <div className={`${CARD.padded} lg:col-span-2`}>
            <h2 className="mb-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Training Compliance</h2>
            <p className="text-sm text-[var(--ink-2)]">Compliance access required</p>
          </div>
        )}
          </div>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-28 xl:self-start">
        {canEdit && highPriorityActions.length > 0 && (
          <div className={CARD.padded}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">High Priority Actions</h2>
              <span className={BADGE.red}>{highPriorityActions.length}</span>
            </div>
            <ul className="space-y-2">
              {highPriorityActions.slice(0, 10).map((action, i) => (
                <li key={i} className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm">
                  <button type="button" className="flex w-full items-start gap-2 text-left text-[var(--ink-2)] hover:text-[var(--ink)]" onClick={() => navigate(action.link)}>
                    <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                      action.priority >= 5 ? 'bg-[var(--alert)]' :
                      action.priority >= 4 ? 'bg-[var(--warn)]' :
                      'bg-[var(--caution)]'
                    }`} />
                    <span>{action.message}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={CARD.padded}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Alerts</h2>
            {alerts.length > 0 && <span className={BADGE.gray}>{alerts.length} shown</span>}
          </div>
          {alerts.length === 0 ? (
            auxLoading ? (
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--info)]">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Loading compliance alerts...
              </div>
            ) :
            degradedSources.length > 0 ? (
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--warn)]">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.07 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                No alerts available while some dashboard data is unavailable
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--ok)]">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                All clear - full coverage this month
              </div>
            )
          ) : (
            <div className="space-y-2">
              {alerts.map((alert, i) => {
                const cls = `flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs ${
                  alert.type === 'error' ? 'border-[var(--alert)] bg-[var(--alert-soft)] text-[var(--alert)]' :
                  alert.type === 'info' ? 'border-[var(--info)] bg-[var(--info-soft)] text-[var(--info)]' :
                  'border-[var(--warn)] bg-[var(--warn-soft)] text-[var(--warn)]'
                }`;
                const icon = (
                  <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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
                    type="button"
                    className={`${cls} transition hover:brightness-95`}
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
        </aside>
      </div>
    </div>
  );
}
