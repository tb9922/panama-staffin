import Modal from '../Modal.jsx';
import { BTN, INPUT, MODAL } from '../../lib/design.js';
import { SHIFT_COLORS, getScheduledShift, getCycleDay, isOTShift, isAgencyShift } from '../../lib/rotation.js';

const SHIFT_OPTIONS = [
  { value: 'E', label: 'E - Early', group: 'Standard' },
  { value: 'L', label: 'L - Late', group: 'Standard' },
  { value: 'EL', label: 'EL - Full Day', group: 'Standard' },
  { value: 'N', label: 'N - Night', group: 'Standard' },
  { value: 'OFF', label: 'OFF - Day Off', group: 'Standard' },
  { value: 'AVL', label: 'AVL - Available', group: 'Standard' },
  { value: 'AL', label: 'AL - Annual Leave', group: 'Absence' },
  { value: 'SICK', label: 'SICK - Sick', group: 'Absence' },
  { value: 'NS', label: 'NS - No Show', group: 'Absence' },
  { value: 'ADM', label: 'ADM - Admin', group: 'Absence' },
  { value: 'TRN', label: 'TRN - Training', group: 'Absence' },
  { value: 'OC-E', label: 'OC-E - OT Early', group: 'Overtime' },
  { value: 'OC-L', label: 'OC-L - OT Late', group: 'Overtime' },
  { value: 'OC-EL', label: 'OC-EL - OT Full', group: 'Overtime' },
  { value: 'OC-N', label: 'OC-N - OT Night', group: 'Overtime' },
  { value: 'AG-E', label: 'AG-E - Agency Early', group: 'Agency' },
  { value: 'AG-L', label: 'AG-L - Agency Late', group: 'Agency' },
  { value: 'AG-N', label: 'AG-N - Agency Night', group: 'Agency' },
  { value: 'BH-D', label: 'BH-D - Bank Hol Day', group: 'Bank Hol' },
  { value: 'BH-N', label: 'BH-N - Bank Hol Night', group: 'Bank Hol' },
];

function parseLocalDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function CoverageRow({ label, before, after }) {
  return (
    <div className="text-xs mb-1">
      <div className="flex justify-between">
        <span className="text-gray-500">{label}</span>
        <span className="font-medium">{before.staff}{' -> '}{after.staff}</span>
      </div>
      <div className="text-[10px] text-gray-400">
          Skill {before.skill}{' -> '}{after.skill} · {before.status}{' -> '}{after.status}
      </div>
    </div>
  );
}

export default function RotationGridModals({
  bulkModal,
  setBulkModal,
  monthLabel,
  saving,
  revertAllOverrides,
  editing,
  setEditing,
  schedData,
  impact,
  canEdit,
  bulkSickWeek,
  applyChange,
}) {
  const currentStaff = editing ? schedData?.staff?.find(staff => staff.id === editing.staffId) : null;
  const scheduledShift = editing && currentStaff
    ? getScheduledShift(currentStaff, getCycleDay(parseLocalDate(editing.dateStr), schedData.config.cycle_start_date), parseLocalDate(editing.dateStr), schedData.config)
    : null;

  return (
    <>
      <Modal isOpen={bulkModal?.type === 'revert-all'} onClose={() => setBulkModal(null)} title="Revert All Overrides" size="sm">
        <p className="text-sm text-gray-600 mb-2">Remove all manual overrides for <strong>{monthLabel}</strong>?</p>
        <p className="text-xs text-amber-600 mb-4">This will reset all sick, AL, OT, and agency bookings this month.</p>
        <div className={MODAL.footer}>
          <button onClick={() => setBulkModal(null)} className={BTN.secondary}>Cancel</button>
          <button onClick={revertAllOverrides} disabled={saving} className={`${BTN.danger} disabled:opacity-50`}>
            {saving ? 'Reverting...' : 'Revert All'}
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!editing} onClose={() => setEditing(null)} title={currentStaff?.name || 'Edit Shift'} size="lg">
        {editing && (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-gray-500">
                {parseLocalDate(editing.dateStr).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}
              </p>
              <div className="text-right">
                <span className={`px-2 py-1 rounded text-xs font-medium ${SHIFT_COLORS[editing.currentShift] || 'bg-gray-100'}`}>
                  {editing.currentShift}
                </span>
                <p className="text-[10px] text-gray-400 mt-1">current</p>
              </div>
            </div>

            <div>
              <div className="mb-4">
                <label className={INPUT.label}>Change shift to:</label>
                <select
                  value={editing.proposedShift}
                  onChange={e => {
                    const newShift = e.target.value;
                    setEditing({
                      ...editing,
                      proposedShift: newShift,
                      ...(!(isOTShift(newShift) || isAgencyShift(newShift)) && { replacesStaffId: null }),
                    });
                  }}
                  className={`${INPUT.select} font-medium`}
                >
                  <optgroup label="Standard">
                    {SHIFT_OPTIONS.filter(option => option.group === 'Standard').map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Absence">
                    {SHIFT_OPTIONS.filter(option => option.group === 'Absence').map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Overtime / On-Call">
                    {SHIFT_OPTIONS.filter(option => option.group === 'Overtime').map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Agency">
                    {SHIFT_OPTIONS.filter(option => option.group === 'Agency').map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Bank Holiday">
                    {SHIFT_OPTIONS.filter(option => option.group === 'Bank Hol').map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {(isOTShift(editing.proposedShift) || isAgencyShift(editing.proposedShift)) && (
                <div className="mb-4">
                  <label className={INPUT.label}>Covers for (optional):</label>
                  <select
                    value={editing.replacesStaffId || ''}
                    onChange={e => setEditing({ ...editing, replacesStaffId: e.target.value || null })}
                    className={INPUT.select}
                  >
                    <option value="">- None -</option>
                    {schedData.staff
                      .filter(staff => {
                        if (staff.id === editing.staffId) return false;
                        if (staff.active === false) return false;
                        if (!['carer', 'senior_carer', 'nurse'].includes(staff.role)) return false;
                        const shift = staff.shift_override?.[editing.dateStr] || null;
                        return shift ? ['AL', 'SICK', 'NS', 'ADM', 'TRN'].includes(shift) : true;
                      })
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(staff => (
                        <option key={staff.id} value={staff.id}>{staff.name}</option>
                      ))}
                  </select>
                </div>
              )}

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
                        {impact.errors.length > 0 ? 'Issues Found - Review Before Approving' :
                         impact.warnings.length > 0 ? 'Warnings - Proceed With Caution' :
                         'All Clear - Safe to Apply'}
                      </div>
                      <div className="text-[10px] text-gray-500">
                        {editing.currentShift}{' -> '}{editing.proposedShift}
                      </div>
                    </div>
                  </div>

                  {impact.errors.length > 0 && (
                    <div className="space-y-1">
                      {impact.errors.map((error, index) => (
                        <div key={index} className="text-xs bg-red-50 text-red-700 px-3 py-1.5 rounded flex items-start gap-1.5">
                          <span className="font-bold mt-px">!</span> {error}
                        </div>
                      ))}
                    </div>
                  )}
                  {impact.warnings.length > 0 && (
                    <div className="space-y-1">
                      {impact.warnings.map((warning, index) => (
                        <div key={index} className="text-xs bg-amber-50 text-amber-700 px-3 py-1.5 rounded flex items-start gap-1.5">
                          <span className="font-bold mt-px">~</span> {warning}
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
                          <span className="text-xs">{'->'}</span>
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
                          <span className="font-medium">{impact.statsBefore.paidHours.toFixed(1)}{' -> '}{impact.statsAfter.paidHours.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Pay:</span>
                          <span className="font-medium">£{impact.statsBefore.totalPay.toFixed(0)}{' -> '}£{impact.statsAfter.totalPay.toFixed(0)}</span>
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

            <div className={MODAL.footer}>
              <button onClick={() => setEditing(null)} className={BTN.ghost} disabled={saving}>Cancel</button>
              {canEdit && (
                <div className="flex gap-2">
                  <button
                    onClick={() => { bulkSickWeek(editing.staffId, editing.dateStr); setEditing(null); }}
                    disabled={saving}
                    className={`${BTN.ghost} ${BTN.xs} text-red-600 disabled:opacity-50`}
                  >
                    Sick 7 Days
                  </button>
                  {editing.currentShift !== scheduledShift && (
                    <button
                      onClick={() => setEditing({ ...editing, proposedShift: scheduledShift, replacesStaffId: null })}
                      disabled={saving}
                      className={`${BTN.ghost} ${BTN.xs} text-blue-600 disabled:opacity-50`}
                    >
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
                    } disabled:opacity-30`}
                  >
                    {saving ? 'Saving...' :
                     impact?.errors.length > 0 ? 'Apply Anyway' :
                     impact?.warnings.length > 0 ? 'Apply (with warnings)' :
                     'Approve & Apply'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
