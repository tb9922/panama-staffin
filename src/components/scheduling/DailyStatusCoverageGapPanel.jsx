import { BTN } from '../../lib/design.js';
import { isWorkingShift, isCareRole } from '../../lib/rotation.js';
import { checkFatigueRisk } from '../../lib/escalation.js';
import { scoreGapFillCandidate } from '../../lib/rotationAnalysis.js';

// Renders the ranked candidate row. `score` is 0–100 composite; breakdown
// tooltip surfaces which sub-score drove the rank so managers can sanity-check.
function RankedRow({ staff, secondary, fatigue, scored, shortPeriods, label, periodLabelMap, onAssign, assignStyle, saving }) {
  const scoreCls = scored.score >= 70
    ? 'bg-emerald-100 text-emerald-700'
    : scored.score >= 40
      ? 'bg-amber-100 text-amber-700'
      : 'bg-red-100 text-red-700';
  const tooltip = `Score ${scored.score}/100 — cost ${scored.breakdown.cost} · fatigue ${scored.breakdown.fatigue} · skill ${scored.breakdown.skill} · training ${scored.breakdown.training}`;
  return (
    <div className="flex items-center justify-between bg-white rounded-lg px-2 py-1.5 border border-gray-100">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${scoreCls}`}
          title={tooltip}
        >
          {scored.score}
        </span>
        <span className="text-xs font-medium truncate">
          {staff.name}
          <span className="text-gray-400 text-[10px] ml-1">({secondary})</span>
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={`text-[10px] font-medium ${fatigue.exceeded ? 'text-red-500' : fatigue.atRisk ? 'text-amber-500' : 'text-gray-400'}`}>
          {fatigue.consecutive}d
        </span>
        {shortPeriods.map(period => (
          <button
            key={period}
            onClick={() => onAssign(period)}
            disabled={saving}
            className={`${assignStyle} ${BTN.xs} disabled:opacity-50`}
          >
            {periodLabelMap[period] || label(period)}
          </button>
        ))}
      </div>
    </div>
  );
}

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
  if (!schedData) return null;

  const floaters = staffForDay.filter(staff => staff.shift === 'AVL' && isCareRole(staff.role));
  const otCandidates = staffForDay.filter(staff =>
    isCareRole(staff.role) && !isWorkingShift(staff.shift) && staff.shift !== 'SICK' && staff.shift !== 'AL' && staff.shift !== 'NS'
  );
  const shortPeriods = ['early', 'late', 'night'].filter(period => coverage[period] && coverage[period].escalation.level >= 1);
  const periodShift = { early: 'E', late: 'L', night: 'N' };
  const periodOcShift = { early: 'OC-E', late: 'OC-L', night: 'OC-N' };
  const label = period => period.charAt(0).toUpperCase() + period.slice(1);
  const periodLabelMap = { early: 'E', late: 'L', night: 'N' };

  // Rank both cohorts by composite score descending. `schedData.training` feeds
  // the training sub-score; absence is tolerated (null → neutral).
  const rankedFloaters = floaters
    .map(staff => ({
      staff,
      fatigue: checkFatigueRisk(staff, currentDate, schedData.overrides, schedData.config),
      scored: scoreGapFillCandidate(staff, currentDate, schedData.overrides, schedData.config, schedData.training),
    }))
    .sort((a, b) => b.scored.score - a.scored.score);

  const rankedOt = otCandidates
    .map(staff => ({
      staff,
      fatigue: checkFatigueRisk(staff, currentDate, schedData.overrides, schedData.config),
      scored: scoreGapFillCandidate(staff, currentDate, schedData.overrides, schedData.config, schedData.training),
    }))
    .sort((a, b) => b.scored.score - a.scored.score)
    .slice(0, 6);

  return (
    <div className="mt-4 border border-amber-200 bg-amber-50 rounded-xl p-4 print:hidden">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-amber-800">Coverage Gap - action needed</h3>
        <button onClick={onDismiss} className={`${BTN.ghost} ${BTN.xs} text-gray-400`}>Dismiss</button>
      </div>
      <p className="text-xs text-amber-700 mb-3">
        {shortPeriods.length > 0
          ? `Short: ${shortPeriods.map(label).join(', ')} - below minimum staffing. Candidates ranked by cost / fatigue / skill / training.`
          : 'Coverage affected - review options below'}
      </p>
      <div className="mb-3">
        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">1 - Deploy Float</div>
        {rankedFloaters.length === 0 ? (
          <div className="text-xs text-gray-400">No floaters available today</div>
        ) : (
          <div className="space-y-1">
            {rankedFloaters.map(({ staff, fatigue, scored }) => (
              <RankedRow
                key={staff.id}
                staff={staff}
                secondary={staff.role}
                fatigue={fatigue}
                scored={scored}
                shortPeriods={shortPeriods}
                label={label}
                periodLabelMap={periodLabelMap}
                saving={saving}
                assignStyle={BTN.success}
                onAssign={(period) => onApplyOverride(staff.id, periodShift[period], `Float deployed - ${period} gap cover`, 'manual', false, gapPanelAbsentStaffId)}
              />
            ))}
          </div>
        )}
      </div>
      <div className="mb-3">
        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">2 - Call In (OT)</div>
        {rankedOt.length === 0 ? (
          <div className="text-xs text-gray-400">No off-duty staff available</div>
        ) : (
          <div className="space-y-1">
            {rankedOt.map(({ staff, fatigue, scored }) => (
              <RankedRow
                key={staff.id}
                staff={staff}
                secondary={staff.shift}
                fatigue={fatigue}
                scored={scored}
                shortPeriods={shortPeriods}
                label={label}
                periodLabelMap={periodLabelMap}
                saving={saving}
                assignStyle={BTN.primary}
                onAssign={(period) => onApplyOverride(staff.id, periodOcShift[period], `Called in - ${period} OT`, 'ot', false, gapPanelAbsentStaffId)}
              />
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">3 - Book Agency</div>
        <button onClick={onOpenAgencyBooking} className={`${BTN.danger} ${BTN.xs}`}>Open Agency Booking</button>
      </div>
    </div>
  );
}
