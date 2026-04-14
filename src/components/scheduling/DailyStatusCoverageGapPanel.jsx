import { useState } from 'react';
import { BTN } from '../../lib/design.js';
import { isWorkingShift, isCareRole } from '../../lib/rotation.js';
import { checkFatigueRisk } from '../../lib/escalation.js';

export default function DailyStatusCoverageGapPanel({
  schedData,
  staffForDay,
  coverage,
  currentDate,
  gapPanelAbsentStaffId,
  saving,
  onDismiss,
  onApplyOverride,
  onOpenAgencyBooking,
}) {
  const [showAllOtCandidates, setShowAllOtCandidates] = useState(false);
  if (!schedData) return null;

  const floaters = staffForDay.filter(staff => staff.shift === 'AVL' && isCareRole(staff.role));
  const otCandidates = staffForDay.filter(staff =>
    isCareRole(staff.role) && !isWorkingShift(staff.shift) && staff.shift !== 'SICK' && staff.shift !== 'AL'
  );
  const visibleOtCandidates = showAllOtCandidates ? otCandidates : otCandidates.slice(0, 5);
  const shortPeriods = ['early', 'late', 'night'].filter(period => coverage[period] && coverage[period].escalation.level >= 1);
  const periodShift = { early: 'E', late: 'L', night: 'N' };
  const periodOcShift = { early: 'OC-E', late: 'OC-L', night: 'OC-N' };
  const label = period => period.charAt(0).toUpperCase() + period.slice(1);

  return (
    <div className="mt-4 border border-amber-200 bg-amber-50 rounded-xl p-4 print:hidden">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-amber-800">Coverage Gap - action needed</h3>
        <button onClick={onDismiss} className={`${BTN.ghost} ${BTN.xs} text-gray-400`}>Dismiss</button>
      </div>
      <p className="text-xs text-amber-700 mb-3">
        {shortPeriods.length > 0
          ? `Short: ${shortPeriods.map(label).join(', ')} - below minimum staffing`
          : 'Coverage affected - review options below'}
      </p>
      <div className="mb-3">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">1 - Deploy Float</div>
        {floaters.length === 0 ? (
          <div className="text-xs text-gray-400">No floaters available today</div>
        ) : (
          <div className="space-y-1">
            {floaters.map(staff => {
              const fatigue = checkFatigueRisk(staff, currentDate, schedData.overrides, schedData.config);
              return (
                <div key={staff.id} className="flex items-center justify-between bg-white rounded-lg px-2 py-1.5 border border-gray-100">
                  <span className="text-xs font-medium">{staff.name} <span className="text-gray-400 text-[10px]">({staff.role})</span></span>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-medium ${fatigue.exceeded ? 'text-red-500' : fatigue.atRisk ? 'text-amber-500' : 'text-gray-400'}`} title={`${fatigue.consecutive} consecutive working days`}>{fatigue.consecutive}d</span>
                    {shortPeriods.map(period => (
                      <button
                        key={period}
                        onClick={() => onApplyOverride(staff.id, periodShift[period], `Float deployed - ${period} gap cover`, 'manual', false, gapPanelAbsentStaffId)}
                        disabled={saving}
                        className={`${BTN.success} ${BTN.xs} disabled:opacity-50`}
                      >
                        {label(period)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="mb-3">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">2 - Call In (Overtime)</div>
        {otCandidates.length === 0 ? (
          <div className="text-xs text-gray-400">No off-duty staff available</div>
        ) : (
          <div className="space-y-1">
            {otCandidates.length > 5 && (
              <div className="flex items-center justify-between gap-2 text-xs text-amber-700">
                <span>{showAllOtCandidates ? `Showing all ${otCandidates.length} overtime candidates.` : `Showing the first 5 of ${otCandidates.length} overtime candidates.`}</span>
                <button
                  type="button"
                  onClick={() => setShowAllOtCandidates((value) => !value)}
                  className={`${BTN.ghost} ${BTN.xs}`}
                >
                  {showAllOtCandidates ? 'Show fewer' : 'Show all'}
                </button>
              </div>
            )}
            {visibleOtCandidates.map(staff => {
              const fatigue = checkFatigueRisk(staff, currentDate, schedData.overrides, schedData.config);
              return (
                <div key={staff.id} className="flex items-center justify-between bg-white rounded-lg px-2 py-1.5 border border-gray-100">
                  <span className="text-xs font-medium">{staff.name} <span className="text-gray-400 text-[10px]">({staff.shift})</span></span>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-medium ${fatigue.exceeded ? 'text-red-500' : fatigue.atRisk ? 'text-amber-500' : 'text-gray-400'}`} title={`${fatigue.consecutive} consecutive working days`}>{fatigue.consecutive}d</span>
                    {shortPeriods.map(period => (
                      <button
                        key={period}
                        onClick={() => onApplyOverride(staff.id, periodOcShift[period], `Called in - ${period} OT`, 'ot', false, gapPanelAbsentStaffId)}
                        disabled={saving}
                        className={`${BTN.primary} ${BTN.xs} disabled:opacity-50`}
                      >
                        {label(period)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">3 - Book Agency</div>
        <button onClick={onOpenAgencyBooking} className={`${BTN.danger} ${BTN.xs}`}>Open Agency Booking</button>
      </div>
    </div>
  );
}
