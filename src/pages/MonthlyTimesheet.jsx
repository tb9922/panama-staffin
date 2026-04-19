import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import StickyTable from '../components/StickyTable.jsx';
import {
  getCurrentHome, getTimesheetPeriod,
  batchUpsertTimesheets, approveTimesheetRange,
  upsertTimesheet, approveTimesheet, disputeTimesheet,
  upsertTimesheetHourAdjustment, deleteTimesheetHourAdjustment,
  getSchedulingData, } from '../lib/api.js';
import { getActualShift, getShiftHours, WORKING_SHIFTS, parseDate } from '../lib/rotation.js';
import { snapToShift, calculatePayableHours } from '../lib/payroll.js';
import { useData } from '../contexts/DataContext.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import useTransientNotice from '../hooks/useTransientNotice.js';
import { todayLocalISO } from '../lib/localDates.js';
import { calculateAccrual } from '../lib/accrual.js';

const STATUS_BADGE = {
  pending:  BADGE.amber,
  approved: BADGE.green,
  disputed: BADGE.red,
  locked:   BADGE.gray,
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isAbsence(shift) {
  return ['AL', 'SICK', 'NS'].includes(shift);
}

function getShiftTimes(shift, config) {
  if (!config?.shifts) return { start: null, end: null };
  const s = config.shifts;
  switch (shift) {
    case 'E': case 'OC-E': case 'AG-E': case 'BH-D':
      return { start: s.E?.start || '07:00', end: s.E?.end || '13:00' };
    case 'L': case 'OC-L': case 'AG-L':
      return { start: s.L?.start || '13:00', end: s.L?.end || '20:00' };
    case 'EL': case 'OC-EL': case 'AG-EL':
      return { start: s.EL?.start || '07:00', end: s.EL?.end || '20:00' };
    case 'N': case 'OC-N': case 'AG-N': case 'BH-N':
      return { start: s.N?.start || '20:00', end: s.N?.end || '07:00' };
    default: return { start: null, end: null };
  }
}

export default function MonthlyTimesheet() {
  const { staffId: urlStaffId } = useParams();
  const navigate = useNavigate();
  const homeSlug = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('payroll');

  const [schedData, setSchedData] = useState(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const activeStaff = useMemo(
    () => (schedData?.staff || []).filter(s => s.active),
    [schedData?.staff],
  );

  const [selectedStaffId, setSelectedStaffId] = useState(urlStaffId || '');
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const { notice, showNotice, clearNotice } = useTransientNotice();

  // Edit modal state
  const [editModal, setEditModal] = useState(null); // { row }
  const [editForm, setEditForm] = useState({});

  // Dispute modal state
  const [disputeModal, setDisputeModal] = useState(null); // { entry }
  const [disputeReason, setDisputeReason] = useState('');
  const [adjustmentModal, setAdjustmentModal] = useState(null); // { row }
  const [adjustmentForm, setAdjustmentForm] = useState({ kind: 'annual_leave', hours: '', note: '' });
  useDirtyGuard(!!editModal || !!disputeModal || !!adjustmentModal);

  // Snap config from schedData
  const snapConfig = useMemo(() => ({
    enabled: schedData?.config?.snap_to_shift !== false,
    window: schedData?.config?.snap_window_minutes ?? 7,
  }), [schedData?.config]);

  // Default to first active staff if none selected
  useEffect(() => {
    if (!selectedStaffId && activeStaff.length > 0) {
      setSelectedStaffId(activeStaff[0].id);
    }
  }, [activeStaff, selectedStaffId]);

  // Sync URL param
  useEffect(() => {
    if (urlStaffId && urlStaffId !== selectedStaffId) {
      setSelectedStaffId(urlStaffId);
    }
  }, [urlStaffId, selectedStaffId]);

  const staff = useMemo(
    () => activeStaff.find(s => s.id === selectedStaffId),
    [activeStaff, selectedStaffId],
  );

  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`;

  useEffect(() => {
    if (!homeSlug) return;
    let cancelled = false;
    setScheduleLoading(true);
    setScheduleError(null);
    getSchedulingData(homeSlug, { from: monthStart, to: monthEnd })
      .then((data) => {
        if (!cancelled) setSchedData(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setSchedData(null);
          setScheduleError(e.message || 'Failed to load scheduling data');
        }
      })
      .finally(() => {
        if (!cancelled) setScheduleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [homeSlug, monthStart, monthEnd, refreshKey]);

  // Fetch timesheet entries for staff + month
  const fetchEntries = useCallback(async () => {
    if (!homeSlug || !selectedStaffId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getTimesheetPeriod(homeSlug, monthStart, monthEnd, null, selectedStaffId);
      setEntries(result);
    } catch (e) {
      setError(e.message || 'Failed to load timesheets');
    } finally {
      setLoading(false);
    }
  }, [homeSlug, selectedStaffId, monthStart, monthEnd]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // Build rows: one per day of month
  const rows = useMemo(() => {
    if (!staff || !schedData?.config) return [];
    const numDays = daysInMonth(year, month);
    const result = [];

    for (let d = 1; d <= numDays; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dateObj = parseDate(dateStr);
      const dayOfWeek = dateObj.getUTCDay();

      // Roster: what should they be doing?
      const actual = getActualShift(staff, dateObj, schedData?.overrides || {}, schedData?.config.cycle_start_date, schedData?.config);
      const rosterShift = typeof actual === 'string' ? actual : actual?.shift || 'OFF';
      const overrideReason = typeof actual === 'object' ? actual.reason : null;
      const rosterHours = WORKING_SHIFTS.includes(rosterShift) ? getShiftHours(rosterShift, schedData?.config) : 0;

      // Timesheet entry (if exists)
      const entry = entries.find(e => e.date === dateStr);
      const adjustment = schedData?.hour_adjustments?.[dateStr]?.[selectedStaffId] || null;

      // Classify the row
      let rowType;
      if (WORKING_SHIFTS.includes(rosterShift) && !entry) {
        const todayDate = parseDate(todayLocalISO());
        rowType = dateObj < todayDate ? 'missing' : 'future';
      } else if (WORKING_SHIFTS.includes(rosterShift) && entry) {
        rowType = 'working';
      } else if (isAbsence(rosterShift)) {
        rowType = 'absence';
      } else if (!WORKING_SHIFTS.includes(rosterShift) && entry) {
        rowType = 'unscheduled';
      } else {
        rowType = 'off';
      }

      const variance = entry?.payable_hours != null ? (entry.payable_hours - rosterHours) : null;
      const shortfallHours = entry?.payable_hours != null ? Math.max(0, rosterHours - entry.payable_hours) : null;
      const paidHours = entry?.payable_hours != null
        ? entry.payable_hours + (adjustment?.hours || 0)
        : null;

      result.push({
        dateStr, dayOfWeek, rosterShift, rosterHours, overrideReason,
        entry, rowType, variance, shortfallHours, adjustment, paidHours,
      });
    }
    return result;
  }, [staff, schedData, entries, year, month, selectedStaffId]);

  // Summary stats
  const stats = useMemo(() => {
    let scheduledHours = 0;
    let actualHours = 0;
    let paidAdjustmentHours = 0;
    let paidHours = 0;
    let approvedCount = 0;
    let workingDays = 0;
    for (const row of rows) {
      if (WORKING_SHIFTS.includes(row.rosterShift)) {
        scheduledHours += row.rosterHours;
        workingDays++;
      }
      if (row.entry?.payable_hours != null) {
        actualHours += row.entry.payable_hours;
      }
      if (row.adjustment?.hours) {
        paidAdjustmentHours += row.adjustment.hours;
      }
      if (row.paidHours != null) {
        paidHours += row.paidHours;
      }
      if (row.entry?.status === 'approved' || row.entry?.status === 'locked') {
        approvedCount++;
      }
    }
    return {
      scheduledHours: scheduledHours.toFixed(1),
      actualHours: actualHours.toFixed(1),
      paidAdjustmentHours: paidAdjustmentHours.toFixed(1),
      paidHours: paidHours.toFixed(1),
      variance: (actualHours - scheduledHours).toFixed(1),
      approvedCount,
      workingDays,
    };
  }, [rows]);

  // ── Per-row actions ──────────────────────────────────────────────────────────

  function openEdit(row) {
    const times = getShiftTimes(row.rosterShift, schedData?.config);
    setEditForm({
      staff_id:        selectedStaffId,
      date:            row.dateStr,
      scheduled_start: row.entry?.scheduled_start || times.start || '',
      scheduled_end:   row.entry?.scheduled_end || times.end || '',
      actual_start:    row.entry?.actual_start || times.start || '',
      actual_end:      row.entry?.actual_end || times.end || '',
      break_minutes:   row.entry?.break_minutes ?? (row.rosterShift === 'N' ? 0 : (row.rosterHours > 6 ? 30 : 0)),
      notes:           row.entry?.notes || '',
    });
    setEditModal({ row });
  }

  function handleEditChange(field, value) {
    setEditForm(f => {
      const updated = { ...f, [field]: value };
      const snapStart = snapToShift(updated.scheduled_start, updated.actual_start, snapConfig.window, snapConfig.enabled);
      const snapEnd   = snapToShift(updated.scheduled_end,   updated.actual_end,   snapConfig.window, snapConfig.enabled);
      updated.snapped_start      = snapStart.snapped;
      updated.snapped_end        = snapEnd.snapped;
      updated.snap_applied       = snapStart.applied || snapEnd.applied;
      updated.snap_minutes_saved = snapStart.savedMinutes + snapEnd.savedMinutes;
      updated.payable_hours      = calculatePayableHours(snapStart.snapped, snapEnd.snapped, updated.break_minutes, updated.date || editModal?.row?.dateStr);
      return updated;
    });
  }

  async function handleSaveEntry() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const snapStart = snapToShift(editForm.scheduled_start, editForm.actual_start, snapConfig.window, snapConfig.enabled);
      const snapEnd   = snapToShift(editForm.scheduled_end,   editForm.actual_end,   snapConfig.window, snapConfig.enabled);
      const payable   = calculatePayableHours(snapStart.snapped, snapEnd.snapped, editForm.break_minutes, editForm.date || editModal?.row?.dateStr);

      await upsertTimesheet(homeSlug, {
        ...editForm,
        snapped_start:      snapStart.snapped,
        snapped_end:        snapEnd.snapped,
        snap_applied:       snapStart.applied || snapEnd.applied,
        snap_minutes_saved: snapStart.savedMinutes + snapEnd.savedMinutes,
        payable_hours:      payable,
        status:             editModal.row.entry?.status === 'locked' ? 'locked' : 'pending',
      });
      setEditModal(null);
      await fetchEntries();
      showNotice('Timesheet entry saved.');
    } catch (e) {
      setError(e.message || 'Failed to save entry');
    } finally {
      setSaving(false);
    }
  }

  async function handleApproveOne(entry) {
    if (saving || !entry?.id) return;
    setSaving(true);
    setError(null);
    try {
      await approveTimesheet(homeSlug, entry.id);
      await fetchEntries();
      showNotice('Timesheet entry approved.');
    } catch (e) {
      setError(e.message || 'Failed to approve entry');
    } finally {
      setSaving(false);
    }
  }

  function openDispute(entry) {
    setDisputeReason('');
    setDisputeModal({ entry });
  }

  function openAdjustment(row) {
    setAdjustmentForm({
      kind: row.adjustment?.kind || 'annual_leave',
      hours: row.adjustment?.hours != null
        ? String(row.adjustment.hours)
        : (row.shortfallHours != null ? row.shortfallHours.toFixed(2).replace(/\.00$/, '') : ''),
      note: row.adjustment?.note || '',
    });
    setAdjustmentModal({ row });
  }

  async function handleDisputeSubmit() {
    if (saving || !disputeModal?.entry?.id || !disputeReason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await disputeTimesheet(homeSlug, disputeModal.entry.id, disputeReason.trim());
      setDisputeModal(null);
      await fetchEntries();
      showNotice('Timesheet entry disputed.');
    } catch (e) {
      setError(e.message || 'Failed to dispute entry');
    } finally {
      setSaving(false);
    }
  }

  const adjustmentAccrual = useMemo(() => {
    if (!adjustmentModal || !staff || !schedData) return null;
    const hourAdjustments = JSON.parse(JSON.stringify(schedData.hour_adjustments || {}));
    const currentDate = adjustmentModal.row.dateStr;
    if (hourAdjustments[currentDate]?.[selectedStaffId]) {
      delete hourAdjustments[currentDate][selectedStaffId];
      if (Object.keys(hourAdjustments[currentDate]).length === 0) delete hourAdjustments[currentDate];
    }
    return calculateAccrual(staff, schedData.config, schedData.overrides, currentDate, hourAdjustments);
  }, [adjustmentModal, schedData, selectedStaffId, staff]);

  async function handleSaveAdjustment() {
    if (saving || !adjustmentModal) return;
    const hours = parseFloat(adjustmentForm.hours);
    const maxShortfall = adjustmentModal.row.shortfallHours ?? 0;
    if (!(hours > 0)) {
      setError('Enter a positive number of hours for the paid adjustment');
      return;
    }
    if (hours > maxShortfall + 0.05) {
      setError(`Adjustment cannot exceed the current shortfall (${maxShortfall.toFixed(2)}h)`);
      return;
    }
    if (adjustmentForm.kind === 'annual_leave' && adjustmentAccrual && hours > adjustmentAccrual.remainingHours + 0.05) {
      setError(`Only ${adjustmentAccrual.remainingHours.toFixed(1)}h of earned leave is available for that date`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await upsertTimesheetHourAdjustment(homeSlug, {
        staff_id: selectedStaffId,
        date: adjustmentModal.row.dateStr,
        kind: adjustmentForm.kind,
        hours,
        note: adjustmentForm.note?.trim() || null,
        source: 'timesheet_shortfall',
      });
      setAdjustmentModal(null);
      setRefreshKey((value) => value + 1);
      showNotice(adjustmentForm.kind === 'annual_leave'
        ? 'Hourly annual leave applied to the shortfall.'
        : 'Paid authorised absence applied to the shortfall.');
    } catch (e) {
      setError(e.message || 'Failed to save hourly adjustment');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAdjustment() {
    if (saving || !adjustmentModal?.row?.adjustment) return;
    setSaving(true);
    setError(null);
    try {
      await deleteTimesheetHourAdjustment(homeSlug, selectedStaffId, adjustmentModal.row.dateStr);
      setAdjustmentModal(null);
      setRefreshKey((value) => value + 1);
      showNotice('Hourly adjustment removed.');
    } catch (e) {
      setError(e.message || 'Failed to remove hourly adjustment');
    } finally {
      setSaving(false);
    }
  }

  async function handleRecordOne(row) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const times = getShiftTimes(row.rosterShift, schedData?.config);
      await upsertTimesheet(homeSlug, {
        staff_id: selectedStaffId,
        date: row.dateStr,
        scheduled_start: times.start,
        scheduled_end: times.end,
        actual_start: times.start,
        actual_end: times.end,
        snapped_start: times.start,
        snapped_end: times.end,
        snap_applied: false,
        snap_minutes_saved: 0,
        break_minutes: row.rosterShift === 'N' ? 0 : (row.rosterHours > 6 ? 30 : 0),
        payable_hours: row.rosterHours,
        status: 'pending',
      });
      await fetchEntries();
      showNotice('Missing timesheet entry recorded.');
    } catch (e) {
      setError(e.message || 'Failed to record entry');
    } finally {
      setSaving(false);
    }
  }

  // ── Bulk actions ─────────────────────────────────────────────────────────────

  async function handleConfirmAll() {
    if (!staff || !schedData?.config || saving) return;
    setSaving(true);
    setError(null);
    try {
      const entriesToCreate = [];
      for (const row of rows) {
        if (row.rowType === 'missing' || (row.rowType === 'future' && WORKING_SHIFTS.includes(row.rosterShift) && !row.entry)) {
          const times = getShiftTimes(row.rosterShift, schedData?.config);
          entriesToCreate.push({
            staff_id: selectedStaffId,
            date: row.dateStr,
            scheduled_start: times.start,
            scheduled_end: times.end,
            actual_start: times.start,
            actual_end: times.end,
            snapped_start: times.start,
            snapped_end: times.end,
            snap_applied: false,
            snap_minutes_saved: 0,
            break_minutes: row.rosterShift === 'N' ? 0 : (row.rosterHours > 6 ? 30 : 0),
            payable_hours: row.rosterHours,
            status: 'pending',
          });
        }
      }
      if (entriesToCreate.length === 0) {
        setError('No missing entries to confirm');
        setSaving(false);
        return;
      }
      await batchUpsertTimesheets(homeSlug, entriesToCreate);
      await fetchEntries();
      showNotice('Missing timesheet entries confirmed.');
    } catch (e) {
      setError(e.message || 'Failed to confirm entries');
    } finally {
      setSaving(false);
    }
  }

  async function handleApproveAll() {
    if (!selectedStaffId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await approveTimesheetRange(homeSlug, selectedStaffId, monthStart, monthEnd);
      if (result.approved === 0) {
        setError('No pending entries to approve');
      }
      await fetchEntries();
      if (result.approved > 0) showNotice('Pending timesheet entries approved.');
    } catch (e) {
      setError(e.message || 'Failed to approve entries');
    } finally {
      setSaving(false);
    }
  }

  // ── Navigation ───────────────────────────────────────────────────────────────

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  // ── Row styling helpers ──────────────────────────────────────────────────────

  function rowBg(row) {
    if (row.entry?.status === 'approved' || row.entry?.status === 'locked') return 'bg-green-50';
    if (row.entry?.status === 'pending') return 'bg-amber-50';
    if (row.entry?.status === 'disputed') return 'bg-red-50';
    if (row.rowType === 'missing') return 'bg-red-50';
    if (row.rowType === 'unscheduled') return 'bg-blue-50';
    if (row.rowType === 'absence') return 'bg-gray-50';
    if (row.rowType === 'off') return 'bg-gray-50';
    return '';
  }

  function statusLabel(row) {
    if (row.entry) return row.entry.status.charAt(0).toUpperCase() + row.entry.status.slice(1);
    if (row.rowType === 'missing') return 'Missing';
    if (row.rowType === 'future') return '\u2014';
    if (isAbsence(row.rosterShift)) return row.rosterShift;
    if (row.rosterShift === 'OFF') return 'Off';
    return '\u2014';
  }

  function statusBadge(row) {
    if (row.entry) return STATUS_BADGE[row.entry.status] || BADGE.gray;
    if (row.rowType === 'missing') return BADGE.red;
    if (row.rosterShift === 'AL') return BADGE.blue;
    if (row.rosterShift === 'SICK') return BADGE.red;
    if (row.rosterShift === 'NS') return BADGE.pink;
    return BADGE.gray;
  }

  function rowActions(row) {
    if (!canEdit) return null;
    const e = row.entry;

    // Locked — no actions
    if (e?.status === 'locked') return null;
    // Future without entry — no actions
    if (row.rowType === 'future' && !e) return null;
    // Off/absence without entry — no actions
    if ((row.rowType === 'off' || row.rowType === 'absence') && !e) return null;

    return (
      <div className="flex gap-1">
        {/* Missing day — Record button */}
        {row.rowType === 'missing' && !e && (
          <button
            className={`${BTN.secondary} ${BTN.xs}`}
            onClick={() => handleRecordOne(row)}
            disabled={saving}
            title="Record as scheduled"
          >Record</button>
        )}

        {/* Entry exists — Edit */}
        {e && e.status !== 'locked' && (
          <button
            className={`${BTN.ghost} ${BTN.xs}`}
            onClick={() => openEdit(row)}
            disabled={saving}
            title="Edit entry"
          >Edit</button>
        )}

        {/* Pending — Approve */}
        {e?.status === 'pending' && (
          <button
            className={`${BTN.success} ${BTN.xs}`}
            onClick={() => handleApproveOne(e)}
            disabled={saving}
            title="Approve this day"
          >Approve</button>
        )}

        {/* Pending or Approved — Dispute */}
        {(e?.status === 'pending' || e?.status === 'approved') && (
          <button
            className={`${BTN.danger} ${BTN.xs}`}
            onClick={() => openDispute(e)}
            disabled={saving}
            title="Dispute this entry"
          >Dispute</button>
        )}

        {(e && WORKING_SHIFTS.includes(row.rosterShift) && ((row.shortfallHours ?? 0) > 0.05 || row.adjustment)) && (
          <button
            className={`${BTN.secondary} ${BTN.xs}`}
            onClick={() => openAdjustment(row)}
            disabled={saving}
            title={row.adjustment ? 'Edit paid shortfall adjustment' : 'Resolve unpaid shortfall'}
          >Adjust</button>
        )}
      </div>
    );
  }

  const pendingCount = rows.filter(r => r.entry?.status === 'pending').length;
  const missingCount = rows.filter(r => r.rowType === 'missing').length;

  // Auto-calculate payable hours in edit form
  const editPayable = useMemo(() => {
    if (!editForm.actual_start || !editForm.actual_end) return null;
    const snapStart = snapToShift(editForm.scheduled_start, editForm.actual_start, snapConfig.window, snapConfig.enabled);
    const snapEnd   = snapToShift(editForm.scheduled_end,   editForm.actual_end,   snapConfig.window, snapConfig.enabled);
    return calculatePayableHours(snapStart.snapped, snapEnd.snapped, editForm.break_minutes, editForm.date);
  }, [editForm.actual_start, editForm.actual_end, editForm.break_minutes, editForm.date, editForm.scheduled_start, editForm.scheduled_end, snapConfig]);

  function retryLoad() {
    setError(null);
    setRefreshKey((value) => value + 1);
  }

  if (scheduleLoading && !schedData) {
    return <div className={PAGE.container}><LoadingState message="Loading monthly timesheet data..." /></div>;
  }

  if (scheduleError && !schedData) {
    return <div className={PAGE.container}><ErrorState title="Unable to load monthly timesheets" message={scheduleError} onRetry={retryLoad} /></div>;
  }

  if (!schedData || activeStaff.length === 0) {
    return (
      <div className={PAGE.container}>
        <EmptyState
          title="No active staff available"
          description="Add or reactivate a staff record before reviewing monthly timesheets."
        />
      </div>
    );
  }

  const monthName = new Date(year, month - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div className={PAGE.container}>
      <div className="flex items-center justify-between mb-6 print:mb-2">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/payroll/timesheets')} className={BTN.ghost + ' ' + BTN.sm}>
            <svg className="w-4 h-4 mr-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
            Back
          </button>
          <h1 className={PAGE.title + ' !mb-0'}>Monthly Timesheet</h1>
        </div>
        <button onClick={() => window.print()} className={BTN.ghost + ' ' + BTN.sm + ' print:hidden'}>Print</button>
      </div>

      {/* Staff + month selector */}
      <div className="flex flex-wrap items-center gap-4 mb-6 print:hidden">
        <div className="flex items-center gap-2">
          <label className={INPUT.label} htmlFor="monthly-timesheet-staff">Staff</label>
          <select
            id="monthly-timesheet-staff"
            className={INPUT.select + ' min-w-[220px]'}
            value={selectedStaffId}
            onChange={e => {
              setSelectedStaffId(e.target.value);
              navigate(`/payroll/monthly-timesheet/${e.target.value}`, { replace: true });
            }}
          >
            {activeStaff.map(s => (
              <option key={s.id} value={s.id}>{s.id} — {s.name} ({s.role})</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className={BTN.ghost + ' ' + BTN.sm}>&#8592;</button>
          <span className="font-semibold text-gray-700 min-w-[140px] text-center">{monthName}</span>
          <button onClick={nextMonth} className={BTN.ghost + ' ' + BTN.sm}>&#8594;</button>
        </div>
      </div>

      {/* Print header */}
      <div className="hidden print:block mb-4">
        <p className="text-lg font-bold">{staff?.name} ({staff?.id}) — {staff?.role}</p>
        <p className="text-sm text-gray-600">{monthName}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <div className={CARD.padded}>
          <p className="text-xs text-gray-400 uppercase">Scheduled</p>
          <p className="text-2xl font-bold text-gray-900">{stats.scheduledHours}<span className="text-sm font-normal text-gray-400"> hrs</span></p>
          <p className="text-xs text-gray-400">{stats.workingDays} working days</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs text-gray-400 uppercase">Worked</p>
          <p className="text-2xl font-bold text-gray-900">{stats.actualHours}<span className="text-sm font-normal text-gray-400"> hrs</span></p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs text-gray-400 uppercase">Paid Adj.</p>
          <p className="text-2xl font-bold text-gray-900">{stats.paidAdjustmentHours}<span className="text-sm font-normal text-gray-400"> hrs</span></p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs text-gray-400 uppercase">Paid Hours</p>
          <p className="text-2xl font-bold text-gray-900">{stats.paidHours}<span className="text-sm font-normal text-gray-400"> hrs</span></p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs text-gray-400 uppercase">Worked Variance</p>
          <p className={`text-2xl font-bold ${parseFloat(stats.variance) < 0 ? 'text-red-600' : parseFloat(stats.variance) > 0 ? 'text-blue-600' : 'text-gray-900'}`}>
            {parseFloat(stats.variance) > 0 ? '+' : ''}{stats.variance}<span className="text-sm font-normal text-gray-400"> hrs</span>
          </p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs text-gray-400 uppercase">Approved</p>
          <p className="text-2xl font-bold text-gray-900">
            {stats.approvedCount}<span className="text-sm font-normal text-gray-400"> / {stats.workingDays}</span>
          </p>
          {missingCount > 0 && <p className="text-xs text-red-500 font-medium">{missingCount} missing</p>}
        </div>
      </div>

      {notice && <InlineNotice variant={notice.variant} className="mb-4" onDismiss={clearNotice}>{notice.content}</InlineNotice>}
      {scheduleError && <InlineNotice variant="error" className="mb-4" onDismiss={() => setScheduleError(null)} role="alert">{scheduleError}</InlineNotice>}
      {error && <InlineNotice variant="error" className="mb-4" onDismiss={() => setError(null)} role="alert">{error}</InlineNotice>}

      {/* Action buttons */}
      {canEdit && (
        <div className="flex gap-3 mb-4 print:hidden">
          <button
            className={BTN.secondary + ' ' + BTN.sm}
            onClick={handleConfirmAll}
            disabled={saving || missingCount === 0}
          >
            {saving ? 'Saving...' : `Confirm ${missingCount > 0 ? missingCount : 'All'} as Scheduled`}
          </button>
          <button
            className={BTN.primary + ' ' + BTN.sm}
            onClick={handleApproveAll}
            disabled={saving || pendingCount === 0}
          >
            {saving ? 'Saving...' : `Approve ${pendingCount} Pending`}
          </button>
        </div>
      )}

      {/* Monthly grid */}
      {loading ? (
        <LoadingState message="Loading monthly entries..." />
      ) : (
        <StickyTable className={CARD.flush}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Date</th>
                <th scope="col" className={TABLE.th}>Day</th>
                <th scope="col" className={TABLE.th}>Roster</th>
                <th scope="col" className={TABLE.th + ' text-right'}>Sched. Hrs</th>
                <th scope="col" className={TABLE.th}>Actual In</th>
                <th scope="col" className={TABLE.th}>Actual Out</th>
                <th scope="col" className={TABLE.th + ' text-right'}>Break</th>
                <th scope="col" className={TABLE.th + ' text-right'}>Payable Hrs</th>
                <th scope="col" className={TABLE.th}>Paid Adj.</th>
                <th scope="col" className={TABLE.th + ' text-right'}>Paid Hrs</th>
                <th scope="col" className={TABLE.th + ' text-right'}>Variance</th>
                <th scope="col" className={TABLE.th}>Status</th>
                {canEdit && <th scope="col" className={TABLE.th + ' print:hidden'}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.dateStr} className={`${TABLE.tr} ${rowBg(row)}`}>
                  <td className={TABLE.tdMono + ' text-xs'}>{row.dateStr.slice(5)}</td>
                  <td className={TABLE.td + ' text-xs ' + (row.dayOfWeek === 0 || row.dayOfWeek === 6 ? 'font-bold text-gray-500' : '')}>
                    {DAY_NAMES[row.dayOfWeek]}
                  </td>
                  <td className={TABLE.td}>
                    <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{row.rosterShift}</span>
                    {row.overrideReason && <span className="text-xs text-gray-400 ml-1" title={row.overrideReason}>*</span>}
                  </td>
                  <td className={TABLE.tdMono + ' text-right text-sm'}>{row.rosterHours > 0 ? row.rosterHours.toFixed(1) : '\u2014'}</td>
                  <td className={TABLE.tdMono + ' text-sm'}>{row.entry?.actual_start || row.entry?.snapped_start || '\u2014'}</td>
                  <td className={TABLE.tdMono + ' text-sm'}>{row.entry?.actual_end || row.entry?.snapped_end || '\u2014'}</td>
                  <td className={TABLE.tdMono + ' text-right text-sm'}>{row.entry ? `${row.entry.break_minutes}m` : '\u2014'}</td>
                  <td className={TABLE.tdMono + ' text-right text-sm font-medium'}>
                    {row.entry?.payable_hours != null ? row.entry.payable_hours.toFixed(1) : '\u2014'}
                  </td>
                  <td className={TABLE.td + ' text-xs'}>
                    {row.adjustment ? (
                      <div className="flex items-center gap-2">
                        <span className={row.adjustment.kind === 'annual_leave' ? BADGE.blue : BADGE.green}>
                          {row.adjustment.kind === 'annual_leave' ? 'AL' : 'Paid'}
                        </span>
                        <span className="font-mono text-gray-700">{row.adjustment.hours.toFixed(1)}h</span>
                      </div>
                    ) : '\u2014'}
                  </td>
                  <td className={TABLE.tdMono + ' text-right text-sm font-medium'}>
                    {row.paidHours != null ? row.paidHours.toFixed(1) : '\u2014'}
                  </td>
                  <td className={TABLE.tdMono + ' text-right text-sm'}>
                    {row.variance != null ? (
                      <span className={row.variance < -0.1 ? 'text-red-600' : row.variance > 0.1 ? 'text-blue-600' : 'text-gray-400'}>
                        {row.variance > 0 ? '+' : ''}{row.variance.toFixed(1)}
                      </span>
                    ) : '\u2014'}
                  </td>
                  <td className={TABLE.td}>
                    <span className={statusBadge(row) + ' text-xs'}>{statusLabel(row)}</span>
                    {row.entry?.dispute_reason && (
                      <span className="text-xs text-red-500 ml-1" title={row.entry.dispute_reason}>!</span>
                    )}
                  </td>
                  {canEdit && <td className={TABLE.td + ' print:hidden'}>{rowActions(row)}</td>}
                </tr>
              ))}
              {/* Totals row */}
              <tr className="bg-gray-100 font-semibold">
                <td className={TABLE.td} colSpan={3}>Totals</td>
                <td className={TABLE.tdMono + ' text-right'}>{stats.scheduledHours}</td>
                <td className={TABLE.td} colSpan={2}></td>
                <td className={TABLE.td}></td>
                <td className={TABLE.tdMono + ' text-right'}>{stats.actualHours}</td>
                <td className={TABLE.tdMono + ' text-right'}>{stats.paidAdjustmentHours}</td>
                <td className={TABLE.tdMono + ' text-right'}>{stats.paidHours}</td>
                <td className={TABLE.tdMono + ' text-right'}>
                  <span className={parseFloat(stats.variance) < 0 ? 'text-red-600' : parseFloat(stats.variance) > 0 ? 'text-blue-600' : ''}>
                    {parseFloat(stats.variance) > 0 ? '+' : ''}{stats.variance}
                  </span>
                </td>
                <td className={TABLE.td}>
                  <span className="text-xs text-gray-500">{stats.approvedCount}/{stats.workingDays}</span>
                </td>
                {canEdit && <td className={TABLE.td + ' print:hidden'}></td>}
              </tr>
            </tbody>
          </table>
        </StickyTable>
      )}

      {/* Approval signature line (print only) */}
      <div className="hidden print:block mt-12">
        <div className="flex justify-between">
          <div>
            <p className="text-sm font-medium mb-8">Staff Signature: ___________________________</p>
            <p className="text-sm text-gray-500">Date: _______________</p>
          </div>
          <div>
            <p className="text-sm font-medium mb-8">Manager Signature: ___________________________</p>
            <p className="text-sm text-gray-500">Date: _______________</p>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      <Modal isOpen={!!editModal} onClose={() => setEditModal(null)} title={editModal ? `${staff?.name} — ${editModal.row.dateStr}` : ''} size="lg">
          {editModal && <>
            <p className="text-sm text-gray-500 -mt-2 mb-4">
              {staff?.role} — Roster: {editModal.row.rosterShift}
              {editModal.row.entry?.status === 'disputed' && (
                <span className="ml-2 text-red-500">Disputed: {editModal.row.entry.dispute_reason}</span>
              )}
            </p>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className={INPUT.label}>Actual Start</label>
                <input type="time" className={INPUT.base} value={editForm.actual_start}
                  onChange={e => handleEditChange('actual_start', e.target.value)} />
              </div>
              <div>
                <label className={INPUT.label}>Actual End</label>
                <input type="time" className={INPUT.base} value={editForm.actual_end}
                  onChange={e => handleEditChange('actual_end', e.target.value)} />
              </div>
            </div>

            <div className="mb-4">
              <label className={INPUT.label}>Break (minutes)</label>
              <input type="number" className={INPUT.base + ' w-24'} min="0" max="120" value={editForm.break_minutes}
                onChange={e => handleEditChange('break_minutes', parseInt(e.target.value) || 0)} />
            </div>

            {editPayable != null && (
              <div className="bg-gray-50 rounded p-3 mb-4">
                <p className="text-sm font-medium text-gray-700">
                  Payable hours: {parseFloat(editPayable || 0).toFixed(2)}h
                </p>
                <p className="text-xs text-gray-500">
                  Scheduled: {editForm.scheduled_start} — {editForm.scheduled_end} ({editModal.row.rosterHours.toFixed(1)}h)
                </p>
              </div>
            )}

            <div className="mb-4">
              <label className={INPUT.label}>Notes</label>
              <input className={INPUT.base} value={editForm.notes} placeholder="Optional notes"
                onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            <div className={MODAL.footer}>
              <button className={BTN.secondary} onClick={() => setEditModal(null)}>Cancel</button>
              <button className={BTN.primary} onClick={handleSaveEntry} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>}
      </Modal>

      {/* Dispute Modal */}
      <Modal isOpen={!!disputeModal} onClose={() => setDisputeModal(null)} title="Dispute Entry">
          {disputeModal && <>
            <p className="text-sm text-gray-500 -mt-2 mb-4">
              {staff?.name} — {disputeModal.entry.date}
            </p>

            <div className="mb-4">
              <label className={INPUT.label}>Reason for dispute</label>
              <textarea
                className={INPUT.base + ' min-h-[80px]'}
                value={disputeReason}
                onChange={e => setDisputeReason(e.target.value)}
                placeholder="Describe the issue with this timesheet entry..."
                maxLength={500}
              />
              <p className="text-xs text-gray-400 mt-1">{disputeReason.length}/500</p>
            </div>

            <div className={MODAL.footer}>
              <button className={BTN.secondary} onClick={() => setDisputeModal(null)}>Cancel</button>
              <button
                className={BTN.danger}
                onClick={handleDisputeSubmit}
                disabled={saving || !disputeReason.trim()}
              >
                {saving ? 'Submitting...' : 'Dispute'}
              </button>
            </div>
          </>}
      </Modal>
      <Modal isOpen={!!adjustmentModal} onClose={() => setAdjustmentModal(null)} title="Resolve Shortfall">
          {adjustmentModal && <>
            <p className="text-sm text-gray-500 -mt-2 mb-4">
              {staff?.name} â€” {adjustmentModal.row.dateStr}
            </p>

            <div className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-600 space-y-1 mb-4">
              <div><span className="font-medium text-gray-800">Roster:</span> {adjustmentModal.row.rosterShift} ({adjustmentModal.row.rosterHours.toFixed(1)}h)</div>
              <div><span className="font-medium text-gray-800">Worked:</span> {adjustmentModal.row.entry?.payable_hours?.toFixed(1) || '0.0'}h</div>
              <div><span className="font-medium text-gray-800">Shortfall:</span> {(adjustmentModal.row.shortfallHours || 0).toFixed(1)}h</div>
            </div>

            <div className="space-y-4">
              <div>
                <label className={INPUT.label} htmlFor="shortfall-adjustment-kind">How should the shortfall be handled?</label>
                <select
                  id="shortfall-adjustment-kind"
                  className={INPUT.select}
                  value={adjustmentForm.kind}
                  onChange={e => setAdjustmentForm(current => ({ ...current, kind: e.target.value }))}
                >
                  <option value="annual_leave">Use annual leave hours</option>
                  <option value="paid_authorised_absence">Pay authorised absence hours</option>
                </select>
              </div>

              <div>
                <label className={INPUT.label} htmlFor="shortfall-adjustment-hours">Hours to apply</label>
                <input
                  id="shortfall-adjustment-hours"
                  type="number"
                  min="0.25"
                  step="0.25"
                  max={adjustmentModal.row.shortfallHours || undefined}
                  className={INPUT.base}
                  value={adjustmentForm.hours}
                  onChange={e => setAdjustmentForm(current => ({ ...current, hours: e.target.value }))}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Maximum available on this row: {(adjustmentModal.row.shortfallHours || 0).toFixed(1)}h
                </p>
              </div>

              {adjustmentForm.kind === 'annual_leave' && adjustmentAccrual && (
                <div className={`rounded-xl px-3 py-2 text-xs ${adjustmentAccrual.remainingHours <= 0 ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
                  {adjustmentAccrual.missingContractHours
                    ? 'Contract hours must be set before hourly annual leave can be used.'
                    : `Earned leave available for ${adjustmentModal.row.dateStr}: ${adjustmentAccrual.remainingHours.toFixed(1)}h`}
                </div>
              )}

              <div>
                <label className={INPUT.label} htmlFor="shortfall-adjustment-note">Note</label>
                <input
                  id="shortfall-adjustment-note"
                  className={INPUT.base}
                  value={adjustmentForm.note}
                  onChange={e => setAdjustmentForm(current => ({ ...current, note: e.target.value }))}
                  placeholder="Optional explanation for payroll history"
                />
              </div>
            </div>

            <div className={MODAL.footer}>
              {adjustmentModal.row.adjustment && (
                <button className={BTN.danger} onClick={handleDeleteAdjustment} disabled={saving}>
                  {saving ? 'Removing...' : 'Remove'}
                </button>
              )}
              <button className={BTN.secondary} onClick={() => setAdjustmentModal(null)}>Cancel</button>
              <button className={BTN.primary} onClick={handleSaveAdjustment} disabled={saving}>
                {saving ? 'Saving...' : adjustmentModal.row.adjustment ? 'Update' : 'Apply'}
              </button>
            </div>
          </>}
      </Modal>
    </div>
  );
}
