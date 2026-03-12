import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import {
  getTimesheets, upsertTimesheet, approveTimesheet, bulkApproveTimesheets,
  getCurrentHome, getSchedulingData, } from '../lib/api.js';
import { getStaffForDay, formatDate, addDays } from '../lib/rotation.js';
import { snapToShift, calculatePayableHours } from '../lib/payroll.js';
import useDirtyGuard from '../hooks/useDirtyGuard';
import { useData } from '../contexts/DataContext.jsx';

const STATUS_BADGE = {
  pending:  BADGE.amber,
  approved: BADGE.green,
  disputed: BADGE.red,
  locked:   BADGE.gray,
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function TimesheetManager() {
  const navigate = useNavigate();
  const homeSlug = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('payroll');

  const [schedData, setSchedData] = useState(null);
  useEffect(() => {
    const h = getCurrentHome();
    if (!h) return;
    getSchedulingData(h).then(setSchedData).catch(e => setError(e.message || 'Failed to load'));
  }, []);

  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [entries, setEntries]           = useState([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [editModal, setEditModal]       = useState(null); // { staff, entry? }
  const [editForm, setEditForm]         = useState({});
  const [saving, setSaving]             = useState(false);
  useDirtyGuard(!!editModal);
  const snapConfig = useMemo(() => ({
    enabled: schedData?.config?.snap_enabled ?? true,
    window:  schedData?.config?.snap_window_minutes ?? 15,
  }), [schedData]);

  // Staff scheduled for the selected date (from rota)
  const scheduledStaff = useMemo(() => {
    if (!schedData?.staff) return [];
    const staffForDay = getStaffForDay(schedData.staff, selectedDate, schedData?.overrides || {}, schedData?.config);
    return staffForDay.filter(s => s.shift !== 'OFF' && s.shift !== 'AVL' && s.id && !s.id.startsWith('ag-'));
  }, [schedData, selectedDate]);

  const loadEntries = useCallback(async () => {
    if (!homeSlug) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getTimesheets(homeSlug, selectedDate);
      setEntries(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug, selectedDate]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  // Merge scheduled staff with existing timesheet entries
  const rows = useMemo(() => {
    const entryMap = Object.fromEntries(entries.map(e => [e.staff_id, e]));
    return scheduledStaff.map(s => {
      const entry = entryMap[s.id] || null;
      const shiftStart = getShiftStart(s.shift, schedData?.config);
      const shiftEnd   = getShiftEnd(s.shift, schedData?.config);
      return { staff: s, entry, shiftStart, shiftEnd };
    });
  }, [scheduledStaff, entries, schedData]);

  // Summary stats
  const stats = useMemo(() => {
    const approved  = entries.filter(e => e.status === 'approved').length;
    const pending   = entries.filter(e => e.status === 'pending').length;
    const totalMins = entries.reduce((s, e) => s + (e.snap_minutes_saved || 0), 0);
    const hourly    = 12.21; // NLW reference
    return { approved, pending, totalMins, snapSavingEst: Math.round(totalMins / 60 * hourly * 100) / 100 };
  }, [entries]);

  function openEdit(row) {
    const { staff, entry, shiftStart, shiftEnd } = row;
    setEditForm({
      staff_id:        staff.id,
      date:            selectedDate,
      scheduled_start: shiftStart,
      scheduled_end:   shiftEnd,
      actual_start:    entry?.actual_start || shiftStart || '',
      actual_end:      entry?.actual_end   || shiftEnd   || '',
      break_minutes:   entry?.break_minutes ?? 30,
      notes:           entry?.notes || '',
    });
    setEditModal({ staff, entry });
  }

  function handleActualChange(field, value) {
    setEditForm(f => {
      const updated = { ...f, [field]: value };
      // Auto-apply snap logic
      const snapStart = snapToShift(updated.scheduled_start, updated.actual_start, snapConfig.window, snapConfig.enabled);
      const snapEnd   = snapToShift(updated.scheduled_end,   updated.actual_end,   snapConfig.window, snapConfig.enabled);
      updated.snapped_start       = snapStart.snapped;
      updated.snapped_end         = snapEnd.snapped;
      updated.snap_applied        = snapStart.applied || snapEnd.applied;
      updated.snap_minutes_saved  = snapStart.savedMinutes + snapEnd.savedMinutes;
      updated.payable_hours       = calculatePayableHours(snapStart.snapped, snapEnd.snapped, updated.break_minutes, updated.date || selectedDate);
      return updated;
    });
  }

  async function handleSaveEntry() {
    setSaving(true);
    try {
      // Recalculate snap + hours on save (defensive)
      const snapStart = snapToShift(editForm.scheduled_start, editForm.actual_start, snapConfig.window, snapConfig.enabled);
      const snapEnd   = snapToShift(editForm.scheduled_end, editForm.actual_end, snapConfig.window, snapConfig.enabled);
      const payable   = calculatePayableHours(snapStart.snapped, snapEnd.snapped, editForm.break_minutes, editForm.date || selectedDate);

      await upsertTimesheet(homeSlug, {
        ...editForm,
        snapped_start:      snapStart.snapped,
        snapped_end:        snapEnd.snapped,
        snap_applied:       snapStart.applied || snapEnd.applied,
        snap_minutes_saved: snapStart.savedMinutes + snapEnd.savedMinutes,
        payable_hours:      payable,
        status:             editModal.entry?.status === 'locked' ? 'locked' : 'pending',
      });
      setEditModal(null);
      await loadEntries();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove(entry) {
    setSaving(true);
    try {
      await approveTimesheet(homeSlug, entry.id);
      await loadEntries();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkApprove() {
    setSaving(true);
    try {
      await bulkApproveTimesheets(homeSlug, selectedDate);
      await loadEntries();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmAll() {
    // Create pending entries for all scheduled staff who don't have one yet
    setSaving(true);
    try {
      const entryMap = Object.fromEntries(entries.map(e => [e.staff_id, e]));
      const missing  = rows.filter(r => !entryMap[r.staff.id]);
      await Promise.all(missing.map(r => {
        const start = r.shiftStart || '';
        const end   = r.shiftEnd || '';
        const snap  = snapToShift(start, start, snapConfig.window, snapConfig.enabled);
        const snapE = snapToShift(end, end, snapConfig.window, snapConfig.enabled);
        return upsertTimesheet(homeSlug, {
          staff_id:           r.staff.id,
          date:               selectedDate,
          scheduled_start:    start,
          scheduled_end:      end,
          actual_start:       start,
          actual_end:         end,
          snapped_start:      snap.snapped,
          snapped_end:        snapE.snapped,
          snap_applied:       false,
          snap_minutes_saved: 0,
          break_minutes:      30,
          payable_hours:      calculatePayableHours(start, end, 30, selectedDate),
          status:             'pending',
          notes:              'Confirmed as scheduled',
        });
      }));
      await loadEntries();
    } catch (e) {
      setError(e.message);
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
          <button className={BTN.secondary} onClick={() => setSelectedDate(formatDate(addDays(selectedDate, -1)))}>&larr;</button>
          <input type="date" className={INPUT.sm} style={{ width: '160px' }} value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)} />
          <button className={BTN.secondary} onClick={() => setSelectedDate(formatDate(addDays(selectedDate, 1)))}>&rarr;</button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
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
          <p className="text-xs text-gray-400">≈ £{stats.snapSavingEst.toFixed(2)}</p>
        </div>
      </div>

      {/* Bulk Actions */}
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

      {/* Main Table */}
      <div className={CARD.flush}>
        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">Loading timesheets…</div>
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
                {rows.length === 0 ? (
                  <tr><td colSpan={canEdit ? 9 : 8} className={TABLE.empty}>No staff scheduled for this date.</td></tr>
                ) : rows.map(row => {
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
                      <td className={TABLE.td + ' font-mono text-sm text-gray-500'}>
                        {row.shiftStart || '—'} – {row.shiftEnd || '—'}
                      </td>
                      <td className={TABLE.td + ' font-mono text-sm'}>
                        {entry ? `${entry.actual_start || '—'} – ${entry.actual_end || '—'}` : '—'}
                      </td>
                      <td className={TABLE.td + ' font-mono text-sm'}>
                        {entry?.snap_applied ? (
                          <span className="text-emerald-600">{entry.snapped_start} – {entry.snapped_end}</span>
                        ) : entry ? `${entry.snapped_start || '—'} – ${entry.snapped_end || '—'}` : '—'}
                      </td>
                      <td className={TABLE.td}>
                        {entry?.snap_applied
                          ? <span className="text-emerald-600 font-medium">{entry.snap_minutes_saved}m</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className={`${TABLE.td} font-mono font-semibold`}>
                        {entry?.payable_hours != null ? `${parseFloat(entry.payable_hours).toFixed(2)}h` : '—'}
                      </td>
                      <td className={TABLE.td}>
                        {entry
                          ? <span className={STATUS_BADGE[entry.status] || BADGE.gray}>{entry.status}</span>
                          : <span className="text-xs text-gray-400">not recorded</span>}
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

      {/* Edit Modal */}
      <Modal isOpen={!!editModal} onClose={() => setEditModal(null)} title={editModal ? `${editModal.staff.name} — ${selectedDate}` : ''} size="lg">
          {editModal && <>
            <p className="text-sm text-gray-500 -mt-2 mb-4">{editModal.staff.role} · Shift: {editModal.staff.shift}</p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={INPUT.label}>Actual Start</label>
                  <input type="time" className={INPUT.base} value={editForm.actual_start}
                    onChange={e => handleActualChange('actual_start', e.target.value)} />
                  {editForm.snap_applied && editForm.snapped_start !== editForm.actual_start && (
                    <p className="text-xs text-emerald-600 mt-1">
                      Snapped to {editForm.snapped_start} — saves {editForm.snap_minutes_saved}min
                    </p>
                  )}
                </div>
                <div>
                  <label className={INPUT.label}>Actual End</label>
                  <input type="time" className={INPUT.base} value={editForm.actual_end}
                    onChange={e => handleActualChange('actual_end', e.target.value)} />
                </div>
              </div>

              <div>
                <label className={INPUT.label}>Break (minutes)</label>
                <input type="number" className={INPUT.base} min="0" max="120" value={editForm.break_minutes}
                  onChange={e => handleActualChange('break_minutes', parseInt(e.target.value, 10) || 0)} />
              </div>

              {editForm.payable_hours != null && (
                <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
                  <p className="text-sm font-semibold text-blue-800">
                    Payable hours: {parseFloat(editForm.payable_hours || 0).toFixed(2)}h
                  </p>
                  <p className="text-xs text-blue-600 mt-0.5">
                    Using snapped times: {editForm.snapped_start} – {editForm.snapped_end}, minus {editForm.break_minutes}min break
                  </p>
                </div>
              )}

              <div>
                <label className={INPUT.label}>Notes</label>
                <input className={INPUT.sm} value={editForm.notes}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional notes" />
              </div>
            </div>

            <div className={MODAL.footer}>
              <button className={BTN.secondary} onClick={() => setEditModal(null)}>Cancel</button>
              <button className={BTN.primary} onClick={handleSaveEntry} disabled={saving}>
                {saving ? 'Saving…' : 'Save Entry'}
              </button>
            </div>
          </>}
      </Modal>
    </div>
  );
}

// ── Shift Time Helpers ────────────────────────────────────────────────────────

function getShiftStart(shift, config) {
  const shifts = config?.shifts || {};
  switch (shift) {
    case 'E': case 'OC-E': return shifts.E?.start || '07:00';
    case 'L': case 'OC-L': return shifts.L?.start || '13:00';
    case 'EL': case 'OC-EL': case 'BH-D': return shifts.EL?.start || shifts.E?.start || '07:00';
    case 'N': case 'OC-N': case 'BH-N': return shifts.N?.start || '19:30';
    default: return null;
  }
}

function getShiftEnd(shift, config) {
  const shifts = config?.shifts || {};
  switch (shift) {
    case 'E': case 'OC-E': return shifts.E?.end || '13:00';
    case 'L': case 'OC-L': return shifts.L?.end || '19:00';
    case 'EL': case 'OC-EL': case 'BH-D': return shifts.EL?.end || shifts.L?.end || '19:00';
    case 'N': case 'OC-N': case 'BH-N': return shifts.N?.end || '07:30';
    default: return null;
  }
}
