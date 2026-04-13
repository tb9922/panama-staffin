import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import { todayLocalISO } from '../lib/localDates.js';
import {
  getTimesheets,
  upsertTimesheet,
  approveTimesheet,
  bulkApproveTimesheets,
  getCurrentHome,
  getSchedulingData,
} from '../lib/api.js';
import { getStaffForDay, formatDate, addDays } from '../lib/rotation.js';
import { snapToShift, calculatePayableHours } from '../lib/payroll.js';
import useDirtyGuard from '../hooks/useDirtyGuard';
import useTransientNotice from '../hooks/useTransientNotice.js';
import { useData } from '../contexts/DataContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { getMinimumWageRate } from '../../shared/nmw.js';

const STATUS_BADGE = {
  pending: BADGE.amber,
  approved: BADGE.green,
  disputed: BADGE.red,
  locked: BADGE.gray,
};

function todayStr() {
  return todayLocalISO();
}

function normalizeTimesheetError(message) {
  if (!message) return 'Something went wrong.';
  if (/conflict|version|modified by another user/i.test(message)) {
    return 'This timesheet was modified by another user. Please reopen it to get the latest version.';
  }
  return message;
}

export default function TimesheetManager() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const homeSlug = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('payroll');
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const { showToast } = useToast();

  const [schedData, setSchedData] = useState(null);
  const [selectedDate, setSelectedDate] = useState(() => searchParams.get('date') || todayStr());
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  useDirtyGuard(!!editModal);

  const snapConfig = useMemo(() => ({
    enabled: schedData?.config?.snap_enabled ?? true,
    window: schedData?.config?.snap_window_minutes ?? 15,
  }), [schedData]);

  useEffect(() => {
    if (!homeSlug) return;
    let cancelled = false;
    getSchedulingData(homeSlug)
      .then((data) => {
        if (!cancelled) setSchedData(data);
      })
      .catch((err) => {
        if (!cancelled) setError(normalizeTimesheetError(err.message || 'Failed to load rota data.'));
      });
    return () => { cancelled = true; };
  }, [homeSlug]);

  const loadEntries = useCallback(async () => {
    if (!homeSlug) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getTimesheets(homeSlug, selectedDate);
      setEntries(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(normalizeTimesheetError(err.message));
    } finally {
      setLoading(false);
    }
  }, [homeSlug, selectedDate]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    const queryDate = searchParams.get('date');
    if (queryDate && queryDate !== selectedDate) {
      setSelectedDate(queryDate);
    }
  }, [searchParams, selectedDate]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (selectedDate) next.set('date', selectedDate);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, selectedDate, setSearchParams]);

  const scheduledStaff = useMemo(() => {
    if (!schedData?.staff) return [];
    const staffForDay = getStaffForDay(
      schedData.staff,
      selectedDate,
      schedData?.overrides || {},
      schedData?.config,
    );
    return staffForDay.filter(
      (staff) => staff.shift !== 'OFF' && staff.shift !== 'AVL' && staff.id && !staff.id.startsWith('ag-'),
    );
  }, [schedData, selectedDate]);

  const rows = useMemo(() => {
    const entryMap = Object.fromEntries(entries.map((entry) => [entry.staff_id, entry]));
    return scheduledStaff.map((staff) => {
      const entry = entryMap[staff.id] || null;
      const shiftStart = getShiftStart(staff.shift, schedData?.config);
      const shiftEnd = getShiftEnd(staff.shift, schedData?.config);
      return { staff, entry, shiftStart, shiftEnd };
    });
  }, [entries, schedData, scheduledStaff]);

  const stats = useMemo(() => {
    const approved = entries.filter((entry) => entry.status === 'approved').length;
    const pending = entries.filter((entry) => entry.status === 'pending').length;
    const totalMins = entries.reduce((sum, entry) => sum + (entry.snap_minutes_saved || 0), 0);
    const configuredRate = Number(schedData?.config?.nlw_rate);
    const fallbackRate = getMinimumWageRate(null, schedData?.config, selectedDate).rate;
    const hourly = Number.isFinite(configuredRate) && configuredRate > 0 ? configuredRate : fallbackRate;
    return {
      approved,
      pending,
      totalMins,
      snapSavingEst: Math.round((totalMins / 60) * hourly * 100) / 100,
    };
  }, [entries, schedData, selectedDate]);

  function openEdit(row) {
    const { staff, entry, shiftStart, shiftEnd } = row;
    setEditForm({
      staff_id: staff.id,
      date: selectedDate,
      scheduled_start: shiftStart,
      scheduled_end: shiftEnd,
      actual_start: entry?.actual_start || shiftStart || '',
      actual_end: entry?.actual_end || shiftEnd || '',
      break_minutes: entry?.break_minutes ?? 30,
      notes: entry?.notes || '',
    });
    setEditModal({ staff, entry });
  }

  function handleActualChange(field, value) {
    setEditForm((current) => {
      const updated = { ...current, [field]: value };
      const snapStart = snapToShift(updated.scheduled_start, updated.actual_start, snapConfig.window, snapConfig.enabled);
      const snapEnd = snapToShift(updated.scheduled_end, updated.actual_end, snapConfig.window, snapConfig.enabled);
      updated.snapped_start = snapStart.snapped;
      updated.snapped_end = snapEnd.snapped;
      updated.snap_applied = snapStart.applied || snapEnd.applied;
      updated.snap_minutes_saved = snapStart.savedMinutes + snapEnd.savedMinutes;
      updated.payable_hours = calculatePayableHours(
        snapStart.snapped,
        snapEnd.snapped,
        updated.break_minutes,
        updated.date || selectedDate,
      );
      return updated;
    });
  }

  async function handleSaveEntry() {
    if (!editModal) return;
    setSaving(true);
    setError(null);
    try {
      const snapStart = snapToShift(editForm.scheduled_start, editForm.actual_start, snapConfig.window, snapConfig.enabled);
      const snapEnd = snapToShift(editForm.scheduled_end, editForm.actual_end, snapConfig.window, snapConfig.enabled);
      const payable = calculatePayableHours(
        snapStart.snapped,
        snapEnd.snapped,
        editForm.break_minutes,
        editForm.date || selectedDate,
      );

      await upsertTimesheet(homeSlug, {
        ...editForm,
        snapped_start: snapStart.snapped,
        snapped_end: snapEnd.snapped,
        snap_applied: snapStart.applied || snapEnd.applied,
        snap_minutes_saved: snapStart.savedMinutes + snapEnd.savedMinutes,
        payable_hours: payable,
        status: editModal.entry?.status === 'locked' ? 'locked' : 'pending',
      });

      showNotice(editModal.entry ? 'Timesheet entry updated.' : 'Timesheet entry recorded.');
      showToast({
        title: editModal.entry ? 'Timesheet updated' : 'Timesheet recorded',
        message: editModal.staff.name,
      });
      setEditModal(null);
      await loadEntries();
    } catch (err) {
      setError(normalizeTimesheetError(err.message));
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove(entry) {
    setSaving(true);
    setError(null);
    try {
      await approveTimesheet(homeSlug, entry.id);
      showNotice('Timesheet approved.');
      showToast({ title: 'Timesheet approved', message: entry.staff_id });
      await loadEntries();
    } catch (err) {
      setError(normalizeTimesheetError(err.message));
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkApprove() {
    setSaving(true);
    setError(null);
    try {
      await bulkApproveTimesheets(homeSlug, selectedDate);
      showNotice(`All pending entries for ${selectedDate} approved.`);
      showToast({ title: 'Pending entries approved', message: selectedDate });
      await loadEntries();
    } catch (err) {
      setError(normalizeTimesheetError(err.message));
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmAll() {
    setSaving(true);
    setError(null);
    try {
      const entryMap = Object.fromEntries(entries.map((entry) => [entry.staff_id, entry]));
      const missing = rows.filter((row) => !entryMap[row.staff.id]);
      await Promise.all(missing.map((row) => {
        const start = row.shiftStart || '';
        const end = row.shiftEnd || '';
        const snapStart = snapToShift(start, start, snapConfig.window, snapConfig.enabled);
        const snapEnd = snapToShift(end, end, snapConfig.window, snapConfig.enabled);
        return upsertTimesheet(homeSlug, {
          staff_id: row.staff.id,
          date: selectedDate,
          scheduled_start: start,
          scheduled_end: end,
          actual_start: start,
          actual_end: end,
          snapped_start: snapStart.snapped,
          snapped_end: snapEnd.snapped,
          snap_applied: false,
          snap_minutes_saved: 0,
          break_minutes: 30,
          payable_hours: calculatePayableHours(start, end, 30, selectedDate),
          status: 'pending',
          notes: 'Confirmed as scheduled',
        });
      }));

      showNotice(
        missing.length
          ? `${missing.length} shift${missing.length !== 1 ? 's' : ''} confirmed as scheduled.`
          : 'All scheduled staff already have timesheet entries.',
      );
      showToast({
        title: 'Schedule confirmed',
        message: missing.length ? `${missing.length} entries created` : 'No missing entries',
      });
      await loadEntries();
    } catch (err) {
      setError(normalizeTimesheetError(err.message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Timesheets</h1>
          <p className={PAGE.subtitle}>Record actual attendance with snap-to-shift to prevent early clock-in waste</p>
        </div>
        <div className="flex items-center gap-3">
          <button className={BTN.secondary} onClick={() => setSelectedDate(formatDate(addDays(selectedDate, -1)))} aria-label="Previous day">&larr;</button>
          <input
            type="date"
            className={INPUT.sm}
            style={{ width: '160px' }}
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
          <button className={BTN.secondary} onClick={() => setSelectedDate(formatDate(addDays(selectedDate, 1)))} aria-label="Next day">&rarr;</button>
        </div>
      </div>

      {notice && (
        <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">
          {notice.content}
        </InlineNotice>
      )}

      {error && (
        <ErrorState
          title="Some timesheet actions need attention"
          message={error}
          onRetry={() => void loadEntries()}
          className="mb-4"
        />
      )}

      <div className="grid grid-cols-2 gap-4 mb-6 md:grid-cols-4">
        <div className={CARD.padded}>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Scheduled</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{scheduledStaff.length}</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Approved</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{stats.approved}</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Pending</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{stats.pending}</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Snap Savings</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{stats.totalMins}min</p>
          <p className="text-xs text-gray-400">Approximately GBP {stats.snapSavingEst.toFixed(2)} at the current minimum wage rate.</p>
        </div>
      </div>

      <div className={`${CARD.padded} mb-4`}>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Payroll Cross-check</h2>
            <p className="mt-1 text-sm text-gray-500">
              Confirm actual hours here before approving payroll. Snap-to-shift trims early starts back to the planned rota window.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => navigate('/payroll')} className={`${BTN.secondary} ${BTN.sm}`}>
              Payroll Runs
            </button>
            <button type="button" onClick={() => navigate('/payroll/rates')} className={`${BTN.secondary} ${BTN.sm}`}>
              Pay Rates
            </button>
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="flex gap-3 mb-4">
          <button className={BTN.secondary} onClick={handleConfirmAll} disabled={saving}>
            Confirm All as Scheduled
          </button>
          <button className={BTN.success} onClick={handleBulkApprove} disabled={saving}>
            Approve All Pending
          </button>
        </div>
      )}

      <div className={CARD.flush}>
        {loading ? (
          <LoadingState message="Loading timesheets..." />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No staff scheduled for this date"
            description="Pick another day or publish the rota before recording actual attendance."
          />
        ) : (
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th scope="col" className={TABLE.th}>Staff</th>
                  <th scope="col" className={TABLE.th}>Shift</th>
                  <th scope="col" className={TABLE.th}>Scheduled</th>
                  <th scope="col" className={TABLE.th}>Actual</th>
                  <th scope="col" className={TABLE.th}>Snapped</th>
                  <th scope="col" className={TABLE.th}>Saved</th>
                  <th scope="col" className={TABLE.th}>Payable Hrs</th>
                  <th scope="col" className={TABLE.th}>Status</th>
                  {canEdit && <th scope="col" className={TABLE.th}></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { staff, entry } = row;
                  return (
                    <tr key={staff.id} className={TABLE.tr}>
                      <td className={TABLE.td}>
                        <p className="font-medium text-blue-600 hover:text-blue-800 cursor-pointer" onClick={() => navigate(`/payroll/monthly-timesheet/${staff.id}`)}>{staff.name}</p>
                        <p className="text-xs text-gray-400">{staff.role}</p>
                      </td>
                      <td className={TABLE.td}>
                        <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{staff.shift}</span>
                      </td>
                      <td className={`${TABLE.td} font-mono text-sm text-gray-500`}>
                        {row.shiftStart || '-'} to {row.shiftEnd || '-'}
                      </td>
                      <td className={`${TABLE.td} font-mono text-sm`}>
                        {entry ? `${entry.actual_start || '-'} to ${entry.actual_end || '-'}` : '-'}
                      </td>
                      <td className={`${TABLE.td} font-mono text-sm`}>
                        {entry?.snap_applied ? (
                          <span className="text-emerald-600">{entry.snapped_start} to {entry.snapped_end}</span>
                        ) : entry ? `${entry.snapped_start || '-'} to ${entry.snapped_end || '-'}` : '-'}
                      </td>
                      <td className={TABLE.td}>
                        {entry?.snap_applied ? (
                          <span className="text-emerald-600 font-medium">{entry.snap_minutes_saved}m</span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                      <td className={`${TABLE.td} font-mono font-semibold`}>
                        {entry?.payable_hours != null ? `${parseFloat(entry.payable_hours).toFixed(2)}h` : '-'}
                      </td>
                      <td className={TABLE.td}>
                        {entry ? (
                          <span className={STATUS_BADGE[entry.status] || BADGE.gray}>{entry.status}</span>
                        ) : (
                          <span className="text-xs text-gray-400">not recorded</span>
                        )}
                      </td>
                      {canEdit && (
                        <td className={TABLE.td}>
                          <div className="flex gap-2">
                            <button className={`${BTN.secondary} ${BTN.xs}`} onClick={() => openEdit(row)}>
                              {entry ? 'Edit' : 'Record'}
                            </button>
                            {entry && entry.status === 'pending' && (
                              <button className={`${BTN.success} ${BTN.xs}`} onClick={() => handleApprove(entry)} disabled={saving}>
                                Approve
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        isOpen={!!editModal}
        onClose={() => setEditModal(null)}
        title={editModal ? `${editModal.staff.name} - ${selectedDate}` : ''}
        size="lg"
      >
        {editModal && (
          <>
            <p className="text-sm text-gray-500 -mt-2 mb-4">{editModal.staff.role} · Shift: {editModal.staff.shift}</p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={INPUT.label}>Actual Start</label>
                  <input
                    type="time"
                    className={INPUT.base}
                    value={editForm.actual_start}
                    onChange={(event) => handleActualChange('actual_start', event.target.value)}
                  />
                  {editForm.snap_applied && editForm.snapped_start !== editForm.actual_start && (
                    <p className="text-xs text-emerald-600 mt-1">
                      Snapped to {editForm.snapped_start} - saves {editForm.snap_minutes_saved}min
                    </p>
                  )}
                </div>
                <div>
                  <label className={INPUT.label}>Actual End</label>
                  <input
                    type="time"
                    className={INPUT.base}
                    value={editForm.actual_end}
                    onChange={(event) => handleActualChange('actual_end', event.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className={INPUT.label}>Break (minutes)</label>
                <input
                  type="number"
                  className={INPUT.base}
                  min="0"
                  max="120"
                  value={editForm.break_minutes}
                  onChange={(event) => handleActualChange('break_minutes', parseInt(event.target.value, 10) || 0)}
                />
              </div>

              {editForm.payable_hours != null && (
                <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
                  <p className="text-sm font-semibold text-blue-800">
                    Payable hours: {parseFloat(editForm.payable_hours || 0).toFixed(2)}h
                  </p>
                  <p className="text-xs text-blue-600 mt-0.5">
                    Using snapped times: {editForm.snapped_start} to {editForm.snapped_end}, minus {editForm.break_minutes}min break.
                  </p>
                </div>
              )}

              <div>
                <label className={INPUT.label}>Notes</label>
                <input
                  className={INPUT.sm}
                  value={editForm.notes}
                  onChange={(event) => setEditForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Optional notes"
                />
              </div>
            </div>

            <div className={MODAL.footer}>
              <button className={BTN.secondary} onClick={() => setEditModal(null)}>Cancel</button>
              <button className={BTN.primary} onClick={handleSaveEntry} disabled={saving}>
                {saving ? 'Saving...' : 'Save Entry'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function getShiftStart(shift, config) {
  const shifts = config?.shifts || {};
  switch (shift) {
    case 'E':
    case 'OC-E':
      return shifts.E?.start || '07:00';
    case 'L':
    case 'OC-L':
      return shifts.L?.start || '13:00';
    case 'EL':
    case 'OC-EL':
    case 'BH-D':
      return shifts.EL?.start || shifts.E?.start || '07:00';
    case 'N':
    case 'OC-N':
    case 'BH-N':
      return shifts.N?.start || '19:30';
    default:
      return null;
  }
}

function getShiftEnd(shift, config) {
  const shifts = config?.shifts || {};
  switch (shift) {
    case 'E':
    case 'OC-E':
      return shifts.E?.end || '13:00';
    case 'L':
    case 'OC-L':
      return shifts.L?.end || '19:00';
    case 'EL':
    case 'OC-EL':
    case 'BH-D':
      return shifts.EL?.end || shifts.L?.end || '19:00';
    case 'N':
    case 'OC-N':
    case 'BH-N':
      return shifts.N?.end || '07:30';
    default:
      return null;
  }
}
