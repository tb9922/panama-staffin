import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  formatDate, parseDate, addDays, getStaffForDay,
  isWorkingShift, isEarlyShift, isLateShift, isNightShift, isCareRole,
  SHIFT_COLORS, countALOnDate,
} from '../lib/rotation.js';
import {
  getDayCoverageStatus, calculateDayCost, checkFatigueRisk,
} from '../lib/escalation.js';
import { CARD, TABLE, INPUT, BTN, BADGE, PAGE, ESC_COLORS } from '../lib/design.js';
import useEscapeKey from '../hooks/useEscapeKey.js';
import { getOnboardingBlockingReasons } from '../lib/onboarding.js';
import { getTrainingBlockingReasons } from '../lib/training.js';
import { todayLocalISO } from '../lib/localDates.js';
import {
  getCurrentHome,
  getSchedulingData,
  upsertOverride,
  deleteOverride,
  upsertDayNote,
  updateStaffMember,
} from '../lib/api.js';
import { useData } from '../contexts/DataContext.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import useSchedulingEditLock from '../hooks/useSchedulingEditLock.js';
import DailyStatusCoverageGapPanel from '../components/scheduling/DailyStatusCoverageGapPanel.jsx';
import DailyStatusModal from '../components/scheduling/DailyStatusModal.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import useTransientNotice from '../hooks/useTransientNotice.js';

function getCenteredSchedulingRange(date, radiusDays = 200) {
  return {
    from: formatDate(addDays(date, -radiusDays)),
    to: formatDate(addDays(date, radiusDays)),
  };
}

function getShiftEditReason(shift) {
  if (shift === 'OFF') return 'Manual day off';
  if (shift === 'TRN') return 'Training';
  if (shift === 'ADM') return 'Admin';
  if (shift === 'NS') return 'No show';
  if (shift.startsWith('OC-')) return 'OT booked';
  if (shift.startsWith('AG-')) return 'Agency';
  return 'Manual shift edit';
}

export default function DailyStatus() {
  const { date: dateParam } = useParams();
  const navigate = useNavigate();
  const currentDate = useMemo(() => dateParam ? parseDate(dateParam) : new Date(), [dateParam]);
  const dateStr = formatDate(currentDate);

  const [schedData, setSchedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [overrideWarnings, setOverrideWarnings] = useState([]);
  const [saving, setSaving] = useState(false);

  const [modal, setModal] = useState(null);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [manualShiftType, setManualShiftType] = useState('');
  const [otShiftType, setOtShiftType] = useState('OC-EL');
  const [agencyShiftType, setAgencyShiftType] = useState('');
  const [swapFrom, setSwapFrom] = useState('');
  const [swapTo, setSwapTo] = useState('');
  const [showGapPanel, setShowGapPanel] = useState(false);
  const [gapPanelDate, setGapPanelDate] = useState(null);
  const [gapPanelAbsentStaffId, setGapPanelAbsentStaffId] = useState(null);
  const [dayNoteState, setDayNoteState] = useState('idle');
  const { notice, showNotice, clearNotice } = useTransientNotice();

  const noteTimerRef = useRef(null);
  const savingRef = useRef(false);
  useDirtyGuard(!!modal);

  const closeModal = useCallback(() => {
    setModal(null);
    setSelectedStaff('');
    setManualShiftType('');
    setSwapFrom('');
    setSwapTo('');
    setAgencyShiftType('');
  }, []);

  useEscapeKey(!!modal, closeModal);
  const goDay = useCallback((offset) => {
    navigate(`/day/${formatDate(addDays(currentDate, offset))}`);
  }, [currentDate, navigate]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (modal) return;
      if (event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goDay(-1);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goDay(1);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goDay, modal]);

  const { canWrite, homeRole } = useData();
  const canEdit = canWrite('scheduling');
  const homeSlug = getCurrentHome();
  const isOwnDataDailyStatus = homeRole === 'staff_member';

  const loadData = useCallback(async () => {
    if (!homeSlug || isOwnDataDailyStatus) {
      setSchedData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const { from, to } = getCenteredSchedulingRange(currentDate);
    setLoading(true);
    setError(null);
    try {
      setSchedData(await getSchedulingData(homeSlug, { from, to }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug, isOwnDataDailyStatus, currentDate]);

  useEffect(() => { loadData(); }, [loadData]);

  // Cleanup debounce timer on unmount
  useEffect(() => () => clearTimeout(noteTimerRef.current), []);

  const staffForDay = useMemo(() => {
    if (!schedData) return [];
    return getStaffForDay(schedData.staff, currentDate, schedData.overrides, schedData.config);
  }, [schedData, currentDate]);

  const coverage = useMemo(() => {
    if (!schedData) return {};
    return getDayCoverageStatus(staffForDay, schedData.config);
  }, [staffForDay, schedData]);

  const cost = useMemo(() => {
    if (!schedData) return { base: 0, otPremium: 0, agencyDay: 0, agencyNight: 0, bhPremium: 0, sleepIn: 0, total: 0 };
    return calculateDayCost(staffForDay, schedData.config);
  }, [staffForDay, schedData]);

  const earlyStaff = staffForDay.filter(s => isCareRole(s.role) && isEarlyShift(s.shift));
  const lateStaff = staffForDay.filter(s => isCareRole(s.role) && isLateShift(s.shift));
  const nightStaff = staffForDay.filter(s => isCareRole(s.role) && isNightShift(s.shift));
  const sickStaff = staffForDay.filter(s => s.shift === 'SICK');
  const noShowStaff = staffForDay.filter(s => s.shift === 'NS');
  const alStaff = staffForDay.filter(s => s.shift === 'AL');
  const availableStaff = staffForDay.filter(s => (s.shift === 'AVL' || s.shift === 'OFF') && isCareRole(s.role));

  const availableCover = useMemo(() => {
    if (!schedData) return [];
    return availableStaff.map(s => {
      const fatigue = checkFatigueRisk(s, currentDate, schedData.overrides, schedData.config);
      return { ...s, fatigue };
    });
  }, [availableStaff, schedData, currentDate]);

  const today = todayLocalISO();
  const hasEditLock = Boolean(schedData?.config?.edit_lock_enabled);
  const {
    showLockPrompt,
    lockPin,
    lockError,
    updateLockPin,
    dismissLockPrompt,
    attemptUnlock,
    requestUnlock,
    handleLockedError,
    getEditLockOptions,
    isDateLocked,
  } = useSchedulingEditLock({ homeSlug, hasEditLock, today });
  const isLocked = isDateLocked(dateStr);

  // Reset lock prompt state and override warnings when navigating to a different date
  useEffect(() => {
    dismissLockPrompt();
    setOverrideWarnings([]);
    setDayNoteState('idle');
  }, [dateStr, dismissLockPrompt]);

  async function applyOverride(staffId, shift, reason, source, sleepIn = false, replacesStaffId = null, extra = {}) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setOverrideWarnings([]);
    try {
      const result = await upsertOverride(
        getCurrentHome(),
        { date: dateStr, staffId, shift, reason, source: source || 'manual', sleep_in: sleepIn, replaces_staff_id: replacesStaffId || undefined, ...extra },
        getEditLockOptions(dateStr),
      );
      if (result?.warnings?.length) setOverrideWarnings(result.warnings);
      await loadData();
    } catch (e) {
      if (e.status === 423) {
        handleLockedError(dateStr, () => applyOverride(staffId, shift, reason, source, sleepIn, replacesStaffId, extra));
        return;
      }
      setError(e.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    setModal(null);
    setSelectedStaff('');
  }

  async function toggleSleepIn(staffId) {
    if (!schedData || savingRef.current) return;
    savingRef.current = true;
    const existing = schedData.overrides[dateStr]?.[staffId];
    setSaving(true);
    try {
      if (existing) {
        await upsertOverride(
          getCurrentHome(),
          {
            date: dateStr,
            staffId,
            shift: existing.shift,
            reason: existing.reason,
            source: existing.source,
            sleep_in: !existing.sleep_in,
            replaces_staff_id: existing.replaces_staff_id,
            override_hours: existing.override_hours,
          },
          getEditLockOptions(dateStr),
        );
      } else {
        const s = staffForDay.find(m => m.id === staffId);
        await upsertOverride(
          getCurrentHome(),
          {
            date: dateStr,
            staffId,
            shift: s?.scheduledShift || 'OFF',
            reason: 'Sleep in',
            source: 'manual',
            sleep_in: true,
          },
          getEditLockOptions(dateStr),
        );
      }
      await loadData();
    } catch (e) {
      if (e.status === 423) {
        handleLockedError(dateStr, () => toggleSleepIn(staffId));
        return;
      }
      setError(e.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    setModal(null);
    setSelectedStaff('');
  }

  async function removeOverride(staffId) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await deleteOverride(getCurrentHome(), dateStr, staffId, getEditLockOptions(dateStr));
      await loadData();
    } catch (e) {
      if (e.status === 423) {
        handleLockedError(dateStr, () => removeOverride(staffId));
        return;
      }
      setError(e.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // Applies a SICK override and shows the cascade gap panel if coverage drops
  async function applySickOverride(staffId) {
    if (!schedData || savingRef.current) return;
    savingRef.current = true;
    // Simulate projected coverage before API call so gap panel shows immediately
    const projectedOverrides = JSON.parse(JSON.stringify(schedData.overrides));
    if (!projectedOverrides[dateStr]) projectedOverrides[dateStr] = {};
    projectedOverrides[dateStr][staffId] = { shift: 'SICK', reason: 'Sick', source: 'manual', sleep_in: false };
    const projectedStaff = getStaffForDay(schedData.staff, currentDate, projectedOverrides, schedData.config);
    const projectedCoverage = getDayCoverageStatus(projectedStaff, schedData.config);

    setSaving(true);
    try {
      await upsertOverride(
        getCurrentHome(),
        { date: dateStr, staffId, shift: 'SICK', reason: 'Sick', source: 'manual' },
        getEditLockOptions(dateStr),
      );
      await loadData();
    } catch (e) {
      if (e.status === 423) {
        handleLockedError(dateStr, () => applySickOverride(staffId));
        savingRef.current = false;
        setSaving(false);
        return;
      }
      setError(e.message);
      savingRef.current = false;
      setSaving(false);
      setModal(null);
      setSelectedStaff('');
      return;
    }
    savingRef.current = false;
    setSaving(false);
    setModal(null);
    setSelectedStaff('');
    const absentStaff = staffForDay.find(member => member.id === staffId);
    const handoffPath = `/hr/absence?tab=rtw&staffId=${encodeURIComponent(staffId)}&source=daily-status&date=${encodeURIComponent(dateStr)}`;
    showNotice(
      <div className="space-y-2">
        <p>
          {absentStaff?.name || staffId} marked sick for {dateStr}. When they return, record the RTW interview in Absence Management.
        </p>
        <button
          type="button"
          onClick={() => navigate(handoffPath)}
          className={`${BTN.secondary} ${BTN.xs}`}
        >
          Record RTW Interview
        </button>
      </div>,
      { variant: 'success', duration: 8000 },
    );
    if (projectedCoverage.overallLevel >= 1) {
      setShowGapPanel(true);
      setGapPanelDate(dateStr);
      setGapPanelAbsentStaffId(staffId);
    }
  }

  async function applyNoShowOverride(staffId) {
    if (!schedData || savingRef.current) return;
    savingRef.current = true;

    const projectedOverrides = JSON.parse(JSON.stringify(schedData.overrides));
    if (!projectedOverrides[dateStr]) projectedOverrides[dateStr] = {};
    projectedOverrides[dateStr][staffId] = { shift: 'NS', reason: 'No show', source: 'manual', sleep_in: false };
    const projectedStaff = getStaffForDay(schedData.staff, currentDate, projectedOverrides, schedData.config);
    const projectedCoverage = getDayCoverageStatus(projectedStaff, schedData.config);

    setSaving(true);
    try {
      await upsertOverride(
        getCurrentHome(),
        { date: dateStr, staffId, shift: 'NS', reason: 'No show', source: 'manual' },
        getEditLockOptions(dateStr),
      );
      await loadData();
    } catch (e) {
      if (e.status === 423) {
        handleLockedError(dateStr, () => applyNoShowOverride(staffId));
        savingRef.current = false;
        setSaving(false);
        return;
      }
      setError(e.message);
      savingRef.current = false;
      setSaving(false);
      setModal(null);
      setSelectedStaff('');
      return;
    }
    savingRef.current = false;
    setSaving(false);
    setModal(null);
    setSelectedStaff('');
    const absentStaff = staffForDay.find(member => member.id === staffId);
    showNotice(`${absentStaff?.name || staffId} marked as no-show for ${dateStr}.`, { variant: 'warning', duration: 6000 });
    if (projectedCoverage.overallLevel >= 1) {
      setShowGapPanel(true);
      setGapPanelDate(dateStr);
      setGapPanelAbsentStaffId(staffId);
    }
  }

  async function applyManualShiftEdit() {
    const staff = staffForDay.find(member => member.id === selectedStaff);
    if (!staff || !manualShiftType) return;
    if (manualShiftType === '__scheduled__') {
      if (staff.isOverride) {
        await removeOverride(staff.id);
      } else {
        closeModal();
      }
      return;
    }
    if (manualShiftType === staff.shift && !staff.isOverride) {
      closeModal();
      return;
    }
    if (manualShiftType === 'SICK') {
      await applySickOverride(staff.id);
      return;
    }
    if (manualShiftType === 'NS') {
      await applyNoShowOverride(staff.id);
      return;
    }
    const source = manualShiftType.startsWith('OC-')
      ? 'ot'
      : manualShiftType.startsWith('AG-')
        ? 'agency'
        : 'manual';
    await applyOverride(staff.id, manualShiftType, getShiftEditReason(manualShiftType), source);
  }

  async function handlePermanentSwap(staffAId, staffBId) {
    const staffA = staffForDay.find(member => member.id === staffAId);
    const staffB = staffForDay.find(member => member.id === staffBId);
    if (!staffA || !staffB) return;
    setSaving(true);
    try {
      await updateStaffMember(getCurrentHome(), staffA.id, { ...schedData.staff.find(member => member.id === staffA.id), team: staffB.team });
      await updateStaffMember(getCurrentHome(), staffB.id, { ...schedData.staff.find(member => member.id === staffB.id), team: staffA.team });
      await loadData();
      closeModal();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTemporarySwap(staffAId, staffBId) {
    const staffA = staffForDay.find(member => member.id === staffAId);
    const staffB = staffForDay.find(member => member.id === staffBId);
    if (!staffA || !staffB) return;
    setSaving(true);
    try {
      await upsertOverride(
        getCurrentHome(),
        { date: dateStr, staffId: staffAId, shift: staffB.shift, reason: `Swapped with ${staffB.name}`, source: 'swap' },
        getEditLockOptions(dateStr),
      );
      await upsertOverride(
        getCurrentHome(),
        { date: dateStr, staffId: staffBId, shift: staffA.shift, reason: `Swapped with ${staffA.name}`, source: 'swap' },
        getEditLockOptions(dateStr),
      );
      await loadData();
      closeModal();
    } catch (e) {
      if (e.status === 423) {
        handleLockedError(dateStr, () => {
          setModal('swap');
          setSwapFrom(staffA.id);
          setSwapTo(staffB.id);
        });
        return;
      }
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAgencyBooking(shiftType, replacesStaffId = null) {
    const agencyId = `AG-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    setSaving(true);
    try {
      await upsertOverride(
        getCurrentHome(),
        {
          date: dateStr,
          staffId: agencyId,
          shift: shiftType,
          reason: 'Agency',
          source: 'agency',
          replaces_staff_id: replacesStaffId || undefined,
        },
        getEditLockOptions(dateStr),
      );
      await loadData();
      closeModal();
    } catch (e) {
      if (e.status === 423) {
        handleLockedError(dateStr, () => {
          setModal('agency');
          setAgencyShiftType(shiftType);
        });
        return;
      }
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // Wraps any write action with a past-date lock check
  function withLockCheck(action) {
    requestUnlock(dateStr, action);
  }

  const escColor = (esc) => {
    if (!esc) return '';
    const colorKey = esc.color;
    if (ESC_COLORS[colorKey]) return ESC_COLORS[colorKey].badge;
    return 'bg-gray-100 text-gray-600';
  };

  const alCount = schedData ? countALOnDate(currentDate, schedData.overrides) : 0;
  const dayName = currentDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const getBlockingReasons = (s) => {
    if (!schedData) return [];
    const reasons = [];
    if (schedData.config.enforce_onboarding_blocking && isCareRole(s.role)) {
      reasons.push(...getOnboardingBlockingReasons(s.id, schedData.onboarding));
    }
    if (schedData.config.enforce_training_blocking && isCareRole(s.role)) {
      reasons.push(...getTrainingBlockingReasons(s.id, s.role, schedData.training, schedData.config, dateStr));
    }
    return reasons;
  };



  const StaffRow = ({ s }) => {
    const blockReasons = isWorkingShift(s.shift) ? getBlockingReasons(s) : [];
    return (
    <tr className={TABLE.tr}>
      <td className={`${TABLE.tdMono} text-xs text-gray-400`}>{s.id}</td>
      <td className={`${TABLE.td} font-medium`}>
        {s.name}
        {blockReasons.length > 0 && (
          <span title={blockReasons.join(', ')} className="ml-1 inline-flex items-center text-red-500 cursor-help">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.07 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
          </span>
        )}
      </td>
      <td className={`${TABLE.td} text-xs`}>{s.role}</td>
      <td className={`${TABLE.td} text-xs`}>{s.team}</td>
      <td className={TABLE.td}>
        {canEdit ? (
          <button
            type="button"
            onClick={() => withLockCheck(() => {
              setSelectedStaff(s.id);
              setManualShiftType(s.isOverride ? s.shift : '__scheduled__');
              setModal('shiftEdit');
            })}
            disabled={saving}
            aria-label={`Change shift for ${s.name}`}
            className={`px-1.5 py-0.5 rounded text-xs font-medium transition-colors duration-150 hover:opacity-80 disabled:opacity-50 ${SHIFT_COLORS[s.shift] || 'bg-gray-100'}`}
          >
            {s.shift}
          </button>
        ) : (
          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${SHIFT_COLORS[s.shift] || 'bg-gray-100'}`}>{s.shift}</span>
        )}
        {s.sleep_in && <span className={`${BADGE.purple} ml-1`}>SI</span>}
        {s.replaces_staff_id && (() => {
          const replaced = staffForDay.find(m => m.id === s.replaces_staff_id);
          return <span className={`${BADGE.amber} ml-1`} title={`Covers for ${replaced?.name || s.replaces_staff_id}`}>covers {replaced?.name?.split(' ')[0] || s.replaces_staff_id}</span>;
        })()}
      </td>
      <td className={`${TABLE.td} text-xs text-gray-500`}>{s.skill}</td>
      <td className={`${TABLE.td} text-xs text-gray-500`}>{s.reason || ''}</td>
      <td className={TABLE.td}>
        {canEdit && s.isOverride && (
          <button onClick={() => withLockCheck(() => removeOverride(s.id))} disabled={saving} className={`${BTN.ghost} ${BTN.xs} text-red-500 hover:text-red-700 hover:bg-red-50 disabled:opacity-50`}>Revert</button>
        )}
      </td>
    </tr>
  );
  };

  const StaffTable = ({ title, staff, bgColor }) => (
    <div className="mb-3">
      <h3 className={`text-xs font-semibold uppercase px-2 py-1 rounded-t ${bgColor}`}>{title} ({staff.length})</h3>
      {staff.length === 0 ? (
        <div className={TABLE.empty}>None</div>
      ) : (
        <table className={TABLE.table}>
          <tbody>
            {staff.map(s => <StaffRow key={s.id} s={s} />)}
          </tbody>
        </table>
      )}
    </div>
  );

  if (loading) return <LoadingState message="Loading daily status..." className="min-h-[16rem]" />;

  if (!homeSlug) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <EmptyState title="Daily Status is not ready yet" description="Select a home to view daily status and manage cover for the day." />
      </div>
    );
  }

  if (isOwnDataDailyStatus) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <EmptyState title="Daily Status is not available" description="Daily Status is not available for staff self-service accounts." />
      </div>
    );
  }

  if (error) return <div className="p-6"><ErrorState title="Unable to load daily status" message={error} onRetry={() => { setError(null); loadData(); }} /></div>;

  if (!schedData) return null;

  return (
    <div className={PAGE.container}>
      {notice && (
        <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">
          {notice.content}
        </InlineNotice>
      )}

      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{schedData.config.home_name} — Daily Status</h1>
        <p className="text-xs text-gray-500">{dayName} | Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      {/* Date Navigation */}
      <div className="flex items-center justify-between mb-4 print:hidden">
        <div className="flex items-center gap-3">
          <button onClick={() => goDay(-1)} className={`${BTN.secondary} ${BTN.sm}`}>&larr;</button>
          <h1 className={PAGE.title}>
            {dayName}
            {isLocked && (
              <span className="ml-2 text-amber-500 align-middle" title="Past date — locked for editing">
                <svg className="inline w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </span>
            )}
          </h1>
          <button onClick={() => goDay(1)} className={`${BTN.secondary} ${BTN.sm}`}>&rarr;</button>
          {saving && <span className="text-xs text-blue-500">Saving...</span>}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => window.print()} className={`${BTN.secondary} ${BTN.sm}`}>Print</button>
          <button onClick={() => navigate(`/day/${todayLocalISO()}`)} className={`${BTN.ghost} ${BTN.sm} text-blue-600`}>Today</button>
        </div>
      </div>

      {/* Training-blocking warnings from last override save */}
      {overrideWarnings.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-sm text-amber-800 print:hidden" role="status">
          {overrideWarnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      {/* Past-date lock prompt */}
      {showLockPrompt && (
        <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 print:hidden flex-wrap">
          <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span className="text-sm text-amber-800">Past date — enter admin PIN to edit</span>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={lockPin}
            onChange={e => updateLockPin(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && attemptUnlock()}
            placeholder="PIN"
            className={`${INPUT.sm} w-20`}
            autoFocus
          />
          <button onClick={attemptUnlock} className={`${BTN.primary} ${BTN.sm}`}>Unlock</button>
          <button onClick={dismissLockPrompt} className={`${BTN.ghost} ${BTN.sm}`}>Cancel</button>
          {lockError && <span className="text-xs text-red-600">{lockError}</span>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Coverage Panel */}
        <div className={CARD.padded}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Coverage</h2>
          {['early', 'late', 'night'].map(period => {
            const cov = coverage[period];
            if (!cov) return null;
            return (
              <div key={period} className="mb-3 last:mb-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium capitalize">{period}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${escColor(cov.escalation)}`}>
                    {cov.escalation.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                  <div>Heads: <strong>{cov.coverage.headCount}/{cov.coverage.required.heads}</strong></div>
                  <div>Skill: <strong>{cov.coverage.skillPoints.toFixed(1)}/{cov.coverage.required.skill_points}</strong></div>
                </div>
              </div>
            );
          })}

          <div className="border-t mt-3 pt-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Costs</h3>
            <div className="space-y-1 text-xs text-gray-600">
              <div className="flex justify-between"><span>Base:</span><span>£{cost.base.toFixed(2)}</span></div>
              {cost.otPremium > 0 && <div className="flex justify-between text-orange-600"><span>OT Prem:</span><span>£{cost.otPremium.toFixed(2)}</span></div>}
              {cost.agencyDay > 0 && <div className="flex justify-between text-red-600"><span>AG Day:</span><span>£{cost.agencyDay.toFixed(2)}</span></div>}
              {cost.agencyNight > 0 && <div className="flex justify-between text-red-600"><span>AG Night:</span><span>£{cost.agencyNight.toFixed(2)}</span></div>}
              {cost.bhPremium > 0 && <div className="flex justify-between text-pink-600"><span>BH Prem:</span><span>£{cost.bhPremium.toFixed(2)}</span></div>}
              {cost.sleepIn > 0 && <div className="flex justify-between text-purple-600"><span>Sleep-in:</span><span>£{cost.sleepIn.toFixed(2)}</span></div>}
              <div className="flex justify-between font-bold border-t pt-1"><span>Total:</span><span>£{cost.total.toFixed(2)}</span></div>
            </div>
          </div>

          <div className="border-t mt-3 pt-2 text-xs text-gray-500">
            AL: {alCount}/{schedData.config.max_al_same_day} | Sick: {sickStaff.length} | No show: {noShowStaff.length}
          </div>

          {/* Day Notes */}
          <div className="border-t mt-3 pt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase">Handover Notes</h3>
              <span className={`text-[11px] ${
                dayNoteState === 'saving' ? 'text-blue-600' :
                dayNoteState === 'saved' ? 'text-emerald-600' :
                dayNoteState === 'dirty' ? 'text-amber-600' :
                'text-gray-400'
              }`}>
                {dayNoteState === 'saving'
                  ? 'Saving…'
                  : dayNoteState === 'saved'
                    ? 'Saved'
                    : dayNoteState === 'dirty'
                      ? 'Unsaved changes'
                      : 'Auto-saves after a pause'}
              </span>
            </div>
            <textarea
              value={schedData.day_notes?.[dateStr] || ''}
              readOnly={isLocked || !canEdit}
              onChange={e => {
                if (isLocked || !canEdit) return;
                const note = e.target.value;
                setDayNoteState('dirty');
                // Optimistic local update for responsive UI
                setSchedData(prev => ({
                  ...prev,
                  day_notes: { ...prev.day_notes, [dateStr]: note },
                }));
                clearTimeout(noteTimerRef.current);
                noteTimerRef.current = setTimeout(async () => {
                  try {
                    setDayNoteState('saving');
                    await upsertDayNote(getCurrentHome(), dateStr, note, getEditLockOptions(dateStr));
                    setDayNoteState('saved');
                  } catch (err) {
                    if (err.status === 423) {
                      handleLockedError(dateStr, () => {
                        upsertDayNote(getCurrentHome(), dateStr, note, getEditLockOptions(dateStr)).catch(innerErr => setError(innerErr.message));
                      });
                      setDayNoteState('dirty');
                      return;
                    }
                    setDayNoteState('dirty');
                    setError(err.message);
                  }
                }, 800);
              }}
              placeholder={isLocked ? 'Unlock to edit notes' : !canEdit ? 'View only' : 'Add notes for handover, incidents, or reminders...'}
              className={`${INPUT.base} h-20 resize-y ${isLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
          </div>
        </div>

        {/* Staff Lists */}
        <div className={`lg:col-span-2 ${CARD.padded}`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase">Staff</h2>
            {canEdit && <div className="flex gap-1.5 print:hidden">
              <button onClick={() => withLockCheck(() => setModal('sick'))} disabled={saving} className={`${BADGE.red} cursor-pointer transition-colors duration-150 hover:bg-red-100 disabled:opacity-50`}>+Sick</button>
              <button onClick={() => withLockCheck(() => setModal('noshow'))} disabled={saving} className={`${BADGE.pink} cursor-pointer transition-colors duration-150 hover:bg-pink-100 disabled:opacity-50`}>+No Show</button>
              <button onClick={() => withLockCheck(() => setModal('al'))} disabled={saving} className={`${BADGE.amber} cursor-pointer transition-colors duration-150 hover:bg-amber-100 disabled:opacity-50`}>+AL</button>
              <button onClick={() => withLockCheck(() => setModal('ot'))} disabled={saving} className={`${BADGE.orange} cursor-pointer transition-colors duration-150 hover:bg-orange-100 disabled:opacity-50`}>+OT</button>
              <button onClick={() => withLockCheck(() => setModal('agency'))} disabled={saving} className={`${BADGE.red} cursor-pointer transition-colors duration-150 hover:bg-red-100 disabled:opacity-50`}>+Agency</button>
              <button onClick={() => withLockCheck(() => setModal('training'))} disabled={saving} className={`${BADGE.blue} cursor-pointer transition-colors duration-150 hover:bg-blue-100 disabled:opacity-50`}>+Training</button>
              <button onClick={() => withLockCheck(() => setModal('sleepIn'))} disabled={saving} className={`${BADGE.purple} cursor-pointer transition-colors duration-150 hover:bg-purple-100 disabled:opacity-50`}>+Sleep In</button>
              <button onClick={() => withLockCheck(() => setModal('swap'))} disabled={saving} className={`${BADGE.blue} cursor-pointer transition-colors duration-150 hover:bg-blue-100 disabled:opacity-50`}>+Swap</button>
            </div>}
          </div>

          <StaffTable title="Early" staff={earlyStaff} bgColor="bg-blue-50 text-blue-700" />
          <StaffTable title="Late" staff={lateStaff} bgColor="bg-indigo-50 text-indigo-700" />
          <StaffTable title="Night" staff={nightStaff} bgColor="bg-purple-50 text-purple-700" />
          <StaffTable title="Sick" staff={sickStaff} bgColor="bg-red-50 text-red-700" />
          <StaffTable title="No Show" staff={noShowStaff} bgColor="bg-pink-50 text-pink-700" />
          <StaffTable title="Annual Leave" staff={alStaff} bgColor="bg-yellow-50 text-yellow-700" />

          {/* Available Cover */}
          <div className="mt-3 border-t pt-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Available Cover ({availableCover.length})</h3>
            {availableCover.length === 0 ? (
              <div className="text-xs text-gray-400">No available staff</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {availableCover.map(s => (
                  <div key={s.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-2 py-1 text-xs">
                    <span className="font-medium">{s.name} <span className="text-gray-400">({s.role})</span></span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                      s.fatigue.exceeded ? ESC_COLORS.red.badge :
                      s.fatigue.atRisk ? ESC_COLORS.amber.badge : ESC_COLORS.green.badge
                    }`}>{s.fatigue.consecutive}d</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Coverage gap cascade panel — appears after marking sick */}
          {showGapPanel && gapPanelDate === dateStr && (
            <DailyStatusCoverageGapPanel
              schedData={schedData}
              staffForDay={staffForDay}
              coverage={coverage}
              currentDate={currentDate}
              gapPanelAbsentStaffId={gapPanelAbsentStaffId}
              saving={saving}
              onDismiss={() => setShowGapPanel(false)}
              onApplyOverride={applyOverride}
              onOpenAgencyBooking={() => {
                setShowGapPanel(false);
                setModal('agency');
              }}
            />
          )}
        </div>
      </div>

      <DailyStatusModal
        modal={modal}
        isOpen={!!modal}
        onClose={closeModal}
        staffForDay={staffForDay}
        currentDate={currentDate}
        dateStr={dateStr}
        schedData={schedData}
        coverage={coverage}
        availableStaff={availableStaff}
        selectedStaff={selectedStaff}
        setSelectedStaff={setSelectedStaff}
        manualShiftType={manualShiftType}
        setManualShiftType={setManualShiftType}
        otShiftType={otShiftType}
        setOtShiftType={setOtShiftType}
        agencyShiftType={agencyShiftType}
        setAgencyShiftType={setAgencyShiftType}
        swapFrom={swapFrom}
        setSwapFrom={setSwapFrom}
        swapTo={swapTo}
        setSwapTo={setSwapTo}
        canEdit={canEdit}
        saving={saving}
        alCount={alCount}
        gapPanelAbsentStaffId={gapPanelAbsentStaffId}
        onApplyOverride={applyOverride}
        onApplySickOverride={applySickOverride}
        onApplyNoShowOverride={applyNoShowOverride}
        onToggleSleepIn={toggleSleepIn}
        onApplyManualShiftEdit={applyManualShiftEdit}
        onHandlePermanentSwap={handlePermanentSwap}
        onHandleTemporarySwap={handleTemporarySwap}
        onHandleAgencyBooking={handleAgencyBooking}
      />
    </div>
  );
}
