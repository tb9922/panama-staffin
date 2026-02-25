import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  formatDate, parseDate, addDays, getStaffForDay,
  isWorkingShift, isEarlyShift, isLateShift, isNightShift, isCareRole,
  SHIFT_COLORS, countALOnDate,
} from '../lib/rotation.js';
import {
  getDayCoverageStatus, calculateDayCost, checkFatigueRisk, validateSwap,
} from '../lib/escalation.js';
import { CARD, TABLE, INPUT, BTN, BADGE, MODAL, PAGE, ESC_COLORS } from '../lib/design.js';
import { getOnboardingBlockingReasons } from '../lib/onboarding.js';
import { getTrainingBlockingReasons } from '../lib/training.js';

export default function DailyStatus({ data, updateData }) {
  const { date: dateParam } = useParams();
  const navigate = useNavigate();
  const currentDate = dateParam ? parseDate(dateParam) : new Date();
  const dateStr = formatDate(currentDate);

  const [modal, setModal] = useState(null);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [otShiftType, setOtShiftType] = useState('OC-EL');
  const [swapFrom, setSwapFrom] = useState('');
  const [swapTo, setSwapTo] = useState('');

  const staffForDay = useMemo(() => getStaffForDay(data.staff, currentDate, data.overrides, data.config), [data, dateStr]);
  const coverage = useMemo(() => getDayCoverageStatus(staffForDay, data.config), [staffForDay, data.config]);
  const cost = useMemo(() => calculateDayCost(staffForDay, data.config), [staffForDay, data.config]);

  const earlyStaff = staffForDay.filter(s => isCareRole(s.role) && isEarlyShift(s.shift));
  const lateStaff = staffForDay.filter(s => isCareRole(s.role) && isLateShift(s.shift));
  const nightStaff = staffForDay.filter(s => isCareRole(s.role) && isNightShift(s.shift));
  const sickStaff = staffForDay.filter(s => s.shift === 'SICK');
  const alStaff = staffForDay.filter(s => s.shift === 'AL');
  const availableStaff = staffForDay.filter(s => (s.shift === 'AVL' || s.shift === 'OFF') && isCareRole(s.role));

  const availableCover = useMemo(() => {
    return availableStaff.map(s => {
      const fatigue = checkFatigueRisk(s, currentDate, data.overrides, data.config);
      return { ...s, fatigue };
    });
  }, [availableStaff, data, currentDate]);

  function goDay(offset) {
    navigate(`/day/${formatDate(addDays(currentDate, offset))}`);
  }

  function applyOverride(staffId, shift, reason, source) {
    const newOverrides = JSON.parse(JSON.stringify(data.overrides));
    if (!newOverrides[dateStr]) newOverrides[dateStr] = {};
    newOverrides[dateStr][staffId] = { shift, reason, source: source || 'manual' };
    updateData({ ...data, overrides: newOverrides });
    setModal(null);
    setSelectedStaff('');
  }

  function removeOverride(staffId) {
    const newOverrides = JSON.parse(JSON.stringify(data.overrides));
    if (newOverrides[dateStr]) {
      delete newOverrides[dateStr][staffId];
      if (Object.keys(newOverrides[dateStr]).length === 0) delete newOverrides[dateStr];
    }
    updateData({ ...data, overrides: newOverrides });
  }

  const escColor = (esc) => {
    if (!esc) return '';
    const colorKey = esc.color;
    if (ESC_COLORS[colorKey]) return ESC_COLORS[colorKey].badge;
    return 'bg-gray-100 text-gray-600';
  };

  const alCount = countALOnDate(currentDate, data.overrides);
  const dayName = currentDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const getBlockingReasons = (s) => {
    const reasons = [];
    if (data.config.enforce_onboarding_blocking && isCareRole(s.role)) {
      reasons.push(...getOnboardingBlockingReasons(s.id, data.onboarding));
    }
    if (data.config.enforce_training_blocking && isCareRole(s.role)) {
      reasons.push(...getTrainingBlockingReasons(s.id, s.role, data.training, data.config, dateStr));
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
        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${SHIFT_COLORS[s.shift] || 'bg-gray-100'}`}>{s.shift}</span>
      </td>
      <td className={`${TABLE.td} text-xs text-gray-500`}>{s.skill}</td>
      <td className={`${TABLE.td} text-xs text-gray-500`}>{s.reason || ''}</td>
      <td className={TABLE.td}>
        {s.isOverride && (
          <button onClick={() => removeOverride(s.id)} className={`${BTN.ghost} ${BTN.xs} text-red-500 hover:text-red-700 hover:bg-red-50`}>Revert</button>
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

  return (
    <div className={PAGE.container}>
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{data.config.home_name} — Daily Status</h1>
        <p className="text-xs text-gray-500">{dayName} | Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      {/* Date Navigation */}
      <div className="flex items-center justify-between mb-4 print:hidden">
        <div className="flex items-center gap-3">
          <button onClick={() => goDay(-1)} className={`${BTN.secondary} ${BTN.sm}`}>&larr;</button>
          <h1 className={PAGE.title}>{dayName}</h1>
          <button onClick={() => goDay(1)} className={`${BTN.secondary} ${BTN.sm}`}>&rarr;</button>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => window.print()} className={`${BTN.secondary} ${BTN.sm}`}>Print</button>
          <button onClick={() => navigate(`/day/${formatDate(new Date())}`)} className={`${BTN.ghost} ${BTN.sm} text-blue-600`}>Today</button>
        </div>
      </div>

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
              <div className="flex justify-between font-bold border-t pt-1"><span>Total:</span><span>£{cost.total.toFixed(2)}</span></div>
            </div>
          </div>

          <div className="border-t mt-3 pt-2 text-xs text-gray-500">
            AL: {alCount}/{data.config.max_al_same_day} | Sick: {sickStaff.length}
          </div>

          {/* Day Notes */}
          <div className="border-t mt-3 pt-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Handover Notes</h3>
            <textarea
              value={data.day_notes?.[dateStr] || ''}
              onChange={e => {
                const newNotes = { ...(data.day_notes || {}), [dateStr]: e.target.value };
                if (!e.target.value) delete newNotes[dateStr];
                updateData({ ...data, day_notes: newNotes });
              }}
              placeholder="Add notes for handover, incidents, or reminders..."
              className={`${INPUT.base} h-20 resize-y`}
            />
          </div>
        </div>

        {/* Staff Lists */}
        <div className={`lg:col-span-2 ${CARD.padded}`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase">Staff</h2>
            <div className="flex gap-1.5 print:hidden">
              <button onClick={() => setModal('sick')} className={`${BADGE.red} cursor-pointer transition-colors duration-150 hover:bg-red-100`}>+Sick</button>
              <button onClick={() => setModal('al')} className={`${BADGE.amber} cursor-pointer transition-colors duration-150 hover:bg-amber-100`}>+AL</button>
              <button onClick={() => setModal('ot')} className={`${BADGE.orange} cursor-pointer transition-colors duration-150 hover:bg-orange-100`}>+OT</button>
              <button onClick={() => setModal('agency')} className={`${BADGE.red} cursor-pointer transition-colors duration-150 hover:bg-red-100`}>+Agency</button>
              <button onClick={() => setModal('swap')} className={`${BADGE.blue} cursor-pointer transition-colors duration-150 hover:bg-blue-100`}>Swap</button>
            </div>
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
        </div>
      </div>

      {/* Modal */}
      {modal && (
        <div className={MODAL.overlay}>
          <div className={MODAL.panelSm}>
            <h2 className={MODAL.title}>
              {modal === 'sick' ? 'Mark Sick' : modal === 'al' ? 'Book AL' : modal === 'ot' ? 'Book OT' : modal === 'swap' ? 'Swap Shifts' : 'Book Agency'}
            </h2>

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
                  const valAB = validateSwap(a, b, currentDate, data.overrides, data.config);
                  const valBA = validateSwap(b, a, currentDate, data.overrides, data.config);
                  const allIssues = [...valAB.issues, ...valBA.issues];
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
                    </div>
                  );
                })()}
                <div className={MODAL.footer}>
                  <button onClick={() => { setModal(null); setSwapFrom(''); setSwapTo(''); }} className={BTN.ghost}>Cancel</button>
                  <button disabled={!swapFrom || !swapTo || swapFrom === swapTo} onClick={() => {
                    const a = staffForDay.find(s => s.id === swapFrom);
                    const b = staffForDay.find(s => s.id === swapTo);
                    if (!a || !b) return;
                    const newOverrides = JSON.parse(JSON.stringify(data.overrides));
                    if (!newOverrides[dateStr]) newOverrides[dateStr] = {};
                    newOverrides[dateStr][swapFrom] = { shift: b.shift, reason: `Swapped with ${b.name}`, source: 'swap' };
                    newOverrides[dateStr][swapTo] = { shift: a.shift, reason: `Swapped with ${a.name}`, source: 'swap' };
                    updateData({ ...data, overrides: newOverrides });
                    setModal(null); setSwapFrom(''); setSwapTo('');
                  }} className={`${BTN.primary} disabled:opacity-50`}>Swap</button>
                </div>
              </div>
            ) : modal === 'agency' ? (
              <div className="space-y-3">
                <select value={selectedStaff} onChange={e => setSelectedStaff(e.target.value)} className={INPUT.select}>
                  <option value="">Shift type...</option>
                  <option value="AG-E">Agency Early</option>
                  <option value="AG-L">Agency Late</option>
                  <option value="AG-N">Agency Night</option>
                </select>
                <div className={MODAL.footer}>
                  <button onClick={() => { setModal(null); setSelectedStaff(''); }} className={BTN.ghost}>Cancel</button>
                  <button disabled={!selectedStaff} onClick={() => {
                    const agId = 'AG' + Date.now().toString(36).toUpperCase();
                    const newOverrides = JSON.parse(JSON.stringify(data.overrides));
                    if (!newOverrides[dateStr]) newOverrides[dateStr] = {};
                    newOverrides[dateStr][agId] = { shift: selectedStaff, reason: 'Agency', source: 'agency' };
                    updateData({ ...data, overrides: newOverrides });
                    setModal(null); setSelectedStaff('');
                  }} className={`${BTN.danger} disabled:opacity-50`}>Book</button>
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
                {modal === 'al' && alCount >= data.config.max_al_same_day && (
                  <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded-xl">Max AL ({data.config.max_al_same_day}) reached</div>
                )}
                <div className={MODAL.footer}>
                  <button onClick={() => { setModal(null); setSelectedStaff(''); }} className={BTN.ghost}>Cancel</button>
                  <button disabled={!selectedStaff || (modal === 'al' && alCount >= data.config.max_al_same_day)} onClick={() => {
                    if (modal === 'sick') applyOverride(selectedStaff, 'SICK', 'Sick', 'manual');
                    else if (modal === 'al') applyOverride(selectedStaff, 'AL', 'Annual leave', 'manual');
                    else {
                      applyOverride(selectedStaff, otShiftType, 'OT booked', 'ot');
                    }
                  }} className={`${BTN.primary} disabled:opacity-50`}>Confirm</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
