import Modal from '../Modal.jsx';
import FileAttachments from '../FileAttachments.jsx';
import { BTN, INPUT, MODAL } from '../../lib/design.js';
import { isWorkingShift, isCareRole, getShiftHours } from '../../lib/rotation.js';
import { validateSwap } from '../../lib/escalation.js';
import { calculateAccrual } from '../../lib/accrual.js';
import { getRecordAttachments, uploadRecordAttachment, deleteRecordAttachment, downloadRecordAttachment } from '../../lib/api.js';

const SHIFT_EDIT_OPTIONS = [
  { value: '__scheduled__', label: 'Scheduled shift' },
  { value: 'E', label: 'E - Early' },
  { value: 'L', label: 'L - Late' },
  { value: 'EL', label: 'EL - Full day' },
  { value: 'N', label: 'N - Night' },
  { value: 'OFF', label: 'OFF - Day off' },
  { value: 'SICK', label: 'SICK - Sick leave' },
  { value: 'AL', label: 'AL - Annual leave' },
  { value: 'TRN', label: 'TRN - Training' },
  { value: 'ADM', label: 'ADM - Admin' },
  { value: 'OC-E', label: 'OC-E - OT early' },
  { value: 'OC-L', label: 'OC-L - OT late' },
  { value: 'OC-EL', label: 'OC-EL - OT full day' },
  { value: 'OC-N', label: 'OC-N - OT night' },
  { value: 'AG-E', label: 'AG-E - Agency early' },
  { value: 'AG-L', label: 'AG-L - Agency late' },
  { value: 'AG-EL', label: 'AG-EL - Agency full day' },
  { value: 'AG-N', label: 'AG-N - Agency night' },
];

function sortStaffOptions(staff) {
  return [...staff].sort((a, b) => a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' }) || a.id.localeCompare(b.id, 'en-GB', { sensitivity: 'base' }));
}

function getTitle(modal) {
  if (modal === 'sick') return 'Mark Sick';
  if (modal === 'al') return 'Book AL';
  if (modal === 'ot') return 'Book OT';
  if (modal === 'swap') return 'Swap Shifts';
  if (modal === 'training') return 'Book Training';
  if (modal === 'sleepIn') return 'Toggle Sleep In';
  if (modal === 'shiftEdit') return 'Change Status';
  return 'Book Agency';
}

export default function DailyStatusModal({
  modal,
  isOpen,
  onClose,
  staffForDay,
  currentDate,
  dateStr,
  schedData,
  coverage,
  availableStaff,
  selectedStaff,
  setSelectedStaff,
  manualShiftType,
  setManualShiftType,
  otShiftType,
  setOtShiftType,
  agencyShiftType,
  setAgencyShiftType,
  swapFrom,
  setSwapFrom,
  swapTo,
  setSwapTo,
  canEdit,
  saving,
  alCount,
  gapPanelAbsentStaffId,
  onApplyOverride,
  onApplySickOverride,
  onToggleSleepIn,
  onApplyManualShiftEdit,
  onHandlePermanentSwap,
  onHandleTemporarySwap,
  onHandleAgencyBooking,
}) {
  const evidenceCaseId = selectedStaff && dateStr ? `${dateStr}__${selectedStaff}` : null;
  const alBlockedForSelectedStaff = modal === 'al' && selectedStaff && (() => {
    const staff = schedData?.staff?.find(member => member.id === selectedStaff);
    if (!staff) return false;
    const accrual = calculateAccrual(staff, schedData.config, schedData.overrides, currentDate);
    return accrual.remainingHours <= 0 || accrual.missingContractHours;
  })();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={getTitle(modal)} size="sm">
      {modal === 'swap' ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">Choose the two staff members exchanging shifts for this day. The swap keeps both people visible in today’s rota.</p>
          <div>
            <label className={INPUT.label}>First staff member <span className="text-red-500">*</span></label>
            <select value={swapFrom} onChange={e => setSwapFrom(e.target.value)} className={INPUT.select}>
              <option value="">Select...</option>
              {sortStaffOptions(staffForDay.filter(staff => isWorkingShift(staff.shift) && isCareRole(staff.role))).map(staff => (
                <option key={staff.id} value={staff.id}>{staff.name} ({staff.shift})</option>
              ))}
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Second staff member <span className="text-red-500">*</span></label>
            <select value={swapTo} onChange={e => setSwapTo(e.target.value)} className={INPUT.select}>
              <option value="">Select...</option>
              {sortStaffOptions(staffForDay.filter(staff => isCareRole(staff.role) && staff.id !== swapFrom)).map(staff => (
                <option key={staff.id} value={staff.id}>{staff.name} ({staff.shift})</option>
              ))}
            </select>
          </div>
          {swapFrom && swapTo && (() => {
            const a = staffForDay.find(staff => staff.id === swapFrom);
            const b = staffForDay.find(staff => staff.id === swapTo);
            if (!a || !b) return null;
            const valAB = validateSwap(a, b, currentDate, schedData.overrides, schedData.config, schedData.training);
            const valBA = validateSwap(b, a, currentDate, schedData.overrides, schedData.config, schedData.training);
            const allIssues = [...valAB.issues, ...valBA.issues];
            const configShifts = schedData.config.shifts || {};
            const hoursForShift = shift => {
              if (!shift) return 0;
              if (shift.startsWith('OC-') || shift.startsWith('AG-')) return configShifts[shift.slice(3)]?.hours || 0;
              if (shift === 'BH-D') return configShifts.EL?.hours || configShifts.E?.hours || 0;
              if (shift === 'BH-N') return configShifts.N?.hours || 0;
              return configShifts[shift]?.hours || 0;
            };
            const costBefore = hoursForShift(a.shift) * (a.hourly_rate || 0) + hoursForShift(b.shift) * (b.hourly_rate || 0);
            const costAfter = hoursForShift(b.shift) * (a.hourly_rate || 0) + hoursForShift(a.shift) * (b.hourly_rate || 0);
            const costDelta = costAfter - costBefore;
            return (
              <div className="space-y-1">
                <div className="text-xs text-gray-500 bg-gray-50 rounded-xl px-2 py-1">
                  {a.name} ({a.shift}) &harr; {b.name} ({b.shift})
                </div>
                {allIssues.map((issue, index) => (
                  <div key={index} className={`text-xs px-2 py-1 rounded-xl ${issue.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
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
            <button onClick={onClose} className={BTN.ghost}>Cancel</button>
            {(() => {
              const a = staffForDay.find(staff => staff.id === swapFrom);
              const b = staffForDay.find(staff => staff.id === swapTo);
              const canSwap = !!(swapFrom && swapTo && swapFrom !== swapTo);
              const isFloat = a?.team === 'Float' || b?.team === 'Float';
              return (
                <>
                  {canEdit && (
                    <button
                      disabled={!canSwap || isFloat || saving}
                      title={isFloat ? 'Float staff have no fixed rotation to swap permanently' : `${a?.name}: ${a?.team} -> ${b?.team} | ${b?.name}: ${b?.team} -> ${a?.team}`}
                      onClick={() => onHandlePermanentSwap(swapFrom, swapTo)}
                      className={`${BTN.secondary} disabled:opacity-50 text-xs`}
                    >
                      {canSwap && !isFloat ? `Permanent (${a.team} <-> ${b.team})` : 'Permanent'}
                    </button>
                  )}
                  <button
                    disabled={!canSwap || saving}
                    onClick={() => onHandleTemporarySwap(swapFrom, swapTo)}
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
          <label>
            <span className={INPUT.label}>Agency shift type <span className="text-red-500">*</span></span>
            <select value={agencyShiftType} onChange={e => setAgencyShiftType(e.target.value)} className={INPUT.select}>
              <option value="">Select shift type...</option>
              <option value="AG-E">Agency Early (AG-E)</option>
              <option value="AG-L">Agency Late (AG-L)</option>
              <option value="AG-EL">Agency Full Day (AG-EL)</option>
              <option value="AG-N">Agency Night (AG-N)</option>
            </select>
          </label>
          {agencyShiftType && (() => {
            const agencyPeriods = agencyShiftType === 'AG-E'
              ? 'Early'
              : agencyShiftType === 'AG-L'
                ? 'Late'
                : agencyShiftType === 'AG-EL'
                  ? 'Early + Late (full day)'
                  : 'Night';
            const agencyHours = getShiftHours(agencyShiftType, schedData.config);
            const isNight = agencyShiftType === 'AG-N';
            const agencyRate = isNight ? (schedData.config.agency_rate_night || 0) : (schedData.config.agency_rate_day || 0);
            const agencyCost = (agencyHours * agencyRate).toFixed(2);
            const shortPeriods = ['early', 'late', 'night'].filter(period => coverage[period] && coverage[period].escalation.level >= 1);
            const absentToday = staffForDay.filter(staff => staff.shift === 'SICK' || staff.shift === 'AL');
            return (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 space-y-1.5 text-xs">
                <div className="font-semibold text-blue-700">Booking - {dateStr}</div>
                <div className="text-gray-600"><span className="font-medium">Covers:</span> {agencyPeriods}</div>
                {shortPeriods.length > 0 && (
                  <div className="text-amber-700"><span className="font-medium">Gap:</span> {shortPeriods.join(', ')} below minimum</div>
                )}
                <div className="text-gray-600">
                  <span className="font-medium">Rate:</span> £{agencyRate.toFixed(2)}/hr ({isNight ? 'night' : 'day'}) · {agencyHours}h · est. <strong>£{agencyCost}</strong>
                </div>
                {absentToday.length > 0 && (
                  <div className="text-gray-500"><span className="font-medium">Absent today:</span> {absentToday.map(staff => `${staff.name} (${staff.shift})`).join(', ')}</div>
                )}
              </div>
            );
          })()}
          <div className={MODAL.footer}>
            <button onClick={onClose} className={BTN.ghost}>Cancel</button>
            <button
              disabled={!agencyShiftType || saving}
              onClick={() => onHandleAgencyBooking(agencyShiftType, gapPanelAbsentStaffId)}
              className={`${BTN.danger} disabled:opacity-50`}
            >
              {saving ? 'Booking...' : 'Book'}
            </button>
          </div>
        </div>
      ) : modal === 'training' ? (
        <div className="space-y-3">
          <label>
            <span className={INPUT.label}>Staff member <span className="text-red-500">*</span></span>
            <select value={selectedStaff} onChange={e => setSelectedStaff(e.target.value)} className={INPUT.select}>
              <option value="">Select staff...</option>
              {sortStaffOptions(staffForDay.filter(staff => isCareRole(staff.role))).map(staff => (
                <option key={staff.id} value={staff.id}>{staff.name} ({staff.shift})</option>
              ))}
            </select>
          </label>
          <div className={MODAL.footer}>
            <button onClick={onClose} className={BTN.ghost}>Cancel</button>
            <button
              disabled={!selectedStaff || saving}
              onClick={() => onApplyOverride(selectedStaff, 'TRN', 'Training', 'manual')}
              className={`${BTN.primary} disabled:opacity-50`}
            >
              {saving ? 'Saving...' : 'Confirm'}
            </button>
          </div>
        </div>
      ) : modal === 'sleepIn' ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">Sleep-in is a flat-rate addition to the current shift. Staff remain on their rostered shift.</p>
          <label>
            <span className={INPUT.label}>Staff member <span className="text-red-500">*</span></span>
            <select value={selectedStaff} onChange={e => setSelectedStaff(e.target.value)} className={INPUT.select}>
              <option value="">Select staff...</option>
              {sortStaffOptions(staffForDay.filter(staff => isCareRole(staff.role))).map(staff => (
                <option key={staff.id} value={staff.id}>{staff.name} ({staff.shift}){staff.sleep_in ? ' - remove SI' : ' - add SI'}</option>
              ))}
            </select>
          </label>
          <div className={MODAL.footer}>
            <button onClick={onClose} className={BTN.ghost}>Cancel</button>
            <button
              disabled={!selectedStaff || saving}
              onClick={() => onToggleSleepIn(selectedStaff)}
              className={`${BTN.primary} disabled:opacity-50`}
            >
              {saving ? 'Saving...' : 'Confirm'}
            </button>
          </div>
        </div>
      ) : modal === 'shiftEdit' ? (
        <div className="space-y-3">
          {(() => {
            const staff = staffForDay.find(member => member.id === selectedStaff);
            if (!staff) return null;
            const alAccrual = manualShiftType === 'AL'
              ? calculateAccrual(staff, schedData.config, schedData.overrides, currentDate)
              : null;
            const alBlocked = manualShiftType === 'AL'
              && (alCount >= schedData.config.max_al_same_day
                || alAccrual?.remainingHours <= 0
                || alAccrual?.missingContractHours);
            return (
              <>
                <div className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  <div className="font-medium text-gray-800">{staff.name}</div>
                  <div>Current: {staff.shift}</div>
                  <div>Scheduled: {staff.scheduledShift}</div>
                </div>
                <label>
                  <span className={INPUT.label}>New status <span className="text-red-500">*</span></span>
                  <select value={manualShiftType} onChange={e => setManualShiftType(e.target.value)} className={INPUT.select}>
                    {SHIFT_EDIT_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.value === '__scheduled__' ? `${option.label} (${staff.scheduledShift})` : option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {manualShiftType === 'AL' && alCount >= schedData.config.max_al_same_day && (
                  <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded-xl">Max AL ({schedData.config.max_al_same_day}) reached</div>
                )}
                {manualShiftType === 'AL' && alAccrual?.missingContractHours && (
                  <div className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-xl">
                    Set contract hours in Staff Database to enable AL booking
                  </div>
                )}
                {manualShiftType === 'AL' && !alAccrual?.missingContractHours && alAccrual && (
                  <div className={`text-xs px-2 py-1 rounded-xl ${alAccrual.remainingHours <= 0 ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-500'}`}>
                    {alAccrual.remainingHours <= 0
                      ? `No AL remaining (${alAccrual.accruedHours.toFixed(1)}h earned, ${alAccrual.usedHours.toFixed(1)}h used)`
                      : `AL: ${alAccrual.remainingHours.toFixed(1)}h remaining`}
                  </div>
                )}
                <div className="border-t pt-3">
                  <FileAttachments
                    caseType="schedule_override"
                    caseId={evidenceCaseId}
                    readOnly={!canEdit}
                    title="Shift Evidence"
                    emptyText="No evidence uploaded for this shift change."
                    saveFirstMessage="Choose the staff member first, then you can attach supporting evidence for this shift change."
                    getFiles={getRecordAttachments}
                    uploadFile={uploadRecordAttachment}
                    deleteFile={deleteRecordAttachment}
                    downloadFile={downloadRecordAttachment}
                  />
                </div>
                <div className={MODAL.footer}>
                  <button onClick={onClose} className={BTN.ghost}>Cancel</button>
                  <button
                    disabled={!manualShiftType || saving || alBlocked}
                    onClick={onApplyManualShiftEdit}
                    className={`${BTN.primary} disabled:opacity-50`}
                  >
                    {saving ? 'Saving...' : 'Confirm'}
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      ) : (
        <div className="space-y-3">
          <label>
            <span className={INPUT.label}>Staff member <span className="text-red-500">*</span></span>
            <select value={selectedStaff} onChange={e => setSelectedStaff(e.target.value)} className={INPUT.select}>
              <option value="">Select staff...</option>
              {sortStaffOptions(modal === 'ot' ? availableStaff : staffForDay.filter(staff => isWorkingShift(staff.shift))).map(staff => (
                <option key={staff.id} value={staff.id}>{staff.name} ({staff.shift})</option>
              ))}
            </select>
          </label>
          {modal === 'ot' && selectedStaff && (
            <label>
              <span className={INPUT.label}>OT shift <span className="text-red-500">*</span></span>
              <select value={otShiftType} onChange={e => setOtShiftType(e.target.value)} className={INPUT.select}>
                <option value="OC-E">OC-E (Early)</option>
                <option value="OC-L">OC-L (Late)</option>
                <option value="OC-EL">OC-EL (Full Day)</option>
                <option value="OC-N">OC-N (Night)</option>
              </select>
            </label>
          )}
          {modal === 'al' && alCount >= schedData.config.max_al_same_day && (
            <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded-xl">Max AL ({schedData.config.max_al_same_day}) reached</div>
          )}
          {modal === 'al' && selectedStaff && (() => {
            const staff = schedData.staff.find(member => member.id === selectedStaff);
            if (!staff) return null;
            const accrual = calculateAccrual(staff, schedData.config, schedData.overrides, currentDate);
            if (accrual.missingContractHours) {
              return (
                <div className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-xl">
                  Set contract hours in Staff Database to enable AL booking
                </div>
              );
            }
            if (accrual.remainingHours <= 0) {
              return (
                <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded-xl">
                  No AL remaining ({accrual.accruedHours.toFixed(1)}h earned, {accrual.usedHours.toFixed(1)}h used)
                </div>
              );
            }
            return <div className="text-xs text-gray-500">AL: {accrual.remainingHours.toFixed(1)}h remaining</div>;
          })()}
          <div className="border-t pt-3">
            <FileAttachments
              caseType="schedule_override"
              caseId={evidenceCaseId}
              readOnly={!canEdit}
              title="Shift Evidence"
              emptyText="No evidence uploaded for this shift change."
              saveFirstMessage="Choose the staff member first, then you can attach supporting evidence for this shift change."
              getFiles={getRecordAttachments}
              uploadFile={uploadRecordAttachment}
              deleteFile={deleteRecordAttachment}
              downloadFile={downloadRecordAttachment}
            />
          </div>
          <div className={MODAL.footer}>
            <button onClick={onClose} className={BTN.ghost}>Cancel</button>
            <button
              disabled={!selectedStaff || saving || (modal === 'al' && alCount >= schedData.config.max_al_same_day) || alBlockedForSelectedStaff}
              onClick={() => {
                if (modal === 'sick') onApplySickOverride(selectedStaff);
                else if (modal === 'al') onApplyOverride(selectedStaff, 'AL', 'Annual leave', 'manual', false, null, {});
                else onApplyOverride(selectedStaff, otShiftType, 'OT booked', 'ot');
              }}
              className={`${BTN.primary} disabled:opacity-50`}
            >
              {saving ? 'Saving...' : 'Confirm'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
