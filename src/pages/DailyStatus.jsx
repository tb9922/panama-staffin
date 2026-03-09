import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  formatDate, parseDate, addDays, getStaffForDay, getShiftHours,
  isWorkingShift, isEarlyShift, isLateShift, isNightShift, isCareRole,
  SHIFT_COLORS, countALOnDate,
} from '../lib/rotation.js';
import {
  getDayCoverageStatus, calculateDayCost, checkFatigueRisk, validateSwap,
} from '../lib/escalation.js';
import { calculateAccrual } from '../lib/accrual.js';
import { CARD, TABLE, INPUT, BTN, BADGE, MODAL, PAGE, ESC_COLORS } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import useEscapeKey from '../hooks/useEscapeKey.js';
import { getOnboardingBlockingReasons } from '../lib/onboarding.js';
import { getTrainingBlockingReasons } from '../lib/training.js';
import {
  getCurrentHome, getLoggedInUser,
  getSchedulingData,
  upsertOverride,
  deleteOverride,
  upsertDayNote,
  updateStaffMember,
} from '../lib/api.js';

export default function DailyStatus() {
  const { date: dateParam } = useParams();
  const navigate = useNavigate();
  const currentDate = dateParam ? parseDate(dateParam) : new Date();
  const dateStr = formatDate(currentDate);

  const [schedData, setSchedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [modal, setModal] = useState(null);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [otShiftType, setOtShiftType] = useState('OC-EL');
  const [agencyShiftType, setAgencyShiftType] = useState('');
  const [swapFrom, setSwapFrom] = useState('');
  const [swapTo, setSwapTo] = useState('');
  const [showGapPanel, setShowGapPanel] = useState(false);
  const [gapPanelDate, setGapPanelDate] = useState(null);
  const [gapPanelAbsentStaffId, setGapPanelAbsentStaffId] = useState(null);

  // PIN unlock uses getCurrentHome() as the key to avoid timing dependency on data load
  const [unlockedDates, setUnlockedDates] = useState(() => {
    try {
      const homeSlug = getCurrentHome() || 'default';
      const stored = sessionStorage.getItem(`unlocked_${homeSlug}`);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [showLockPrompt, setShowLockPrompt] = useState(false);
  const [lockPin, setLockPin] = useState('');
  const [lockError, setLockError] = useState('');
  const [pendingAction, setPendingAction] = useState(null);

  const noteTimerRef = useRef(null);
  const savingRef = useRef(false);

  const closeModal = useCallback(() => {
    setModal(null);
    setSelectedStaff('');
    setSwapFrom('');
    setSwapTo('');
    setAgencyShiftType('');
  }, []);

  useEscapeKey(!!modal, closeModal);

  const currentUser = getLoggedInUser();
  const isAdmin = currentUser?.role === 'admin';

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

  // Cleanup debounce timer on unmount
  useEffect(() => () => clearTimeout(noteTimerRef.current), []);

  // Reset lock prompt state when navigating to a different date
  useEffect(() => {
    setShowLockPrompt(false);
    setLockPin('');
    setLockError('');
    setPendingAction(null);
  }, [dateStr]);

  const staffForDay = useMemo(() => {
    if (!schedData) return [];
    return getStaffForDay(schedData.staff, currentDate, schedData.overrides, schedData.config);
  }, [schedData, dateStr]);

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
  const alStaff = staffForDay.filter(s => s.shift === 'AL');
  const availableStaff = staffForDay.filter(s => (s.shift === 'AVL' || s.shift === 'OFF') && isCareRole(s.role));

  const availableCover = useMemo(() => {
    if (!schedData) return [];
    return availableStaff.map(s => {
      const fatigue = checkFatigueRisk(s, currentDate, schedData.overrides, schedData.config);
      return { ...s, fatigue };
    });
  }, [availableStaff, schedData, currentDate]);

  const today = formatDate(new Date());
  const isPastDate = dateStr < today;
  const isLocked = isPastDate && !unlockedDates.has(dateStr) && !!(schedData?.config?.edit_lock_pin);

  function goDay(offset) {
    navigate(`/day/${formatDate(addDays(currentDate, offset))}`);
  }

  async function applyOverride(staffId, shift, reason, source, sleepIn = false, replacesStaffId = null, extra = {}) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await upsertOverride(getCurrentHome(), { date: dateStr, staffId, shift, reason, source: source || 'manual', sleep_in: sleepIn, replaces_staff_id: replacesStaffId || undefined, ...extra });
      await loadData();
    } catch (e) {
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
        await upsertOverride(getCurrentHome(), {
          date: dateStr,
          staffId,
          shift: existing.shift,
          reason: existing.reason,
          source: existing.source,
          sleep_in: !existing.sleep_in,
          replaces_staff_id: existing.replaces_staff_id,
          override_hours: existing.override_hours,
        });
      } else {
        const s = staffForDay.find(m => m.id === staffId);
        await upsertOverride(getCurrentHome(), {
          date: dateStr,
          staffId,
          shift: s?.scheduledShift || 'OFF',
          reason: 'Sleep in',
          source: 'manual',
          sleep_in: true,
        });
      }
      await loadData();
    } catch (e) {
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
      await deleteOverride(getCurrentHome(), dateStr, staffId);
      await loadData();
    } catch (e) {
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
      await upsertOverride(getCurrentHome(), { date: dateStr, staffId, shift: 'SICK', reason: 'Sick', source: 'manual' });
      await loadData();
    } catch (e) {
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
    if (projectedCoverage.overallLevel >= 1) {
      setShowGapPanel(true);
      setGapPanelDate(dateStr);
      setGapPanelAbsentStaffId(staffId);
    }
  }

  function unlockDate() {
    const homeSlug = getCurrentHome() || 'default';
    const newUnlocked = new Set(unlockedDates);
    newUnlocked.add(dateStr);
    setUnlockedDates(newUnlocked);
    try {
      sessionStorage.setItem(`unlocked_${homeSlug}`, JSON.stringify([...newUnlocked]));
    } catch { /* quota exceeded — in-memory unlock still works */ }
    setShowLockPrompt(false);
    setLockPin('');
    setLockError('');
    if (pendingAction) { pendingAction.fn(); setPendingAction(null); }
  }

  function attemptUnlock() {
    if (!schedData) return;
    const pin = String(schedData.config.edit_lock_pin || '');
    if (!pin) { unlockDate(); return; }
    if (String(lockPin) === pin) { unlockDate(); }
    else { setLockError('Incorrect PIN'); setLockPin(''); }
  }

  // Wraps any write action with a past-date lock check
  function withLockCheck(action) {
    if (!isLocked) { action(); return; }
    setPendingAction({ fn: action });
    setShowLockPrompt(true);
  }

  const escColor = (esc) => {
    if (!esc) return '';
    const colorKey = esc.color;
    if (ESC_COLORS[colorKey]) return ESC_COLORS[colorKey].badge;
    return 'bg-gray-100 text-gray-600';
  };

  const alCount = schedData ? countALOnDate(currentDate, schedData.overrides) : 0;
  const dayName = currentDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

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

  // Cascade coverage panel — shown after a sick override creates a gap
  const CoverageGapPanel = () => {
    if (!schedData) return null;
    const floaters = staffForDay.filter(s => s.shift === 'AVL' && isCareRole(s.role));
    const otCandidates = staffForDay.filter(s =>
      isCareRole(s.role) && !isWorkingShift(s.shift) && s.shift !== 'SICK' && s.shift !== 'AL'
    );
    const shortPeriods = ['early', 'late', 'night'].filter(p => coverage[p] && coverage[p].escalation.level >= 1);
    const periodShift = { early: 'E', late: 'L', night: 'N' };
    const periodOcShift = { early: 'OC-E', late: 'OC-L', night: 'OC-N' };
    const label = p => p.charAt(0).toUpperCase() + p.slice(1);
    return (
      <div className="mt-4 border border-amber-200 bg-amber-50 rounded-xl p-4 print:hidden">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-amber-800">Coverage Gap — action needed</h3>
          <button onClick={() => setShowGapPanel(false)} className={`${BTN.ghost} ${BTN.xs} text-gray-400`}>Dismiss</button>
        </div>
        <p className="text-xs text-amber-700 mb-3">
          {shortPeriods.length > 0
            ? `Short: ${shortPeriods.map(label).join(', ')} — below minimum staffing`
            : 'Coverage affected — review options below'}
        </p>
        <div className="mb-3">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">1 — Deploy Float</div>
          {floaters.length === 0
            ? <div className="text-xs text-gray-400">No floaters available today</div>
            : <div className="space-y-1">
                {floaters.map(s => {
                  const fatigue = checkFatigueRisk(s, currentDate, schedData.overrides, schedData.config);
                  return (
                    <div key={s.id} className="flex items-center justify-between bg-white rounded-lg px-2 py-1.5 border border-gray-100">
                      <span className="text-xs font-medium">{s.name} <span className="text-gray-400 text-[10px]">({s.role})</span></span>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-medium ${fatigue.exceeded ? 'text-red-500' : fatigue.atRisk ? 'text-amber-500' : 'text-gray-400'}`}>{fatigue.consecutive}d</span>
                        {shortPeriods.map(p => (
                          <button key={p} onClick={() => applyOverride(s.id, periodShift[p], `Float deployed — ${p} gap cover`, 'manual', false, gapPanelAbsentStaffId)} disabled={saving} className={`${BTN.success} ${BTN.xs} disabled:opacity-50`}>{label(p)}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
          }
        </div>
        <div className="mb-3">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">2 — Call In (OT)</div>
          {otCandidates.length === 0
            ? <div className="text-xs text-gray-400">No off-duty staff available</div>
            : <div className="space-y-1">
                {otCandidates.slice(0, 5).map(s => {
                  const fatigue = checkFatigueRisk(s, currentDate, schedData.overrides, schedData.config);
                  return (
                    <div key={s.id} className="flex items-center justify-between bg-white rounded-lg px-2 py-1.5 border border-gray-100">
                      <span className="text-xs font-medium">{s.name} <span className="text-gray-400 text-[10px]">({s.shift})</span></span>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-medium ${fatigue.exceeded ? 'text-red-500' : fatigue.atRisk ? 'text-amber-500' : 'text-gray-400'}`}>{fatigue.consecutive}d</span>
                        {shortPeriods.map(p => (
                          <button key={p} onClick={() => applyOverride(s.id, periodOcShift[p], `Called in — ${p} OT`, 'ot', false, gapPanelAbsentStaffId)} disabled={saving} className={`${BTN.primary} ${BTN.xs} disabled:opacity-50`}>{label(p)}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
          }
        </div>
        <div>
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">3 — Book Agency</div>
          <button onClick={() => { setShowGapPanel(false); setModal('agency'); }} className={`${BTN.danger} ${BTN.xs}`}>Open Agency Booking</button>
        </div>
      </div>
    );
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
        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${SHIFT_COLORS[s.shift] || 'bg-gray-100'}`}>{s.shift}</span>
        {s.sleep_in && <span className={`${BADGE.purple} ml-1`}>SI</span>}
        {s.replaces_staff_id && (() => {
          const replaced = staffForDay.find(m => m.id === s.replaces_staff_id);
          return <span className={`${BADGE.amber} ml-1`} title={`Covers for ${replaced?.name || s.replaces_staff_id}`}>covers {replaced?.name?.split(' ')[0] || s.replaces_staff_id}</span>;
        })()}
      </td>
      <td className={`${TABLE.td} text-xs text-gray-500`}>{s.skill}</td>
      <td className={`${TABLE.td} text-xs text-gray-500`}>{s.reason || ''}</td>
      <td className={TABLE.td}>
        {isAdmin && s.isOverride && (
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

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error) return (
    <div className="p-6">
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm flex items-center justify-between">
        <span>{error}</span>
        <button onClick={() => { setError(null); loadData(); }} className="text-red-900 underline text-xs ml-4">Retry</button>
      </div>
    </div>
  );

  if (!schedData) return null;

  return (
    <div className={PAGE.container}>
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
          <button onClick={() => navigate(`/day/${formatDate(new Date())}`)} className={`${BTN.ghost} ${BTN.sm} text-blue-600`}>Today</button>
        </div>
      </div>

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
            onChange={e => { setLockPin(e.target.value); setLockError(''); }}
            onKeyDown={e => e.key === 'Enter' && attemptUnlock()}
            placeholder="PIN"
            className={`${INPUT.sm} w-20`}
            autoFocus
          />
          <button onClick={attemptUnlock} className={`${BTN.primary} ${BTN.sm}`}>Unlock</button>
          <button onClick={() => { setShowLockPrompt(false); setLockPin(''); setLockError(''); setPendingAction(null); }} className={`${BTN.ghost} ${BTN.sm}`}>Cancel</button>
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
            AL: {alCount}/{schedData.config.max_al_same_day} | Sick: {sickStaff.length}
          </div>

          {/* Day Notes */}
          <div className="border-t mt-3 pt-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Handover Notes</h3>
            <textarea
              value={schedData.day_notes?.[dateStr] || ''}
              readOnly={isLocked || !isAdmin}
              onChange={e => {
                if (isLocked || !isAdmin) return;
                const note = e.target.value;
                // Optimistic local update for responsive UI
                setSchedData(prev => ({
                  ...prev,
                  day_notes: { ...prev.day_notes, [dateStr]: note },
                }));
                clearTimeout(noteTimerRef.current);
                noteTimerRef.current = setTimeout(async () => {
                  try {
                    await upsertDayNote(getCurrentHome(), dateStr, note);
                  } catch (err) {
                    setError(err.message);
                  }
                }, 800);
              }}
              placeholder={isLocked ? 'Unlock to edit notes' : !isAdmin ? 'View only' : 'Add notes for handover, incidents, or reminders...'}
              className={`${INPUT.base} h-20 resize-y ${isLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
          </div>
        </div>

        {/* Staff Lists */}
        <div className={`lg:col-span-2 ${CARD.padded}`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase">Staff</h2>
            {isAdmin && <div className="flex gap-1.5 print:hidden">
              <button onClick={() => withLockCheck(() => setModal('sick'))} disabled={saving} className={`${BADGE.red} cursor-pointer transition-colors duration-150 hover:bg-red-100 disabled:opacity-50`}>+Sick</button>
              <button onClick={() => withLockCheck(() => setModal('al'))} disabled={saving} className={`${BADGE.amber} cursor-pointer transition-colors duration-150 hover:bg-amber-100 disabled:opacity-50`}>+AL</button>
              <button onClick={() => withLockCheck(() => setModal('ot'))} disabled={saving} className={`${BADGE.orange} cursor-pointer transition-colors duration-150 hover:bg-orange-100 disabled:opacity-50`}>+OT</button>
              <button onClick={() => withLockCheck(() => setModal('agency'))} disabled={saving} className={`${BADGE.red} cursor-pointer transition-colors duration-150 hover:bg-red-100 disabled:opacity-50`}>+Agency</button>
              <button onClick={() => withLockCheck(() => setModal('training'))} disabled={saving} className={`${BADGE.blue} cursor-pointer transition-colors duration-150 hover:bg-blue-100 disabled:opacity-50`}>+Training</button>
              <button onClick={() => withLockCheck(() => setModal('sleepIn'))} disabled={saving} className={`${BADGE.purple} cursor-pointer transition-colors duration-150 hover:bg-purple-100 disabled:opacity-50`}>+Sleep In</button>
              <button onClick={() => withLockCheck(() => setModal('swap'))} disabled={saving} className={`${BADGE.blue} cursor-pointer transition-colors duration-150 hover:bg-blue-100 disabled:opacity-50`}>Swap</button>
            </div>}
          </div>

          <StaffTable title="Early" staff={earlyStaff} bgColor="bg-blue-50 text-blue-700" />
          <StaffTable title="Late" staff={lateStaff} bgColor="bg-indigo-50 text-indigo-700" />
          <StaffTable title="Night" staff={nightStaff} bgColor="bg-purple-50 text-purple-700" />
          <StaffTable title="Sick" staff={sickStaff} bgColor="bg-red-50 text-red-700" />
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
          {showGapPanel && gapPanelDate === dateStr && <CoverageGapPanel />}
        </div>
      </div>

      {/* Modal */}
      <Modal isOpen={!!modal} onClose={closeModal} title={modal === 'sick' ? 'Mark Sick' : modal === 'al' ? 'Book AL' : modal === 'ot' ? 'Book OT' : modal === 'swap' ? 'Swap Shifts' : modal === 'training' ? 'Book Training' : modal === 'sleepIn' ? 'Toggle Sleep In' : 'Book Agency'} size="sm">
            {modal === 'swap' ? (
              <div className="space-y-3">
                <div>
                  <label className={INPUT.label}>Staff A (gives their shift)</label>
                  <select value={swapFrom} onChange={e => setSwapFrom(e.target.value)} className={INPUT.select}>
                    <option value="">Select...</option>
                    {staffForDay.filter(s => isWorkingShift(s.shift) && isCareRole(s.role)).map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.shift})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={INPUT.label}>Staff B (takes their shift)</label>
                  <select value={swapTo} onChange={e => setSwapTo(e.target.value)} className={INPUT.select}>
                    <option value="">Select...</option>
                    {staffForDay.filter(s => isCareRole(s.role) && s.id !== swapFrom).map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.shift})</option>
                    ))}
                  </select>
                </div>
                {swapFrom && swapTo && (() => {
                  const a = staffForDay.find(s => s.id === swapFrom);
                  const b = staffForDay.find(s => s.id === swapTo);
                  if (!a || !b) return null;
                  const valAB = validateSwap(a, b, currentDate, schedData.overrides, schedData.config, schedData.training);
                  const valBA = validateSwap(b, a, currentDate, schedData.overrides, schedData.config, schedData.training);
                  const allIssues = [...valAB.issues, ...valBA.issues];
                  const configShifts = schedData.config.shifts || {};
                  const hrs = s => {
                    if (!s) return 0;
                    if (s.startsWith('OC-') || s.startsWith('AG-')) return configShifts[s.slice(3)]?.hours || 0;
                    if (s === 'BH-D') return configShifts.EL?.hours || configShifts.E?.hours || 0;
                    if (s === 'BH-N') return configShifts.N?.hours || 0;
                    return configShifts[s]?.hours || 0;
                  };
                  const costBefore = hrs(a.shift) * (a.hourly_rate || 0) + hrs(b.shift) * (b.hourly_rate || 0);
                  const costAfter  = hrs(b.shift) * (a.hourly_rate || 0) + hrs(a.shift) * (b.hourly_rate || 0);
                  const costDelta  = costAfter - costBefore;
                  return (
                    <div className="space-y-1">
                      <div className="text-xs text-gray-500 bg-gray-50 rounded-xl px-2 py-1">
                        {a.name} ({a.shift}) &harr; {b.name} ({b.shift})
                      </div>
                      {allIssues.map((issue, i) => (
                        <div key={i} className={`text-xs px-2 py-1 rounded-xl ${issue.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                          {issue.msg}
                        </div>
                      ))}
                      {allIssues.length === 0 && <div className="text-xs text-green-600 bg-green-50 rounded-xl px-2 py-1">Safe to swap</div>}
                      {a.shift !== b.shift && (
                        <div className={`text-xs px-2 py-1 rounded-xl ${costDelta > 0.01 ? 'bg-red-50 text-red-700' : costDelta < -0.01 ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>
                          Cost impact: {Math.abs(costDelta) < 0.01 ? 'No change' : `${costDelta > 0 ? '+' : ''}£${costDelta.toFixed(2)} today`}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className={MODAL.footer}>
                  <button onClick={closeModal} className={BTN.ghost}>Cancel</button>
                  {(() => {
                    const a = staffForDay.find(s => s.id === swapFrom);
                    const b = staffForDay.find(s => s.id === swapTo);
                    const canSwap = !!(swapFrom && swapTo && swapFrom !== swapTo);
                    const isFloat = a?.team === 'Float' || b?.team === 'Float';
                    return (
                      <>
                        {isAdmin && (
                          <button
                            disabled={!canSwap || isFloat || saving}
                            title={isFloat ? 'Float staff have no fixed rotation to swap permanently' : `${a?.name}: ${a?.team} → ${b?.team} | ${b?.name}: ${b?.team} → ${a?.team}`}
                            onClick={async () => {
                              if (!a || !b) return;
                              setSaving(true);
                              try {
                                await updateStaffMember(getCurrentHome(), a.id, { ...schedData.staff.find(s => s.id === a.id), team: b.team });
                                await updateStaffMember(getCurrentHome(), b.id, { ...schedData.staff.find(s => s.id === b.id), team: a.team });
                                await loadData();
                              } catch (e) {
                                setError(e.message);
                              } finally {
                                setSaving(false);
                              }
                              setModal(null); setSwapFrom(''); setSwapTo('');
                            }}
                            className={`${BTN.secondary} disabled:opacity-50 text-xs`}
                          >
                            {canSwap && !isFloat ? `Permanent (${a.team} ↔ ${b.team})` : 'Permanent'}
                          </button>
                        )}
                        <button
                          disabled={!canSwap || saving}
                          onClick={async () => {
                            if (!a || !b) return;
                            setSaving(true);
                            try {
                              await upsertOverride(getCurrentHome(), { date: dateStr, staffId: swapFrom, shift: b.shift, reason: `Swapped with ${b.name}`, source: 'swap' });
                              await upsertOverride(getCurrentHome(), { date: dateStr, staffId: swapTo, shift: a.shift, reason: `Swapped with ${a.name}`, source: 'swap' });
                              await loadData();
                            } catch (e) {
                              setError(e.message);
                            } finally {
                              setSaving(false);
                            }
                            setModal(null); setSwapFrom(''); setSwapTo('');
                          }}
                          className={`${BTN.primary} disabled:opacity-50`}
                        >
                          {saving ? 'Saving...' : 'Today Only'}
                        </button>
                      </>
                    );
                  })()}
                </div>
              </div>
            ) : modal === 'agency' ? (
              <div className="space-y-3">
                <select value={agencyShiftType} onChange={e => setAgencyShiftType(e.target.value)} className={INPUT.select}>
                  <option value="">Select shift type...</option>
                  <option value="AG-E">Agency Early (AG-E)</option>
                  <option value="AG-L">Agency Late (AG-L)</option>
                  <option value="AG-EL">Agency Full Day (AG-EL)</option>
                  <option value="AG-N">Agency Night (AG-N)</option>
                </select>
                {agencyShiftType && (() => {
                  const agPeriods = agencyShiftType === 'AG-E' ? 'Early'
                    : agencyShiftType === 'AG-L' ? 'Late'
                    : agencyShiftType === 'AG-EL' ? 'Early + Late (full day)'
                    : 'Night';
                  const agHours = getShiftHours(agencyShiftType, schedData.config);
                  const isNight = agencyShiftType === 'AG-N';
                  const agRate = isNight ? (schedData.config.agency_rate_night || 0) : (schedData.config.agency_rate_day || 0);
                  const agCost = (agHours * agRate).toFixed(2);
                  const shortPeriods = ['early', 'late', 'night'].filter(p => coverage[p] && coverage[p].escalation.level >= 1);
                  const absentToday = staffForDay.filter(s => s.shift === 'SICK' || s.shift === 'AL');
                  return (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 space-y-1.5 text-xs">
                      <div className="font-semibold text-blue-700">Booking — {dateStr}</div>
                      <div className="text-gray-600"><span className="font-medium">Covers:</span> {agPeriods}</div>
                      {shortPeriods.length > 0 && (
                        <div className="text-amber-700"><span className="font-medium">Gap:</span> {shortPeriods.join(', ')} below minimum</div>
                      )}
                      <div className="text-gray-600">
                        <span className="font-medium">Rate:</span> £{agRate.toFixed(2)}/hr ({isNight ? 'night' : 'day'}) &middot; {agHours}h &middot; est. <strong>£{agCost}</strong>
                      </div>
                      {absentToday.length > 0 && (
                        <div className="text-gray-500"><span className="font-medium">Absent today:</span> {absentToday.map(s => `${s.name} (${s.shift})`).join(', ')}</div>
                      )}
                    </div>
                  );
                })()}
                <div className={MODAL.footer}>
                  <button onClick={closeModal} className={BTN.ghost}>Cancel</button>
                  <button disabled={!agencyShiftType || saving} onClick={async () => {
                    const agId = 'AG-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
                    setSaving(true);
                    try {
                      await upsertOverride(getCurrentHome(), { date: dateStr, staffId: agId, shift: agencyShiftType, reason: 'Agency', source: 'agency', replaces_staff_id: gapPanelAbsentStaffId || undefined });
                      await loadData();
                    } catch (e) {
                      setError(e.message);
                    } finally {
                      setSaving(false);
                    }
                    setModal(null); setAgencyShiftType('');
                  }} className={`${BTN.danger} disabled:opacity-50`}>{saving ? 'Booking...' : 'Book'}</button>
                </div>
              </div>
            ) : modal === 'training' ? (
              <div className="space-y-3">
                <select value={selectedStaff} onChange={e => setSelectedStaff(e.target.value)} className={INPUT.select}>
                  <option value="">Select staff...</option>
                  {staffForDay.filter(s => isCareRole(s.role))
                    .map(s => <option key={s.id} value={s.id}>{s.name} ({s.shift})</option>)}
                </select>
                <div className={MODAL.footer}>
                  <button onClick={closeModal} className={BTN.ghost}>Cancel</button>
                  <button disabled={!selectedStaff || saving} onClick={() => applyOverride(selectedStaff, 'TRN', 'Training', 'manual')}
                    className={`${BTN.primary} disabled:opacity-50`}>{saving ? 'Saving...' : 'Confirm'}</button>
                </div>
              </div>
            ) : modal === 'sleepIn' ? (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">Sleep-in is a flat-rate addition to the current shift (Mencap ruling). Staff remain on their rostered shift.</p>
                <select value={selectedStaff} onChange={e => setSelectedStaff(e.target.value)} className={INPUT.select}>
                  <option value="">Select staff...</option>
                  {staffForDay.filter(s => isCareRole(s.role))
                    .map(s => <option key={s.id} value={s.id}>{s.name} ({s.shift}){s.sleep_in ? ' — remove SI' : ' — add SI'}</option>)}
                </select>
                <div className={MODAL.footer}>
                  <button onClick={closeModal} className={BTN.ghost}>Cancel</button>
                  <button disabled={!selectedStaff || saving} onClick={() => toggleSleepIn(selectedStaff)}
                    className={`${BTN.primary} disabled:opacity-50`}>{saving ? 'Saving...' : 'Confirm'}</button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <select value={selectedStaff} onChange={e => setSelectedStaff(e.target.value)} className={INPUT.select}>
                  <option value="">Select staff...</option>
                  {(modal === 'ot' ? availableStaff : staffForDay.filter(s => isWorkingShift(s.shift)))
                    .map(s => <option key={s.id} value={s.id}>{s.name} ({s.shift})</option>)}
                </select>
                {modal === 'ot' && selectedStaff && (
                  <select value={otShiftType} onChange={e => setOtShiftType(e.target.value)} className={INPUT.select}>
                    <option value="OC-E">OC-E (Early)</option>
                    <option value="OC-L">OC-L (Late)</option>
                    <option value="OC-EL">OC-EL (Full Day)</option>
                    <option value="OC-N">OC-N (Night)</option>
                  </select>
                )}
                {modal === 'al' && alCount >= schedData.config.max_al_same_day && (
                  <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded-xl">Max AL ({schedData.config.max_al_same_day}) reached</div>
                )}
                {modal === 'al' && selectedStaff && (() => {
                  const staff = schedData.staff.find(s => s.id === selectedStaff);
                  if (!staff) return null;
                  const accrual = calculateAccrual(staff, schedData.config, schedData.overrides, currentDate);
                  if (accrual.missingContractHours) {
                    return <div className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-xl">
                      Set contract hours in Staff Database to enable AL booking
                    </div>;
                  }
                  if (accrual.remainingHours <= 0) {
                    return <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded-xl">
                      No AL remaining ({accrual.accruedHours.toFixed(1)}h earned, {accrual.usedHours.toFixed(1)}h used)
                    </div>;
                  }
                  return <div className="text-xs text-gray-500">AL: {accrual.remainingHours.toFixed(1)}h remaining</div>;
                })()}
                <div className={MODAL.footer}>
                  <button onClick={closeModal} className={BTN.ghost}>Cancel</button>
                  <button disabled={!selectedStaff || saving || (modal === 'al' && alCount >= schedData.config.max_al_same_day) || (modal === 'al' && selectedStaff && (() => {
                    const staff = schedData.staff.find(s => s.id === selectedStaff);
                    if (!staff) return false;
                    const acc = calculateAccrual(staff, schedData.config, schedData.overrides, currentDate);
                    return acc.remainingHours <= 0 || acc.missingContractHours;
                  })())} onClick={() => {
                    if (modal === 'sick') applySickOverride(selectedStaff);
                    else if (modal === 'al') {
                      // al_hours computed by backend — pass hint for optimistic display
                      applyOverride(selectedStaff, 'AL', 'Annual leave', 'manual', false, null, {});
                    }
                    else {
                      applyOverride(selectedStaff, otShiftType, 'OT booked', 'ot');
                    }
                  }} className={`${BTN.primary} disabled:opacity-50`}>{saving ? 'Saving...' : 'Confirm'}</button>
                </div>
              </div>
            )}
      </Modal>
    </div>
  );
}
