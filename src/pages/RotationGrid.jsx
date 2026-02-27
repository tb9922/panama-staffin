import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  getStaffForDay, formatDate, getActualShift, getCycleDay,
  getScheduledShift, isCareRole,
  calculateStaffPeriodHours, SHIFT_COLORS,
} from '../lib/rotation.js';
import { calculateDayCost, getDayCoverageStatus, checkFatigueRisk } from '../lib/escalation.js';
import { CARD, TABLE, INPUT, BTN, BADGE, MODAL, PAGE } from '../lib/design.js';
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

const TEAMS = ['Day A', 'Day B', 'Night A', 'Night B', 'Float'];

const SHIFT_OPTIONS = [
  { value: 'E',     label: 'E — Early',          group: 'Standard' },
  { value: 'L',     label: 'L — Late',           group: 'Standard' },
  { value: 'EL',    label: 'EL — Full Day',      group: 'Standard' },
  { value: 'N',     label: 'N — Night',          group: 'Standard' },
  { value: 'OFF',   label: 'OFF — Day Off',      group: 'Standard' },
  { value: 'AVL',   label: 'AVL — Available',    group: 'Standard' },
  { value: 'AL',    label: 'AL — Annual Leave',  group: 'Absence' },
  { value: 'SICK',  label: 'SICK — Sick',        group: 'Absence' },
  { value: 'ADM',   label: 'ADM — Admin',        group: 'Absence' },
  { value: 'TRN',   label: 'TRN — Training',     group: 'Absence' },
  { value: 'OC-E',  label: 'OC-E — OT Early',   group: 'Overtime' },
  { value: 'OC-L',  label: 'OC-L — OT Late',    group: 'Overtime' },
  { value: 'OC-EL', label: 'OC-EL — OT Full',   group: 'Overtime' },
  { value: 'OC-N',  label: 'OC-N — OT Night',   group: 'Overtime' },
  { value: 'AG-E',  label: 'AG-E — Agency Early', group: 'Agency' },
  { value: 'AG-L',  label: 'AG-L — Agency Late',  group: 'Agency' },
  { value: 'AG-N',  label: 'AG-N — Agency Night', group: 'Agency' },
  { value: 'BH-D',  label: 'BH-D — Bank Hol Day', group: 'Bank Hol' },
  { value: 'BH-N',  label: 'BH-N — Bank Hol Night', group: 'Bank Hol' },
];

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
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export default function RotationGrid() {
  const [schedData, setSchedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [filterTeam, setFilterTeam] = useState('All');
  const [editing, setEditing] = useState(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [bulkModal, setBulkModal] = useState(null);

  const loadData = useCallback(async () => {
    const homeSlug = getCurrentHome();
    if (!homeSlug) return;
    setLoading(true);
    try {
      setSchedData(await getSchedulingData(homeSlug));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Dynamic calendar month dates
  const { monthDates, monthLabel } = useMemo(() => {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const dates = getMonthDates(target.getFullYear(), target.getMonth());
    const label = target.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    return { monthDates: dates, monthLabel: label };
  }, [monthOffset]);

  const activeStaff = useMemo(() => {
    if (!schedData) return [];
    let list = schedData.staff.filter(s => s.active !== false && isCareRole(s.role));
    if (filterTeam !== 'All') list = list.filter(s => s.team === filterTeam);
    const teamOrder = { 'Day A': 0, 'Day B': 1, 'Night A': 2, 'Night B': 3, 'Float': 4 };
    list.sort((a, b) => (teamOrder[a.team] ?? 9) - (teamOrder[b.team] ?? 9) || a.name.localeCompare(b.name));
    return list;
  }, [schedData, filterTeam]);

  const staffStats = useMemo(() => {
    if (!schedData) return {};
    const map = {};
    activeStaff.forEach(s => {
      map[s.id] = calculateStaffPeriodHours(s, monthDates, schedData.overrides, schedData.config);
    });
    return map;
  }, [activeStaff, monthDates, schedData]);

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

    const simOverrides = JSON.parse(JSON.stringify(schedData.overrides));
    const scheduled = getScheduledShift(staff, getCycleDay(date, schedData.config.cycle_start_date));
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
      errors.push(`WTR BREACH: avg ${statsAfter.avgWeeklyHours.toFixed(1)} hrs/wk (max 48)`);
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

  function openEditor(staffId, dateStr) {
    const actual = schedData.overrides[dateStr]?.[staffId]?.shift;
    const staff = schedData.staff.find(s => s.id === staffId);
    const cycleDay = getCycleDay(parseLocalDate(dateStr), schedData.config.cycle_start_date);
    const scheduled = getScheduledShift(staff, cycleDay);
    const currentShift = actual || scheduled;
    setEditing({ staffId, dateStr, currentShift, proposedShift: currentShift });
  }

  async function applyChange() {
    if (!editing || !editing.proposedShift) return;
    const { staffId, dateStr, proposedShift } = editing;
    const staff = schedData.staff.find(s => s.id === staffId);
    const date = parseLocalDate(dateStr);
    const scheduled = getScheduledShift(staff, getCycleDay(date, schedData.config.cycle_start_date));

    setSaving(true);
    try {
      if (proposedShift === scheduled) {
        await deleteOverride(getCurrentHome(), dateStr, staffId);
      } else {
        await upsertOverride(getCurrentHome(), { date: dateStr, staffId, shift: proposedShift, reason: 'Manual edit', source: 'manual' });
      }
      await loadData();
    } catch (e) {
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
      d.setDate(d.getDate() + i);
      const dk = formatDate(d);
      const cycleDay = getCycleDay(d, schedData.config.cycle_start_date);
      const sched = getScheduledShift(staff, cycleDay);
      if (sched !== 'OFF') {
        sickRows.push({ date: dk, staffId, shift: 'SICK', reason: 'Sick (bulk)', source: 'manual' });
      }
    }
    if (sickRows.length === 0) { setBulkModal(null); return; }
    setSaving(true);
    try {
      await bulkUpsertOverrides(getCurrentHome(), sickRows);
      await loadData();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
    setBulkModal(null);
  }

  async function revertAllOverrides() {
    if (!confirm(`Revert ALL overrides for ${monthLabel}? This cannot be undone.`)) return;
    const firstOfMonth = formatDate(monthDates[0]);
    const lastOfMonth = formatDate(monthDates[monthDates.length - 1]);
    setSaving(true);
    try {
      await revertMonthOverrides(getCurrentHome(), firstOfMonth, lastOfMonth);
      await loadData();
    } catch (e) {
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
        stats?.totalHours.toFixed(1) ?? '',
        stats?.grossPay.toFixed(0) ?? '',
        stats?.otHours > 0 ? stats.otHours.toFixed(1) : '0',
        stats?.wtrStatus ?? '',
      ];
    });
    downloadCSV(`roster_${monthLabel.replace(' ', '_')}.csv`, headers, rows);
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error) return (
    <div className="p-6">
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>
    </div>
  );

  if (!schedData) return null;

  let lastTeam = null;

  const CoverageRow = ({ label, before, after }) => {
    if (!before || !after) return null;
    const headChanged = after.coverage.headCount !== before.coverage.headCount;
    const skillChanged = after.coverage.skillPoints !== before.coverage.skillPoints;
    const headBad = after.coverage.headCount < after.coverage.required.heads;
    const skillBad = after.coverage.skillPoints < after.coverage.required.skill_points;
    return (
      <div className="flex items-center justify-between text-xs py-0.5">
        <span className="text-gray-500 capitalize w-12">{label}</span>
        <span className="flex items-center gap-1">
          <span>Heads:</span>
          {headChanged ? (
            <>
              <span className="text-gray-400">{before.coverage.headCount}</span>
              <span>&rarr;</span>
              <span className={headBad ? 'text-red-600 font-bold' : 'font-medium'}>{after.coverage.headCount}</span>
            </>
          ) : (
            <span className="font-medium">{after.coverage.headCount}</span>
          )}
          <span className="text-gray-300">/{after.coverage.required.heads}</span>
        </span>
        <span className="flex items-center gap-1">
          <span>Skill:</span>
          {skillChanged ? (
            <>
              <span className="text-gray-400">{before.coverage.skillPoints.toFixed(1)}</span>
              <span>&rarr;</span>
              <span className={skillBad ? 'text-red-600 font-bold' : 'font-medium'}>{after.coverage.skillPoints.toFixed(1)}</span>
            </>
          ) : (
            <span className="font-medium">{after.coverage.skillPoints.toFixed(1)}</span>
          )}
          <span className="text-gray-300">/{after.coverage.required.skill_points}</span>
        </span>
      </div>
    );
  };

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
            <button onClick={() => setMonthOffset(monthOffset - 1)}
              className={`${BTN.ghost} ${BTN.xs} transition-colors duration-150`}>&larr;</button>
            {monthOffset !== 0 && (
              <button onClick={() => setMonthOffset(0)}
                className={`${BTN.ghost} ${BTN.xs} text-blue-600 transition-colors duration-150`}>Current</button>
            )}
            <button onClick={() => setMonthOffset(monthOffset + 1)}
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
          <button onClick={() => setBulkModal({ type: 'revert-all' })} disabled={saving}
            className={`${BTN.secondary} ${BTN.xs} disabled:opacity-50`}>Revert All</button>
          <button onClick={exportCSV}
            className={`${BTN.secondary} ${BTN.xs}`}>Export CSV</button>
          <button onClick={() => window.print()}
            className={`${BTN.secondary} ${BTN.xs}`}>Print</button>
          <span className="text-xs text-gray-500">{activeStaff.length} staff</span>
        </div>
      </div>

      <div className={`${CARD.flush} overflow-x-auto`}>
        <table className="text-[11px] border-collapse">
          <thead>
            <tr className="bg-gray-800 text-white">
              <th className="py-1.5 px-2 text-left sticky left-0 bg-gray-800 z-10 min-w-[120px]">Staff</th>
              <th className="py-1.5 px-1 text-left min-w-[35px]">Pref</th>
              {monthDates.map((d, i) => {
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                const isMonday = d.getDay() === 1 && i > 0;
                return (
                  <th key={i} className={`py-1.5 px-0.5 text-center min-w-[32px] ${
                    isWeekend ? 'bg-gray-700' : ''
                  } ${isMonday ? 'border-l border-gray-600' : ''}`}>
                    <div className="text-[9px] text-gray-400">{d.toLocaleDateString('en-GB', { weekday: 'short' })[0]}</div>
                    <div>{d.getDate()}</div>
                  </th>
                );
              })}
              <th className="py-1.5 px-2 text-right min-w-[50px]">Hrs</th>
              <th className="py-1.5 px-2 text-right min-w-[55px]">Pay £</th>
              <th className="py-1.5 px-2 text-right min-w-[40px]">OT</th>
              <th className="py-1.5 px-2 text-center min-w-[50px]">WTR</th>
            </tr>
          </thead>
          <tbody>
            {activeStaff.map(s => {
              const showTeamHeader = s.team !== lastTeam;
              lastTeam = s.team;
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
                        blockReasons.push(...getTrainingBlockingReasons(s.id, s.role, schedData.training, schedData.config, formatDate(new Date())));
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
                    const isMonday = date.getDay() === 1 && i > 0;
                    return (
                      <td key={i} className={`py-0.5 px-0.5 text-center ${isMonday ? 'border-l border-gray-200' : ''}`}>
                        <button
                          onClick={() => openEditor(s.id, dateKey)}
                          disabled={saving}
                          className={`inline-block w-full px-0.5 py-0.5 rounded text-[10px] font-medium cursor-pointer transition-all ${
                            SHIFT_COLORS[shift] || 'bg-gray-100 text-gray-400'
                          } ${isOverride ? 'ring-1 ring-blue-400' : ''} ${isEditing ? 'ring-2 ring-blue-600 scale-110' : 'hover:scale-105'} disabled:cursor-not-allowed`}
                          title={`${s.name} — ${shift}${isOverride ? ' (override)' : ''}${schedData.overrides[dateKey]?.[s.id]?.sleep_in ? ' +SI' : ''}\nClick to change`}>
                          {shift === 'OFF' ? '-' : shift}
                          {schedData.overrides[dateKey]?.[s.id]?.sleep_in && <span className="text-[7px]"> SI</span>}
                        </button>
                      </td>
                    );
                  })}
                  <td className="py-1 px-2 text-right font-mono">{stats?.totalHours.toFixed(1)}</td>
                  <td className="py-1 px-2 text-right font-mono">£{stats?.grossPay.toFixed(0)}</td>
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

      {/* Bulk Revert Modal */}
      {bulkModal?.type === 'revert-all' && (
        <div className={MODAL.overlay} onClick={(e) => { if (e.target === e.currentTarget) setBulkModal(null); }}>
          <div className={MODAL.panelSm}>
            <h2 className={MODAL.title}>Revert All Overrides</h2>
            <p className="text-sm text-gray-600 mb-2">Remove all manual overrides for <strong>{monthLabel}</strong>?</p>
            <p className="text-xs text-amber-600 mb-4">This will reset all sick, AL, OT, and agency bookings this month.</p>
            <div className={MODAL.footer}>
              <button onClick={() => setBulkModal(null)} className={BTN.secondary}>Cancel</button>
              <button onClick={revertAllOverrides} disabled={saving} className={`${BTN.danger} disabled:opacity-50`}>
                {saving ? 'Reverting...' : 'Revert All'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shift Editor Modal */}
      {editing && (
        <div className={MODAL.overlay} onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden animate-modal-in">
            {/* Header */}
            <div className="bg-gray-800 text-white px-5 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">{schedData.staff.find(s => s.id === editing.staffId)?.name}</h2>
                  <p className="text-xs text-gray-400">
                    {parseLocalDate(editing.dateStr).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
                <div className="text-right">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${SHIFT_COLORS[editing.currentShift] || 'bg-gray-600'}`}>
                    {editing.currentShift}
                  </span>
                  <p className="text-[10px] text-gray-400 mt-1">current</p>
                </div>
              </div>
            </div>

            <div className="p-5">
              {/* Shift Selector Dropdown */}
              <div className="mb-4">
                <label className={INPUT.label}>Change shift to:</label>
                <select
                  value={editing.proposedShift}
                  onChange={e => setEditing({ ...editing, proposedShift: e.target.value })}
                  className={`${INPUT.select} font-medium`}>
                  <optgroup label="Standard">
                    {SHIFT_OPTIONS.filter(o => o.group === 'Standard').map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Absence">
                    {SHIFT_OPTIONS.filter(o => o.group === 'Absence').map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Overtime / On-Call">
                    {SHIFT_OPTIONS.filter(o => o.group === 'Overtime').map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Agency">
                    {SHIFT_OPTIONS.filter(o => o.group === 'Agency').map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Bank Holiday">
                    {SHIFT_OPTIONS.filter(o => o.group === 'Bank Hol').map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {/* Impact Preview */}
              {impact ? (
                <div className="space-y-3">
                  <div className={`rounded-lg px-4 py-2.5 flex items-center gap-2 ${
                    impact.errors.length > 0 ? 'bg-red-50 border border-red-200' :
                    impact.warnings.length > 0 ? 'bg-amber-50 border border-amber-200' :
                    'bg-green-50 border border-green-200'
                  }`}>
                    <span className="text-lg">{impact.errors.length > 0 ? '!' : impact.warnings.length > 0 ? '~' : 'OK'}</span>
                    <div>
                      <div className={`font-semibold text-sm ${
                        impact.errors.length > 0 ? 'text-red-800' : impact.warnings.length > 0 ? 'text-amber-800' : 'text-green-800'
                      }`}>
                        {impact.errors.length > 0 ? 'Issues Found — Review Before Approving' :
                         impact.warnings.length > 0 ? 'Warnings — Proceed With Caution' :
                         'All Clear — Safe to Apply'}
                      </div>
                      <div className="text-[10px] text-gray-500">
                        {editing.currentShift} &rarr; {editing.proposedShift}
                      </div>
                    </div>
                  </div>

                  {impact.errors.length > 0 && (
                    <div className="space-y-1">
                      {impact.errors.map((e, i) => (
                        <div key={i} className="text-xs bg-red-50 text-red-700 px-3 py-1.5 rounded flex items-start gap-1.5">
                          <span className="font-bold mt-px">!</span> {e}
                        </div>
                      ))}
                    </div>
                  )}
                  {impact.warnings.length > 0 && (
                    <div className="space-y-1">
                      {impact.warnings.map((w, i) => (
                        <div key={i} className="text-xs bg-amber-50 text-amber-700 px-3 py-1.5 rounded flex items-start gap-1.5">
                          <span className="font-bold mt-px">~</span> {w}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="border rounded-lg p-3">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Day Coverage Impact</h4>
                    <CoverageRow label="Early" before={impact.coverageBefore.early} after={impact.coverageAfter.early} />
                    <CoverageRow label="Late" before={impact.coverageBefore.late} after={impact.coverageAfter.late} />
                    <CoverageRow label="Night" before={impact.coverageBefore.night} after={impact.coverageAfter.night} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="border rounded-lg p-3">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Day Cost</h4>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-gray-400 text-xs">£{impact.costBefore.total.toFixed(0)}</span>
                        <span className="text-xs">&rarr;</span>
                        <span className="font-bold text-sm">£{impact.costAfter.total.toFixed(0)}</span>
                      </div>
                      <div className={`text-xs mt-0.5 font-medium ${
                        impact.costDelta > 0 ? 'text-red-600' : impact.costDelta < 0 ? 'text-green-600' : 'text-gray-400'
                      }`}>
                        {impact.costDelta > 0 ? '+' : ''}{impact.costDelta !== 0 ? `£${impact.costDelta.toFixed(2)}` : 'No change'}
                      </div>
                    </div>
                    <div className="border rounded-lg p-3">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Staff Month</h4>
                      <div className="text-xs space-y-0.5">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Hours:</span>
                          <span className="font-medium">
                            {impact.statsBefore.totalHours.toFixed(1)} &rarr; {impact.statsAfter.totalHours.toFixed(1)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Pay:</span>
                          <span className="font-medium">
                            £{impact.statsBefore.grossPay.toFixed(0)} &rarr; £{impact.statsAfter.grossPay.toFixed(0)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">WTR:</span>
                          <span className={`font-medium ${
                            impact.wtrAfter === 'BREACH' ? 'text-red-600' : impact.wtrAfter === 'HIGH' ? 'text-amber-600' : 'text-green-600'
                          }`}>{impact.wtrAfter}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Fatigue:</span>
                          <span className={`font-medium ${
                            impact.fatigueAfter.exceeded ? 'text-red-600' : impact.fatigueAfter.atRisk ? 'text-amber-600' : 'text-green-600'
                          }`}>{impact.fatigueAfter.consecutive}d consec</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : editing.proposedShift === editing.currentShift ? (
                <div className="text-sm text-gray-400 text-center py-4">Select a different shift to see the impact</div>
              ) : null}
            </div>

            {/* Footer */}
            <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between bg-gray-50/80">
              <button onClick={() => setEditing(null)} className={BTN.ghost} disabled={saving}>
                Cancel
              </button>
              <div className="flex gap-2">
                <button onClick={() => { bulkSickWeek(editing.staffId, editing.dateStr); setEditing(null); }}
                  disabled={saving}
                  className={`${BTN.ghost} ${BTN.xs} text-red-600 disabled:opacity-50`}>
                  Sick 7 Days
                </button>
                {editing.currentShift !== getScheduledShift(schedData.staff.find(s => s.id === editing.staffId), getCycleDay(parseLocalDate(editing.dateStr), schedData.config.cycle_start_date)) && (
                  <button onClick={() => {
                    const staff = schedData.staff.find(s => s.id === editing.staffId);
                    const scheduled = getScheduledShift(staff, getCycleDay(parseLocalDate(editing.dateStr), schedData.config.cycle_start_date));
                    setEditing({ ...editing, proposedShift: scheduled });
                  }} disabled={saving} className={`${BTN.ghost} ${BTN.xs} text-blue-600 disabled:opacity-50`}>
                    Revert to Scheduled
                  </button>
                )}
                <button
                  onClick={applyChange}
                  disabled={saving || !editing.proposedShift || editing.proposedShift === editing.currentShift}
                  className={`${
                    impact?.errors.length > 0
                      ? BTN.danger
                      : impact?.warnings.length > 0
                      ? 'inline-flex items-center justify-center px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-sm font-medium shadow-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2'
                      : BTN.success
                  } disabled:opacity-30`}>
                  {saving ? 'Saving...' :
                   impact?.errors.length > 0 ? 'Apply Anyway' :
                   impact?.warnings.length > 0 ? 'Apply (with warnings)' :
                   'Approve & Apply'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
