import { useState, useMemo, useCallback, useEffect } from 'react';
import { formatDate, addDays, isCareRole, getScheduledShift, getCycleDay, parseDate, countALOnDate, getALDeductionHours } from '../lib/rotation.js';
import { getLeaveYear, getAccrualSummary } from '../lib/accrual.js';
import { generateCoverPlan } from '../lib/rotationAnalysis.js';
import { CARD, TABLE, INPUT, BTN, BADGE } from '../lib/design.js';
import { useLiveDate } from '../hooks/useLiveDate.js';
import {
  getCurrentHome,
  getSchedulingData,
  bulkUpsertOverrides,
  deleteOverride,
} from '../lib/api.js';
import { useData } from '../contexts/DataContext.jsx';
import useSchedulingEditLock from '../hooks/useSchedulingEditLock.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import OverrideRequestReview from '../components/staff/OverrideRequestReview.jsx';
import CoverPlanModal from '../components/scheduling/CoverPlanModal.jsx';
import { useConfirm } from '../hooks/useConfirm.jsx';

function getMonthDates(year, month) {
  const dates = [];
  const d = new Date(Date.UTC(year, month, 1));
  while (d.getUTCMonth() === month) {
    dates.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

function fmtDate(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const BOOKING_FIELD_IDS = {
  staff: 'annual-leave-book-staff',
  start: 'annual-leave-book-start',
  end: 'annual-leave-book-end',
};

function getCenteredSchedulingRange(date, radiusDays = 200) {
  return {
    from: formatDate(addDays(date, -radiusDays)),
    to: formatDate(addDays(date, radiusDays)),
  };
}

export default function AnnualLeave() {
  const { canWrite, homeRole } = useData();
  const canEdit = canWrite('scheduling');
  const { confirm, ConfirmDialog } = useConfirm();
  const [schedData, setSchedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [filterTeam, setFilterTeam] = useState('All');
  const [bookingStaff, setBookingStaff] = useState('');
  const [bookingStart, setBookingStart] = useState('');
  const [bookingEnd, setBookingEnd] = useState('');
  const [bookingError, setBookingError] = useState(null);
  const [bookingMsg, setBookingMsg] = useState(null);
  const [coverPlan, setCoverPlan] = useState(null);
  const [coverPlanSaving, setCoverPlanSaving] = useState(false);

  const TEAMS = ['Day A', 'Day B', 'Night A', 'Night B', 'Float'];

  const homeSlug = getCurrentHome();
  const today = useLiveDate();
  const isOwnDataAnnualLeave = homeRole === 'staff_member';
  const loadData = useCallback(async () => {
    if (!homeSlug) {
      setSchedData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const { from, to } = getCenteredSchedulingRange(parseDate(today));
    setLoading(true);
    setError(null);
    try {
      setSchedData(await getSchedulingData(homeSlug, { from, to }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug, today]);

  useEffect(() => { loadData(); }, [loadData]);

  const activeStaff = useMemo(() => {
    if (!schedData) return [];
    return schedData.staff.filter(s => s.active !== false && isCareRole(s.role));
  }, [schedData]);

  const filtered = useMemo(() => {
    if (filterTeam === 'All') return activeStaff;
    return activeStaff.filter(s => s.team === filterTeam);
  }, [activeStaff, filterTeam]);

  // Accrual calculations for all active staff
  const accruals = useMemo(() => {
    if (!schedData) return new Map();
    return getAccrualSummary(activeStaff, schedData.config, schedData.overrides, today, schedData.hour_adjustments || {});
  }, [schedData, activeStaff, today]);

  // Leave year for display
  const leaveYear = useMemo(() => {
    if (!schedData) return null;
    return getLeaveYear(today, schedData.config.leave_year_start);
  }, [schedData, today]);

  const hasEditLock = Boolean(schedData?.config?.edit_lock_enabled);
  const {
    showLockPrompt,
    lockPin,
    lockError,
    updateLockPin,
    dismissLockPrompt,
    attemptUnlock,
    isDateLocked,
    getEditLockOptions,
    requestUnlock,
    handleLockedError,
  } = useSchedulingEditLock({ homeSlug, hasEditLock, today });

  // Book AL — only on scheduled working days, enforces accrued entitlement in hours
  async function bookAL() {
    if (saving) return;
    if (!bookingStaff || !bookingStart || !bookingEnd || !schedData) return;
    const start = parseDate(bookingStart);
    const end = parseDate(bookingEnd);
    if (end < start) return;

    const staff = schedData.staff.find(s => s.id === bookingStaff);
    if (!staff) return;

    const accrual = accruals.get(bookingStaff);
    if (!accrual) return;

    setBookingError(null);
    setBookingMsg(null);

    if (accrual.missingContractHours) {
      setBookingError(`${staff.name} has no contract hours set. Set contract hours in Staff Database before booking AL.`);
      return;
    }

    if (accrual.remainingHours <= 0) {
      setBookingError(`${staff.name} has no earned leave left (${accrual.accruedHours.toFixed(1)}h earned, ${accrual.usedHours.toFixed(1)}h used). No more leave can be booked.`);
      return;
    }

    const localOverrides = JSON.parse(JSON.stringify(schedData.overrides));
    const toBook = [];
    const issues = [];
    let skippedOff = 0;
    let hoursBooked = 0;
    let d = new Date(start);
    while (d <= end) {
      const dateKey = formatDate(d);
      const cycleDay = getCycleDay(d, schedData.config.cycle_start_date);
      const scheduled = getScheduledShift(staff, cycleDay, d, schedData.config);
      if (scheduled === 'OFF') {
        skippedOff++;
        d = addDays(d, 1);
        continue;
      }
      const alOnDay = countALOnDate(d, localOverrides);
      const hrs = getALDeductionHours(staff, dateKey, schedData.config);
      if (alOnDay >= schedData.config.max_al_same_day) {
        issues.push(`${dateKey}: max AL reached (${schedData.config.max_al_same_day})`);
      } else if (hoursBooked + hrs > accrual.remainingHours + 0.05) {
        issues.push(`${dateKey}: earned leave exhausted (${accrual.accruedHours.toFixed(1)}h earned, ${(accrual.usedHours + hoursBooked).toFixed(1)}h would be used)`);
      } else {
        toBook.push({ date: dateKey, staffId: bookingStaff, shift: 'AL', reason: 'Annual leave booked', source: 'al', al_hours: hrs });
        if (!localOverrides[dateKey]) localOverrides[dateKey] = {};
        localOverrides[dateKey][bookingStaff] = { shift: 'AL', reason: 'Annual leave booked', source: 'al', al_hours: hrs };
        hoursBooked += hrs;
      }
      d = addDays(d, 1);
    }

    const msgs = [];
    if (skippedOff > 0) msgs.push(`${skippedOff} scheduled OFF days skipped (AL not used)`);
    if (issues.length > 0) msgs.push('Skipped days: ' + issues.join('; '));
    if (toBook.length > 0 || msgs.length > 0) {
      setBookingMsg(`${toBook.length} AL days booked (${hoursBooked.toFixed(1)}h).${msgs.length > 0 ? ' ' + msgs.join(' ') : ''}`);
    }

    if (toBook.length > 0) {
      const targetDates = toBook.map(row => row.date);
      if (targetDates.some(date => isDateLocked(date))) {
        requestUnlock(targetDates, () => bookAL());
        return;
      }
      setSaving(true);
      let bookingSucceeded = false;
      try {
        await bulkUpsertOverrides(getCurrentHome(), toBook, getEditLockOptions(targetDates));
        await loadData();
        bookingSucceeded = true;
      } catch (e) {
        if (e.status === 423) {
          handleLockedError(targetDates, () => bookAL());
          return;
        }
        setBookingError(e.message);
        setBookingMsg(null);
        return;
      } finally {
        setSaving(false);
      }

      // Compute cover plan for the booked range using the just-reloaded schedData.
      // Read from the current state — setSchedData inside loadData has run by this
      // point. We pass the refreshed overrides/staff snapshot via the ref in loadData.
      if (bookingSucceeded) {
        try {
          const planData = await getSchedulingData(getCurrentHome(), {
            from: targetDates[0],
            to: targetDates[targetDates.length - 1],
          });
          const plan = generateCoverPlan({
            dates: targetDates,
            overrides: planData.overrides,
            config: planData.config,
            staff: planData.staff,
          });
          if (plan.assignments.length > 0 || plan.residualGaps > 0) {
            setCoverPlan(plan);
          }
        } catch {
          // Cover-plan generation is best-effort — don't block the booking if it fails.
        }
      }
    }

    setBookingStaff('');
    setBookingStart('');
    setBookingEnd('');
  }

  async function acceptCoverPlan(selectedAssignments) {
    if (!selectedAssignments?.length) { setCoverPlan(null); return; }
    setCoverPlanSaving(true);
    try {
      const rows = selectedAssignments.map(a => ({
        date: a.date,
        staffId: a.staffId,
        shift: a.shift,
        reason: a.kind === 'float' ? `Float deployed (AL cover)` : a.kind === 'ot' ? `OT called in (AL cover)` : 'Agency (AL cover)',
        source: a.source,
      }));
      const lockDates = [...new Set(rows.map(r => r.date))];
      await bulkUpsertOverrides(getCurrentHome(), rows, getEditLockOptions(lockDates));
      await loadData();
      setCoverPlan(null);
      setBookingMsg(`${rows.length} cover assignments saved.`);
    } catch (e) {
      setBookingError(e.message || 'Cover plan save failed');
    } finally {
      setCoverPlanSaving(false);
    }
  }

  // Cancel AL for a staff member on a date
  async function cancelAL(staffId, dateKey) {
    if (isDateLocked(dateKey)) {
      requestUnlock(dateKey, () => cancelAL(staffId, dateKey));
      return;
    }
    if (!await confirm(`Cancel annual leave for ${dateKey}?`)) return;
    setSaving(true);
    try {
      await deleteOverride(getCurrentHome(), dateKey, staffId, getEditLockOptions(dateKey));
      await loadData();
    } catch (e) {
      if (e.status === 423) {
        handleLockedError(dateKey, () => cancelAL(staffId, dateKey));
        return;
      }
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // Selected staff accrual for booking panel info box
  const selectedAccrual = bookingStaff ? accruals.get(bookingStaff) : null;

  // Upcoming AL bookings
  const upcomingAL = useMemo(() => {
    if (!schedData) return [];
    const todayStr = today;
    const bookings = [];
    Object.entries(schedData.overrides).forEach(([dateKey, dayOverrides]) => {
      if (dateKey < todayStr) return;
      Object.entries(dayOverrides).forEach(([staffId, override]) => {
        if (override.shift === 'AL') {
          const staff = schedData.staff.find(s => s.id === staffId);
          if (staff) bookings.push({ date: dateKey, staffId, staffName: staff.name, team: staff.team });
        }
      });
    });
    bookings.sort((a, b) => a.date.localeCompare(b.date));
    return bookings;
  }, [schedData, today]);

  if (loading) return <LoadingState message="Loading annual leave..." className="p-6" card />;

  if (!homeSlug) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className={CARD.padded}>
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Annual Leave</h1>
          <p className="text-sm text-gray-500">Select a home to view annual leave planning.</p>
        </div>
      </div>
    );
  }

  const confirmDialog = ConfirmDialog;

  if (isOwnDataAnnualLeave) {
    if (error && !schedData) return <div className="p-6 max-w-5xl mx-auto"><ErrorState title="Unable to load your leave view" message={error} onRetry={() => void loadData()} /></div>;
    if (!schedData?.staff?.length) {
      return (
        <div className="p-6 max-w-5xl mx-auto">
          <EmptyState title="No leave record available" description="We couldn’t find a linked staff record for this account yet." />
        </div>
      );
    }
    return <StaffSelfServiceAnnualLeave schedData={schedData} accruals={accruals} today={today} leaveYear={leaveYear} />;
  }

  if (error && !schedData) return <div className="p-6 max-w-5xl mx-auto"><ErrorState title="Unable to load annual leave" message={error} onRetry={() => void loadData()} /></div>;

  if (!schedData) return null;

  // Threshold for amber warning: approximately one day's worth of hours
  const amberThreshold = (parseFloat(schedData.config?.shifts?.EL?.hours) || 12);

  return (
    <>
      {confirmDialog}
      <div className="p-6 max-w-7xl mx-auto">
      {error && (
        <ErrorState
          title="Some annual leave actions could not be completed"
          message={error}
          onRetry={() => void loadData()}
          className="mb-4"
        />
      )}
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{schedData.config.home_name} — Annual Leave</h1>
        <p className="text-xs text-gray-500">Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className="flex items-center justify-between mb-2 print:hidden">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Annual Leave</h1>
          {saving && <span className="text-xs text-blue-500">Saving...</span>}
        </div>
        <button onClick={() => window.print()} className={BTN.secondary}>Print</button>
      </div>

      {showLockPrompt && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
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

      {/* Leave year banner */}
      {leaveYear && (
        <div className="mb-6 text-xs text-gray-500 print:hidden">
          Leave Year: <span className="font-medium text-gray-700">{fmtDate(leaveYear.start)} – {fmtDate(leaveYear.end)}</span>
          <span className="mx-2 text-gray-300">|</span>
          Accrual: monthly (1/12th per month) | Hours-based (5.6 x weekly contracted hours)
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Book AL */}
        {canEdit && <div className={CARD.padded}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Book Leave</h2>
          <div className="space-y-3">
            <div>
              <label htmlFor={BOOKING_FIELD_IDS.staff} className={INPUT.label}>Staff</label>
              <select id={BOOKING_FIELD_IDS.staff} value={bookingStaff} onChange={e => setBookingStaff(e.target.value)} className={INPUT.select}>
                <option value="">Select...</option>
                {activeStaff.map(s => {
                  const acc = accruals.get(s.id);
                  const avail = acc ? acc.remainingHours : 0;
                  return (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.team}) — {avail.toFixed(1)}h earned left
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Accrual info box */}
            {selectedAccrual && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 space-y-0.5">
                {selectedAccrual.missingContractHours && (
                  <div className="bg-amber-100 border border-amber-300 rounded px-2 py-1 mb-1 text-amber-800 font-medium">
                    Set contract hours in Staff Database to enable AL booking
                  </div>
                )}
                <div className="flex justify-between"><span>Entitled</span><span className="font-medium">{selectedAccrual.annualEntitlementHours.toFixed(1)}h{selectedAccrual.carryoverHours > 0 ? ` (+${selectedAccrual.carryoverHours.toFixed(1)}h c/o)` : ''}{selectedAccrual.entitlementWeeks > 0 ? ` (${selectedAccrual.entitlementWeeks}wk)` : ''}</span></div>
                <div className="flex justify-between"><span>Earned to date</span><span className="font-medium">{selectedAccrual.accruedHours.toFixed(1)}h</span></div>
                <div className="flex justify-between"><span>Used</span><span className="font-medium">{selectedAccrual.usedHours.toFixed(1)}h</span></div>
                <div className="flex justify-between border-t border-amber-200 pt-0.5 mt-0.5">
                  <span className="font-semibold">Earned left</span>
                  <span className={`font-bold ${selectedAccrual.remainingHours < 0 ? 'text-red-700' : selectedAccrual.remainingHours <= amberThreshold ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {selectedAccrual.remainingHours.toFixed(1)}h
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Projected year-end left</span>
                  <span className="font-medium">{selectedAccrual.yearRemainingHours.toFixed(1)}h</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={BOOKING_FIELD_IDS.start} className={INPUT.label}>From</label>
                <input id={BOOKING_FIELD_IDS.start} type="date" value={bookingStart} onChange={e => setBookingStart(e.target.value)} className={INPUT.base} />
              </div>
              <div>
                <label htmlFor={BOOKING_FIELD_IDS.end} className={INPUT.label}>To</label>
                <input id={BOOKING_FIELD_IDS.end} type="date" value={bookingEnd} onChange={e => setBookingEnd(e.target.value)} className={INPUT.base} />
              </div>
            </div>
            <div className="text-xs text-gray-500">Max {schedData.config.max_al_same_day} staff on AL per day</div>
            {bookingError && <p className="text-sm text-red-600">{bookingError}</p>}
            {bookingMsg && <p className="text-sm text-emerald-700">{bookingMsg}</p>}
            <button onClick={bookAL} disabled={!bookingStaff || !bookingStart || !bookingEnd || saving || (selectedAccrual?.missingContractHours)}
              className={`w-full inline-flex items-center justify-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors duration-150 disabled:opacity-50`}>
              {saving ? 'Booking...' : 'Book Annual Leave'}
            </button>
          </div>
        </div>}

        {/* AL Balances */}
        <div className={`lg:col-span-2 ${CARD.flush}`}>
          <div className="flex items-center justify-between p-4 pb-0 mb-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">AL Balances</h2>
              {leaveYear && <p className="mt-0.5 text-xs text-gray-600">{fmtDate(leaveYear.start)} – {fmtDate(leaveYear.end)}</p>}
              <p className="mt-1 text-xs text-gray-500">Booking uses earned leave. Projected year-end balance is shown beneath each current balance.</p>
            </div>
            <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)} className={`${INPUT.select} w-auto`} aria-label="Filter annual leave balances by team">
              <option value="All">All Teams</option>
              {TEAMS.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th scope="col" className={TABLE.th}>Name</th>
                  <th scope="col" className={TABLE.th}>Team</th>
                  <th scope="col" className={`${TABLE.th} text-center`}>Entitled</th>
                  <th scope="col" className={`${TABLE.th} text-center`}>Used</th>
                  <th scope="col" className={`${TABLE.th} text-center`}>Earned left</th>
                  <th scope="col" className={TABLE.th}>Progress</th>
                </tr>
              </thead>
              <tbody>
                {[...filtered].sort((a, b) => a.name.localeCompare(b.name)).map(s => {
                  const acc = accruals.get(s.id) || {
                    annualEntitlementHours: 0, totalEntitlementHours: 0, accruedHours: 0, usedHours: 0,
                    remainingHours: 0, yearRemainingHours: 0, isProRata: false, carryoverHours: 0,
                    contractHours: 0, missingContractHours: true,
                  };
                  const pct = acc.annualEntitlementHours > 0 ? (acc.usedHours / acc.annualEntitlementHours) * 100 : 0;
                  return (
                    <tr key={s.id} className={TABLE.tr}>
                      <td className={`${TABLE.td} font-medium`}>
                        {s.name}
                        {acc.isProRata && <span className={`ml-1 ${BADGE.blue}`}>Pro-rata</span>}
                        {acc.missingContractHours && <span className={`ml-1 ${BADGE.amber}`}>No hrs</span>}
                      </td>
                      <td className={`${TABLE.td} text-xs text-gray-500`}>{s.team}</td>
                      <td className={`${TABLE.td} text-center text-xs`}>
                        {acc.annualEntitlementHours.toFixed(1)}h
                        {acc.carryoverHours > 0 && <span className={`ml-1 ${BADGE.amber}`}>+{acc.carryoverHours.toFixed(1)}h</span>}
                      </td>
                      <td className={`${TABLE.td} text-center font-mono text-xs`}>{acc.usedHours.toFixed(1)}</td>
                      <td className={`${TABLE.td} text-center`}>
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={`font-medium text-sm ${acc.remainingHours < 0 ? 'text-red-700' : acc.remainingHours <= amberThreshold ? 'text-amber-700' : 'text-emerald-700'}`}>
                            {acc.remainingHours.toFixed(1)}h
                          </span>
                          <span className="text-[11px] text-gray-500">
                            Year-end: {acc.yearRemainingHours.toFixed(1)}h
                          </span>
                        </div>
                      </td>
                      <td className={TABLE.td}>
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div className={`h-full rounded-full transition-all duration-300 ${pct > 80 ? 'bg-red-400' : pct > 50 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                            style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* AL Calendar Heatmap */}
        <div className={`lg:col-span-3 ${CARD.padded}`}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">AL Calendar — Next 2 Months</h2>
          {(() => {
            const now = new Date();
            const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
            const months = [
              { dates: getMonthDates(now.getUTCFullYear(), now.getUTCMonth()), label: now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) },
              { dates: getMonthDates(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth()), label: nextMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) },
            ];
            return months.map(m => (
              <div key={m.label} className="mb-4">
                <h3 className="text-xs font-semibold text-gray-600 mb-1.5">{m.label}</h3>
                <div className="flex gap-1 flex-wrap">
                  {Array.from({ length: (m.dates[0].getUTCDay() + 6) % 7 }).map((_, i) => (
                    <div key={`pad-${i}`} className="w-8 h-8" />
                  ))}
                  {m.dates.map(d => {
                    const alCount = countALOnDate(d, schedData.overrides);
                    const max = schedData.config.max_al_same_day;
                    const isToday = formatDate(d) === today;
                    return (
                      <div key={formatDate(d)} className={`w-8 h-8 rounded-lg text-[10px] flex flex-col items-center justify-center transition-colors ${
                        isToday ? 'ring-2 ring-blue-500 ring-offset-1' : ''
                      } ${
                      alCount >= max ? 'bg-red-200 text-red-800' :
                      alCount >= max - 1 ? 'bg-amber-200 text-amber-800' :
                      alCount > 0 ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-600'
                      }`} title={`${formatDate(d)}: ${alCount}/${max} AL`}>
                        <span className="font-medium leading-none">{d.getUTCDate()}</span>
                        {alCount > 0 && <span className="text-[8px] font-bold leading-none">{alCount}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ));
          })()}
          <div className="flex gap-4 text-[10px] text-gray-500 mt-2">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-50 border" /> None</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-yellow-100" /> Some AL</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-200" /> Near max</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-200" /> Max reached</span>
          </div>
        </div>

        {/* Upcoming Bookings */}
        <div className={`lg:col-span-3 ${CARD.padded}`}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Upcoming AL Bookings</h2>
          {upcomingAL.length === 0 ? (
            <div className="text-sm text-gray-600">No upcoming AL bookings</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {upcomingAL.slice(0, 20).map((b, i) => (
                <div key={i} className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-sm">
                  <div>
                    <div className="font-medium">{b.staffName}</div>
                    <div className="text-xs text-gray-500">{parseDate(b.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</div>
                  </div>
                  {canEdit && <button onClick={() => cancelAL(b.staffId, b.date)} disabled={saving} className="text-red-600 hover:text-red-700 text-xs font-medium transition-colors disabled:opacity-50">Cancel</button>}
                </div>
              ))}
            </div>
          )}
        </div>

        {canEdit && (
          <div className="lg:col-span-3">
            <OverrideRequestReview />
          </div>
        )}
      </div>
      </div>
      <CoverPlanModal
        isOpen={!!coverPlan}
        plan={coverPlan}
        saving={coverPlanSaving}
        onAccept={acceptCoverPlan}
        onDismiss={() => setCoverPlan(null)}
      />
    </>
  );
}

function StaffSelfServiceAnnualLeave({ schedData, accruals, today, leaveYear }) {
  const staffMember = schedData.staff?.[0];
  const accrual = staffMember ? accruals.get(staffMember.id) : null;
  const upcomingLeave = Object.entries(schedData.overrides || {})
    .filter(([dateKey]) => dateKey >= today)
    .flatMap(([dateKey, dayOverrides]) => {
      const override = dayOverrides?.[staffMember?.id];
      return override?.shift === 'AL'
        ? [{ date: dateKey, label: fmtDate(parseDate(dateKey)) }]
        : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className={CARD.padded}>
        <h1 className="text-2xl font-bold text-gray-900">My Leave</h1>
        <p className="mt-2 text-sm text-gray-600">This view keeps your leave picture simple: balance, booked days, and the current leave year. Booking changes still go through your manager.</p>
      </div>

      {leaveYear && (
        <div className={CARD.padded}>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Leave year</p>
          <p className="mt-2 text-lg font-semibold text-gray-900">{fmtDate(leaveYear.start)} – {fmtDate(leaveYear.end)}</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <LeaveMetric label="Earned to date" value={`${(accrual?.accruedHours || 0).toFixed(1)}h`} />
        <LeaveMetric label="Used" value={`${(accrual?.usedHours || 0).toFixed(1)}h`} />
        <LeaveMetric label="Earned left" value={`${(accrual?.remainingHours || 0).toFixed(1)}h`} highlight />
      </div>

      <div className={CARD.flush}>
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Booked leave</h2>
        </div>
        {upcomingLeave.length === 0 ? (
          <EmptyState compact title="No booked leave ahead" description="When your next annual leave booking is approved, it’ll appear here." />
        ) : (
          <div className="divide-y divide-gray-100">
            {upcomingLeave.map(entry => (
              <div key={entry.date} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="font-medium text-gray-900">{entry.label}</span>
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">Annual Leave</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LeaveMetric({ label, value, highlight = false }) {
  return (
    <div className={CARD.padded}>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${highlight ? 'text-emerald-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}
