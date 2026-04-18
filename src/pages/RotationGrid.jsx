import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  getStaffForDay, formatDate, getActualShift, getCycleDay,
  getScheduledShift, isCareRole, isAgencyShift, isOTShift,
  calculateStaffPeriodHours, getShiftHours, SHIFT_COLORS, WORKING_SHIFTS,
} from '../lib/rotation.js';
import { calculateDayCost, getDayCoverageStatus, checkFatigueRisk } from '../lib/escalation.js';
import { clickableRowProps } from '../lib/a11y.js';
import { CARD, TABLE, INPUT, BTN, BADGE, PAGE } from '../lib/design.js';
import { getOnboardingBlockingReasons } from '../lib/onboarding.js';
import { getTrainingBlockingReasons } from '../lib/training.js';
import {
  getCurrentHome,
  getSchedulingData,
  upsertOverride,
  deleteOverride,
  bulkUpsertOverrides,
  revertMonthOverrides,
} from '../lib/api.js';
import { useData } from '../contexts/DataContext.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import { todayLocalISO } from '../lib/localDates.js';
import { useConfirm } from '../hooks/useConfirm.jsx';
import useSchedulingEditLock from '../hooks/useSchedulingEditLock.js';
import RotationGridModals from '../components/scheduling/RotationGridModals.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';

/** Resolve staff ID → two-char initials for compact grid display. */
function getInitials(staffMap, staffId) {
  const name = staffMap.get(staffId)?.name;
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '??';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const TEAMS = ['Day A', 'Day B', 'Night A', 'Night B', 'Float'];

function downloadCSV(filename, headers, rows) {
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function getMonthDates(year, month) {
  const dates = [];
  const d = new Date(Date.UTC(year, month, 1));
  while (d.getUTCMonth() === month) {
    dates.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function getMonthSchedulingRange(monthDates, radiusDays = 200) {
  const anchor = monthDates[Math.floor(monthDates.length / 2)] || new Date();
  return {
    from: formatDate(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - radiusDays))),
    to: formatDate(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() + radiusDays))),
  };
}

export default function RotationGrid() {
  const { canWrite, homeRole } = useData();
  const canEdit = canWrite('scheduling');
  const { confirm, ConfirmDialog } = useConfirm();
  const [schedData, setSchedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [overrideWarnings, setOverrideWarnings] = useState([]);

  const [filterTeam, setFilterTeam] = useState('All');
  const [editing, setEditing] = useState(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [bulkModal, setBulkModal] = useState(null);
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  const homeSlug = getCurrentHome();
  const isOwnDataRoster = homeRole === 'staff_member';
  useDirtyGuard(!!editing || !!bulkModal);

  // Dynamic calendar month dates
  const { monthDates, monthLabel } = useMemo(() => {
    const now = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1));
    const dates = getMonthDates(target.getUTCFullYear(), target.getUTCMonth());
    const label = target.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return { monthDates: dates, monthLabel: label };
  }, [monthOffset]);

  const loadData = useCallback(async () => {
    if (!homeSlug) {
      setSchedData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const { from, to } = getMonthSchedulingRange(monthDates);
    setLoading(true);
    setError(null);
    try {
      setSchedData(await getSchedulingData(homeSlug, { from, to }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug, monthDates]);

  useEffect(() => { loadData(); }, [loadData]);

  const activeStaff = useMemo(() => {
    if (!schedData) return [];
    let list = schedData.staff.filter(s => s.active !== false && isCareRole(s.role));
    if (filterTeam !== 'All') list = list.filter(s => s.team === filterTeam);
    const teamOrder = { 'Day A': 0, 'Day B': 1, 'Night A': 2, 'Night B': 3, 'Float': 4 };
    list.sort((a, b) => (teamOrder[a.team] ?? 9) - (teamOrder[b.team] ?? 9) || a.name.localeCompare(b.name));
    return list;
  }, [schedData, filterTeam]);

  // O(1) lookup for ALL staff — cover arrows need to resolve IDs for staff
  // on other teams (filtered out), agency virtual staff, or leavers.
  const staffMap = useMemo(() => {
    const m = new Map();
    schedData?.staff?.forEach(s => m.set(s.id, s));
    return m;
  }, [schedData?.staff]);

  const staffStats = useMemo(() => {
    if (!schedData) return {};
    const map = {};
    activeStaff.forEach(s => {
      map[s.id] = calculateStaffPeriodHours(s, monthDates, schedData.overrides, schedData.config);
    });
    return map;
  }, [activeStaff, monthDates, schedData]);

  // Reverse lookup: given an absent person + date, who covered them?
  // Array values support split cover (e.g. agency covers Early, Dave covers Late).
  const coverMap = useMemo(() => {
    const map = {};
    if (!schedData?.overrides) return map;
    for (const [dateStr, dayOverrides] of Object.entries(schedData.overrides)) {
      for (const [staffId, override] of Object.entries(dayOverrides)) {
        if (override.replaces_staff_id) {
          if (!map[dateStr]) map[dateStr] = {};
          if (!map[dateStr][override.replaces_staff_id]) {
            map[dateStr][override.replaces_staff_id] = [];
          }
          map[dateStr][override.replaces_staff_id].push({
            coveredBy: staffId,
            shift: override.shift,
          });
        }
      }
    }
    return map;
  }, [schedData?.overrides]);

  // Per-day absence & cover summaries for the summary rows
  const daySummaries = useMemo(() => {
    if (!schedData) return {};
    const map = {};
    const staffById = {};
    schedData.staff.forEach(s => { staffById[s.id] = s; });

    monthDates.forEach(date => {
      const dateKey = formatDate(date);
      const staffForDay = getStaffForDay(schedData.staff, date, schedData.overrides, schedData.config);
      const absences = [];
      const covers = [];

      staffForDay.forEach(s => {
        if (s.shift === 'AL' || s.shift === 'SICK') {
          absences.push({ id: s.id, name: s.name, shift: s.shift });
        }
        if (s.replaces_staff_id) {
          const replaced = staffById[s.replaces_staff_id];
          covers.push({
            id: s.id, name: s.name, shift: s.shift,
            replacesId: s.replaces_staff_id,
            replacesName: replaced?.name || s.replaces_staff_id,
          });
        }
      });

      map[dateKey] = { absences, covers };
    });
    return map;
  }, [schedData, monthDates]);

  // Impact preview
  const impact = useMemo(() => {
    if (!schedData || !editing || !editing.proposedShift) return null;
    const { staffId, dateStr, currentShift, proposedShift } = editing;
    if (proposedShift === currentShift) return null;

    const staff = schedData.staff.find(s => s.id === staffId);
    if (!staff) return null;

    const date = parseLocalDate(dateStr);

    const staffForDayBefore = getStaffForDay(schedData.staff, date, schedData.overrides, schedData.config);
    const coverageBefore = getDayCoverageStatus(staffForDayBefore, schedData.config);
    const costBefore = calculateDayCost(staffForDayBefore, schedData.config);
    const statsBefore = calculateStaffPeriodHours(staff, monthDates, schedData.overrides, schedData.config);
    const fatigueBefore = checkFatigueRisk(staff, date, schedData.overrides, schedData.config);

    const simOverrides = { ...schedData.overrides };
    if (simOverrides[dateStr]) simOverrides[dateStr] = { ...simOverrides[dateStr] };
    const scheduled = getScheduledShift(staff, getCycleDay(date, schedData.config.cycle_start_date), date);
    if (proposedShift === scheduled) {
      if (simOverrides[dateStr]) {
        delete simOverrides[dateStr][staffId];
        if (Object.keys(simOverrides[dateStr]).length === 0) delete simOverrides[dateStr];
      }
    } else {
      if (!simOverrides[dateStr]) simOverrides[dateStr] = {};
      simOverrides[dateStr][staffId] = { shift: proposedShift, reason: 'Manual edit' };
    }

    const staffForDayAfter = getStaffForDay(schedData.staff, date, simOverrides, schedData.config);
    const coverageAfter = getDayCoverageStatus(staffForDayAfter, schedData.config);
    const costAfter = calculateDayCost(staffForDayAfter, schedData.config);
    const statsAfter = calculateStaffPeriodHours(staff, monthDates, simOverrides, schedData.config);
    const fatigueAfter = checkFatigueRisk(staff, date, simOverrides, schedData.config);

    const wtrBefore = statsBefore.wtrStatus;
    const wtrAfter = statsAfter.wtrStatus;

    const warnings = [];
    const errors = [];

    ['early', 'late', 'night'].forEach(period => {
      const before = coverageBefore[period];
      const after = coverageAfter[period];
      if (!before || !after) return;
      if (after.coverage.headCount < before.coverage.headCount) {
        const msg = `${period} heads: ${before.coverage.headCount} → ${after.coverage.headCount}`;
        if (after.coverage.headCount < after.coverage.required.heads) errors.push(msg + ` (below min ${after.coverage.required.heads})`);
        else warnings.push(msg);
      }
      if (after.coverage.skillPoints < before.coverage.skillPoints) {
        const msg = `${period} skill: ${before.coverage.skillPoints.toFixed(1)} → ${after.coverage.skillPoints.toFixed(1)}`;
        if (after.coverage.skillPoints < after.coverage.required.skill_points) errors.push(msg + ` (below min ${after.coverage.required.skill_points})`);
        else warnings.push(msg);
      }
      if (after.escalation.level > before.escalation.level) {
        warnings.push(`${period} escalation: ${before.escalation.status} → ${after.escalation.status}`);
      }
    });

    if (wtrAfter === 'BREACH' && wtrBefore !== 'BREACH') {
      if (staff.wtr_opt_out) {
        warnings.push(`WTR: avg ${statsAfter.avgWeeklyHours.toFixed(1)} hrs/wk (opted out)`);
      } else {
        errors.push(`WTR BREACH: avg ${statsAfter.avgWeeklyHours.toFixed(1)} hrs/wk (max 48)`);
      }
    } else if (wtrAfter === 'HIGH' && wtrBefore !== 'HIGH') {
      warnings.push(`WTR HIGH: avg ${statsAfter.avgWeeklyHours.toFixed(1)} hrs/wk`);
    }

    if (fatigueAfter.exceeded && !fatigueBefore.exceeded) {
      errors.push(`Fatigue: ${fatigueAfter.consecutive} consecutive days (max ${schedData.config.max_consecutive_days})`);
    } else if (fatigueAfter.atRisk && !fatigueBefore.atRisk) {
      warnings.push(`Fatigue risk: ${fatigueAfter.consecutive} consecutive days`);
    }

    const costDelta = costAfter.total - costBefore.total;
    const approved = errors.length === 0;

    return {
      staff, date, dateStr,
      currentShift, proposedShift,
      coverageBefore, coverageAfter,
      costBefore, costAfter, costDelta,
      statsBefore, statsAfter,
      fatigueBefore, fatigueAfter,
      wtrBefore, wtrAfter,
      warnings, errors, approved,
    };
  }, [editing, schedData, monthDates]);

  const today = todayLocalISO();
  const hasEditLock = Boolean(schedData?.config?.edit_lock_enabled);
  const {
    showLockPrompt,
    lockPin,
    lockError,
    updateLockPin,
    dismissLockPrompt,
    attemptUnlock,
    getEditLockOptions,
    requestUnlock,
    handleLockedError,
  } = useSchedulingEditLock({ homeSlug, hasEditLock, today });

  function openEditor(staffId, dateStr) {
    requestUnlock(dateStr, () => {
      const existingOverride = schedData.overrides[dateStr]?.[staffId];
      const actual = existingOverride?.shift;
      const staff = schedData.staff.find(s => s.id === staffId);
      const date = parseLocalDate(dateStr);
      const cycleDay = getCycleDay(date, schedData.config.cycle_start_date);
      const scheduled = getScheduledShift(staff, cycleDay, date);
      const currentShift = actual || scheduled;
      setEditing({
        staffId, dateStr, currentShift, proposedShift: currentShift,
        replacesStaffId: existingOverride?.replaces_staff_id || null,
      });
    });
  }

  async function applyChange() {
    if (!editing || !editing.proposedShift) return;
    const { staffId, dateStr, proposedShift } = editing;
    const staff = schedData.staff.find(s => s.id === staffId);
    const date = parseLocalDate(dateStr);
    const scheduled = getScheduledShift(staff, getCycleDay(date, schedData.config.cycle_start_date), date);

    // Guard: only persist cover link for OC/AG shifts.
    // Without this, changing from OC-EL → E could save a stale replaces_staff_id
    // because not all editor mutation paths clear it (e.g. "Revert to Scheduled").
    const replacesId = editing.replacesStaffId
      && (isOTShift(proposedShift) || isAgencyShift(proposedShift))
      ? editing.replacesStaffId : undefined;

    setSaving(true);
    setOverrideWarnings([]);
    try {
      if (proposedShift === scheduled) {
        await deleteOverride(getCurrentHome(), dateStr, staffId, getEditLockOptions(dateStr));
      } else {
        const result = await upsertOverride(
          getCurrentHome(),
          {
            date: dateStr, staffId, shift: proposedShift,
            reason: 'Manual edit', source: 'manual',
            ...(replacesId && { replaces_staff_id: replacesId }),
          },
          getEditLockOptions(dateStr),
        );
        if (result?.warnings?.length) setOverrideWarnings(result.warnings);
      }
      await loadData();
    } catch (e) {
      if (e.status === 423) {
        handleLockedError(dateStr, () => openEditor(staffId, dateStr));
        return;
      }
      setError(e.message);
    } finally {
      setSaving(false);
    }
    setEditing(null);
  }

  async function bulkSickWeek(staffId, startDateStr) {
    const staff = schedData.staff.find(s => s.id === staffId);
    if (!staff) return;
    const sickRows = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(parseLocalDate(startDateStr));
      d.setUTCDate(d.getUTCDate() + i);
      const dk = formatDate(d);
      const cycleDay = getCycleDay(d, schedData.config.cycle_start_date);
      const sched = getScheduledShift(staff, cycleDay, d);
      if (sched !== 'OFF') {
        sickRows.push({ date: dk, staffId, shift: 'SICK', reason: 'Sick (bulk)', source: 'manual' });
      }
    }
    if (sickRows.length === 0) { setBulkModal(null); return; }
    setSaving(true);
    setOverrideWarnings([]);
    try {
      const result = await bulkUpsertOverrides(getCurrentHome(), sickRows, getEditLockOptions(sickRows.map(row => row.date)));
      if (result?.warnings?.length) setOverrideWarnings(result.warnings);
      await loadData();
    } catch (e) {
      if (e.status === 423) {
        handleLockedError(sickRows.map(row => row.date), () => bulkSickWeek(staffId, startDateStr));
        return;
      }
      setError(e.message);
    } finally {
      setSaving(false);
    }
    setBulkModal(null);
  }

  async function revertAllOverrides() {
    if (!await confirm(`Revert ALL overrides for ${monthLabel}? This cannot be undone.`)) return;
    const firstOfMonth = formatDate(monthDates[0]);
    const lastOfMonth = formatDate(monthDates[monthDates.length - 1]);
    setSaving(true);
    try {
      await revertMonthOverrides(getCurrentHome(), firstOfMonth, lastOfMonth, getEditLockOptions(firstOfMonth));
      await loadData();
    } catch (e) {
      if (e.status === 423) {
        handleLockedError(firstOfMonth, () => setBulkModal({ type: 'revert-all' }));
        return;
      }
      setError(e.message);
    } finally {
      setSaving(false);
    }
    setBulkModal(null);
  }

  function exportCSV() {
    if (!schedData) return;
    const headers = ['ID', 'Name', 'Team', 'Role', 'Pref',
      ...monthDates.map(d => formatDate(d)),
      'Hours', 'Pay £', 'OT Hrs', 'WTR'];
    const rows = activeStaff.map(s => {
      const stats = staffStats[s.id];
      return [
        s.id, s.name, s.team, s.role, s.pref,
        ...monthDates.map(d => {
          const actual = getActualShift(s, d, schedData.overrides, schedData.config.cycle_start_date);
          return actual.shift;
        }),
        stats?.paidHours.toFixed(1) ?? '',
        stats?.totalPay.toFixed(0) ?? '',
        stats?.otHours > 0 ? stats.otHours.toFixed(1) : '0',
        stats?.wtrStatus ?? '',
      ];
    });
    downloadCSV(`roster_${monthLabel.replace(' ', '_')}.csv`, headers, rows);
  }

  if (loading) return <LoadingState message="Loading roster..." className="p-6" card />;

  if (!homeSlug) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className={CARD.padded}>
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Roster</h1>
          <p className="text-sm text-gray-500">Select a home to view the roster.</p>
        </div>
      </div>
    );
  }

  if (isOwnDataRoster) {
    if (error) {
      return <div className="p-6 max-w-5xl mx-auto"><ErrorState title="Unable to load your rota" message={error} onRetry={() => void loadData()} /></div>;
    }
    if (!schedData?.staff?.length) {
      return (
        <div className="p-6 max-w-5xl mx-auto">
          <EmptyState title="No rota link available" description="We couldn’t find a linked staff record for this account yet." />
        </div>
      );
    }
    return <StaffSelfServiceRoster schedData={schedData} monthDates={monthDates} monthLabel={monthLabel} monthOffset={monthOffset} setMonthOffset={setMonthOffset} />;
  }

  if (error) return <div className="p-6 max-w-5xl mx-auto"><ErrorState title="Unable to load the roster" message={error} onRetry={() => void loadData()} /></div>;

  if (!schedData) return null;


  return (
    <div className="p-4 max-w-full mx-auto">
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{schedData.config.home_name} — Roster: {monthLabel}</h1>
        <p className="text-xs text-gray-500">{monthDates.length} days | Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className="flex items-center justify-between mb-3 print:hidden">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Roster</h1>
          {/* Month Navigation */}
          <div className="flex items-center gap-1">
            <button
              aria-label="Previous month"
              onClick={() => setMonthOffset(monthOffset - 1)}
              className={`${BTN.ghost} ${BTN.xs} transition-colors duration-150`}>&larr;</button>
            {monthOffset !== 0 && (
              <button
                aria-label="Current month"
                onClick={() => setMonthOffset(0)}
                className={`${BTN.ghost} ${BTN.xs} text-blue-600 transition-colors duration-150`}>Current</button>
            )}
            <button
              aria-label="Next month"
              onClick={() => setMonthOffset(monthOffset + 1)}
              className={`${BTN.ghost} ${BTN.xs} transition-colors duration-150`}>&rarr;</button>
          </div>
          <span className="text-sm font-medium text-gray-600">{monthLabel}</span>
          <span className="text-xs text-gray-400">({monthDates.length} days)</span>
          {saving && <span className="text-xs text-blue-500">Saving...</span>}
        </div>
        <div className="flex items-center gap-2">
          <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)}
            className={`${INPUT.select} w-auto ${BTN.xs}`}>
            <option value="All">All Teams</option>
            {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {canEdit && <button onClick={() => setBulkModal({ type: 'revert-all' })} disabled={saving}
            className={`${BTN.secondary} ${BTN.xs} disabled:opacity-50`}>Revert All</button>}
          <button onClick={exportCSV}
            className={`${BTN.secondary} ${BTN.xs}`}>Export CSV</button>
          <button onClick={() => window.print()}
            className={`${BTN.secondary} ${BTN.xs}`}>Print</button>
          <span className="text-xs text-gray-500">{activeStaff.length} staff</span>
        </div>
      </div>

      {overrideWarnings.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="font-medium mb-1">Training warnings</div>
          <ul className="list-disc pl-5 space-y-1">
            {overrideWarnings.map((warning, idx) => <li key={idx}>{warning}</li>)}
          </ul>
        </div>
      )}

      {showLockPrompt && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-amber-800">Past dates are locked — enter the edit PIN to continue.</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={lockPin}
              onChange={e => updateLockPin(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && attemptUnlock()}
              placeholder="PIN"
              className={`${INPUT.sm} w-24`}
              autoFocus
            />
            <button onClick={attemptUnlock} className={`${BTN.primary} ${BTN.sm}`}>Unlock</button>
            <button
              onClick={dismissLockPrompt}
              className={`${BTN.ghost} ${BTN.sm}`}
            >
              Cancel
            </button>
            {lockError && <span className="text-xs text-red-600">{lockError}</span>}
          </div>
        </div>
      )}

      <div className={`${CARD.flush} overflow-x-auto`}>
        <table className="text-[11px] border-collapse">
          <thead>
            <tr className="bg-gray-800 text-white">
              <th scope="col" className="py-1.5 px-2 text-left sticky left-0 bg-gray-800 z-10 min-w-[120px]">Staff</th>
              <th scope="col" className="py-1.5 px-1 text-left min-w-[35px]">Pref</th>
              {monthDates.map((d, i) => {
                const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
                const isMonday = d.getUTCDay() === 1 && i > 0;
                return (
                  <th scope="col" key={i} className={`py-1.5 px-0.5 text-center min-w-[32px] ${
                    isWeekend ? 'bg-gray-700' : ''
                  } ${isMonday ? 'border-l border-gray-600' : ''}`}>
                    <div className="text-[9px] text-gray-400">{d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })[0]}</div>
                    <div>{d.getUTCDate()}</div>
                  </th>
                );
              })}
              <th scope="col" className="py-1.5 px-2 text-right min-w-[50px]">Hrs</th>
              <th scope="col" className="py-1.5 px-2 text-right min-w-[55px]">Pay £</th>
              <th scope="col" className="py-1.5 px-2 text-right min-w-[40px]">OT</th>
              <th scope="col" className="py-1.5 px-2 text-center min-w-[50px]">WTR</th>
            </tr>
          </thead>
          <tbody>
            {activeStaff.map((s, i) => {
              const showTeamHeader = i === 0 || activeStaff[i - 1]?.team !== s.team;
              const stats = staffStats[s.id];
              return [
                showTeamHeader && (
                  <tr key={`team-${s.team}`} className="bg-gray-100">
                    <td colSpan={monthDates.length + 6} className="py-1 px-2 font-bold text-xs text-gray-600 uppercase">{s.team}</td>
                  </tr>
                ),
                <tr key={s.id} className="border-b hover:bg-gray-50">
                  <td className="py-1 px-2 font-medium sticky left-0 bg-white z-10 border-r">
                    {(() => {
                      const blockReasons = [];
                      if (schedData.config.enforce_onboarding_blocking && isCareRole(s.role))
                        blockReasons.push(...getOnboardingBlockingReasons(s.id, schedData.onboarding));
                      if (schedData.config.enforce_training_blocking && isCareRole(s.role))
                        blockReasons.push(...getTrainingBlockingReasons(s.id, s.role, schedData.training, schedData.config, formatDate(monthDates[monthDates.length - 1] || new Date())));
                      return (
                        <div className="truncate max-w-[110px]" title={`${s.name} (${s.role})${blockReasons.length > 0 ? '\n! ' + blockReasons.join(', ') : ''}`}>
                          {s.name}
                          {blockReasons.length > 0 && <span className="text-red-500 ml-0.5 text-[9px]" title={blockReasons.join(', ')}>!</span>}
                        </div>
                      );
                    })()}
                    <div className="text-[9px] text-gray-400">{s.role}</div>
                  </td>
                  <td className="py-1 px-1 text-[10px] text-gray-500">{s.pref}</td>
                  {monthDates.map((date, i) => {
                    const dateKey = formatDate(date);
                    const actual = getActualShift(s, date, schedData.overrides, schedData.config.cycle_start_date);
                    const shift = actual.shift;
                    const isOverride = !!schedData.overrides[dateKey]?.[s.id];
                    const isEditing = editing?.staffId === s.id && editing?.dateStr === dateKey;
                    const isMonday = date.getUTCDay() === 1 && i > 0;
                    return (
                      <td key={i} className={`py-0.5 px-0.5 text-center ${isMonday ? 'border-l border-gray-200' : ''}`}>
                        <button
                          onClick={() => canEdit && openEditor(s.id, dateKey)}
                          disabled={saving || !canEdit}
                          className={`inline-block w-full px-0.5 min-h-[24px] py-0.5 rounded text-[10px] font-medium ${canEdit ? 'cursor-pointer hover:scale-105' : 'cursor-default'} transition-all ${
                            SHIFT_COLORS[shift] || 'bg-gray-100 text-gray-400'
                          } ${isOverride ? 'ring-1 ring-blue-400' : ''} ${isEditing ? 'ring-2 ring-blue-600 scale-110' : ''} disabled:cursor-not-allowed`}
                          title={[
                            `${s.name} — ${shift}${isOverride ? ' (override)' : ''}`,
                            isOverride ? `Scheduled: ${s.scheduledPattern?.[i] || actual.scheduledShift || 'OFF'}` : '',
                            schedData.overrides[dateKey]?.[s.id]?.sleep_in ? '+Sleep In' : '',
                            actual.replaces_staff_id
                              ? `Covers: ${staffMap.get(actual.replaces_staff_id)?.name || actual.replaces_staff_id}`
                              : '',
                            ...(coverMap[dateKey]?.[s.id]?.map(c =>
                              `Covered by: ${staffMap.get(c.coveredBy)?.name || '?'} (${c.shift})`
                            ) || []),
                            'Click to change',
                          ].filter(Boolean).join('\n')}>
                          {shift === 'OFF' ? '-' : shift}
                          {schedData.overrides[dateKey]?.[s.id]?.sleep_in && <span className="text-[7px]"> SI</span>}
                          {actual.replaces_staff_id && (
                            <span className="text-[7px] block leading-none opacity-70"
                              aria-label={`covers ${staffMap.get(actual.replaces_staff_id)?.name || 'another staff member'}`}>
                              →{getInitials(staffMap, actual.replaces_staff_id)}
                            </span>
                          )}
                          {coverMap[dateKey]?.[s.id] && (
                            <span className="text-[7px] block leading-none opacity-70"
                              aria-label={`covered by ${coverMap[dateKey][s.id].map(c => staffMap.get(c.coveredBy)?.name || '?').join(', ')}`}>
                              {coverMap[dateKey][s.id].length === 1
                                ? `←${getInitials(staffMap, coverMap[dateKey][s.id][0].coveredBy)}`
                                : `←${coverMap[dateKey][s.id].length}`}
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                  <td className="py-1 px-2 text-right font-mono" title={stats?.alHours > 0 ? `${stats.totalHours.toFixed(1)}h worked + ${stats.alHours.toFixed(1)}h AL` : undefined}>{stats?.paidHours.toFixed(1)}</td>
                  <td className="py-1 px-2 text-right font-mono">£{stats?.totalPay.toFixed(0)}</td>
                  <td className="py-1 px-2 text-right font-mono text-orange-600">{stats?.otHours > 0 ? stats.otHours.toFixed(1) : '-'}</td>
                  <td className="py-1 px-2 text-center">
                    <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${
                      stats?.wtrStatus === 'BREACH' ? 'bg-red-100 text-red-700' :
                      stats?.wtrStatus === 'HIGH' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                    }`}>{stats?.wtrStatus}</span>
                  </td>
                </tr>
              ];
            })}
            {/* Absence & Cover summary rows */}
            <tr
              {...clickableRowProps(() => setSummaryExpanded(e => !e), { label: `${summaryExpanded ? 'Collapse' : 'Expand'} absent summary` })}
              className="bg-amber-50 border-t-2 border-gray-300 cursor-pointer select-none"
            >
              <td className="py-1 px-2 font-semibold text-[10px] text-amber-800 sticky left-0 bg-amber-50 z-10 border-r whitespace-nowrap">
                {summaryExpanded ? '▾' : '▸'} Absent
              </td>
              <td></td>
              {monthDates.map((date, i) => {
                const ds = daySummaries[formatDate(date)];
                const abs = ds?.absences || [];
                if (abs.length === 0) return <td key={i} className="py-0.5 px-0.5 text-center text-[9px] text-gray-300">-</td>;
                const counts = {};
                abs.forEach(a => { counts[a.shift] = (counts[a.shift] || 0) + 1; });
                const collapsed = Object.entries(counts).map(([s, n]) => `${n}${s}`).join(' ');
                const expanded = abs.map(a => `${a.name} (${a.shift})`).join('\n');
                return (
                  <td key={i} className="py-0.5 px-0.5 text-center text-[9px]" title={expanded}>
                    <span className="text-amber-700 font-medium">{summaryExpanded ? abs.map((a, j) => <div key={j}>{a.name.split(' ')[0]}</div>) : collapsed}</span>
                  </td>
                );
              })}
              <td colSpan={4}></td>
            </tr>
            <tr
              {...clickableRowProps(() => setSummaryExpanded(e => !e), { label: `${summaryExpanded ? 'Collapse' : 'Expand'} cover summary` })}
              className="bg-blue-50 cursor-pointer select-none"
            >
              <td className="py-1 px-2 font-semibold text-[10px] text-blue-800 sticky left-0 bg-blue-50 z-10 border-r whitespace-nowrap">
                {summaryExpanded ? '▾' : '▸'} Cover
              </td>
              <td></td>
              {monthDates.map((date, i) => {
                const ds = daySummaries[formatDate(date)];
                const cov = ds?.covers || [];
                if (cov.length === 0) return <td key={i} className="py-0.5 px-0.5 text-center text-[9px] text-gray-300">-</td>;
                const counts = {};
                cov.forEach(c => { counts[c.shift] = (counts[c.shift] || 0) + 1; });
                const collapsed = Object.entries(counts).map(([s, n]) => `${n}${s}`).join(' ');
                const expanded = cov.map(c => `${c.name} → ${c.replacesName} (${c.shift})`).join('\n');
                return (
                  <td key={i} className="py-0.5 px-0.5 text-center text-[9px]" title={expanded}>
                    <span className="text-blue-700 font-medium">{summaryExpanded ? cov.map((c, j) => <div key={j}>{c.name.split(' ')[0]}</div>) : collapsed}</span>
                  </td>
                );
              })}
              <td colSpan={4}></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 mt-4 text-[10px]">
        {[
          ['EL', 'Full Day'], ['E', 'Early'], ['L', 'Late'], ['N', 'Night'],
          ['OFF', 'Off'], ['AVL', 'Available'], ['AL', 'Ann. Leave'], ['SICK', 'Sick'],
          ['OC-*', 'On-Call/OT'], ['AG-*', 'Agency'], ['BH-*', 'Bank Holiday'],
        ].map(([code, label]) => (
          <span key={code} className={`px-1.5 py-0.5 rounded ${SHIFT_COLORS[code] || 'bg-gray-100'}`}>
            {code} = {label}
          </span>
        ))}
      </div>

      <RotationGridModals
        bulkModal={bulkModal}
        setBulkModal={setBulkModal}
        monthLabel={monthLabel}
        saving={saving}
        revertAllOverrides={revertAllOverrides}
        editing={editing}
        setEditing={setEditing}
        schedData={schedData}
        impact={impact}
        canEdit={canEdit}
        bulkSickWeek={bulkSickWeek}
        applyChange={applyChange}
      />
      {ConfirmDialog}
    </div>
  );
}

function StaffSelfServiceRoster({ schedData, monthDates, monthLabel, monthOffset, setMonthOffset }) {
  const staffMember = schedData.staff?.[0];
  const rows = monthDates.map(date => {
    const actual = getActualShift(staffMember, date, schedData.overrides || {}, schedData.config?.cycle_start_date);
    const shift = typeof actual === 'string' ? actual : actual?.shift || 'OFF';
    const hours = WORKING_SHIFTS.includes(shift) ? getShiftHours(shift, schedData.config) : 0;
    return {
      key: formatDate(date),
      label: date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }),
      shift,
      hours,
    };
  });

  const workingDays = rows.filter(row => !['OFF', 'AL', 'SICK'].includes(row.shift));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className={CARD.padded}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Rota</h1>
            <p className="mt-2 text-sm text-gray-600">Your rota is shown here in a staff-safe view. Manager tools like coverage editing and team-wide overrides stay hidden.</p>
          </div>
          <div className="flex items-center gap-2">
            <button aria-label="Previous month" onClick={() => setMonthOffset(monthOffset - 1)} className={`${BTN.ghost} ${BTN.xs}`}>&larr;</button>
            {monthOffset !== 0 && <button aria-label="Current month" onClick={() => setMonthOffset(0)} className={`${BTN.ghost} ${BTN.xs} text-blue-600`}>Current</button>}
            <button aria-label="Next month" onClick={() => setMonthOffset(monthOffset + 1)} className={`${BTN.ghost} ${BTN.xs}`}>&rarr;</button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className={CARD.padded}>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Month</p>
          <p className="mt-2 text-xl font-bold text-gray-900">{monthLabel}</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Working shifts</p>
          <p className="mt-2 text-xl font-bold text-gray-900">{workingDays.length}</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Planned hours</p>
          <p className="mt-2 text-xl font-bold text-gray-900">{workingDays.reduce((sum, row) => sum + row.hours, 0).toFixed(1)}</p>
        </div>
      </div>

      <div className={CARD.flush}>
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{staffMember?.name || 'My shifts'}</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {rows.map(row => (
            <div key={row.key} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="font-medium text-gray-900">{row.label}</span>
              <div className="flex items-center gap-3">
                {row.hours > 0 && <span className="text-xs text-gray-500">{row.hours.toFixed(1)}h</span>}
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${row.shift === 'OFF' ? 'bg-gray-100 text-gray-600' : row.shift === 'AL' ? 'bg-amber-100 text-amber-700' : row.shift === 'SICK' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{row.shift}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
