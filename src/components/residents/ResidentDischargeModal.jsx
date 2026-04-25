import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { BTN, INPUT, MODAL } from '../../lib/design.js';
import { updateFinanceResident } from '../../lib/api.js';
import Modal from '../Modal.jsx';
import { todayLocalISO } from '../../lib/localDates.js';

const DISCHARGE_REASONS = [
  { id: 'discharged', label: 'Discharged' },
  { id: 'deceased', label: 'Deceased' },
  { id: 'transferred', label: 'Transferred' },
];

export default function ResidentDischargeModal({ home, resident, onClose, onSaved }) {
  const [reason, setReason] = useState('discharged');
  const [dischargeDate, setDischargeDate] = useState(todayLocalISO());
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const id = useId();
  const reasonId = `${id}-reason`;
  const dischargeDateId = `${id}-discharge-date`;
  const notesId = `${id}-notes`;

  const hasBed = resident.bed != null;
  const bedManagerUrl = resident?.id ? `/beds?residentId=${resident.id}` : '/beds';

  async function handleDischarge() {
    setSubmitting(true);
    setError(null);
    try {
      const existingNotes = resident.notes || '';
      const noteParts = [];
      if (reason === 'transferred') {
        noteParts.push('Discharge reason: Transferred');
      }
      if (notes.trim()) {
        noteParts.push(`Discharge: ${notes.trim()}`);
      }
      const appendedNotes = existingNotes + (noteParts.length ? `\n${noteParts.join('\n')}` : '');
      const targetStatus = reason === 'deceased' ? 'deceased' : 'discharged';
      await updateFinanceResident(home, resident.id, {
        status: targetStatus,
        discharge_date: dischargeDate,
        notes: appendedNotes,
        _version: resident.version,
      });
      onSaved(hasBed, resident.bed?.room_number);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`Discharge — ${resident.resident_name}`} size="sm">
      {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}

      {hasBed && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
          This resident is in Room {resident.bed.room_number}. Discharging does <strong>not</strong> free the bed automatically.{' '}
          <Link to={bedManagerUrl} className="text-blue-600 underline font-medium">Update in Bed Manager &rarr;</Link>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label htmlFor={reasonId} className={INPUT.label}>Reason *</label>
          <select id={reasonId} className={INPUT.select} value={reason} onChange={e => setReason(e.target.value)}>
            {DISCHARGE_REASONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={dischargeDateId} className={INPUT.label}>Discharge Date *</label>
          <input id={dischargeDateId} type="date" className={INPUT.base} value={dischargeDate} onChange={e => setDischargeDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor={notesId} className={INPUT.label}>Notes</label>
          <textarea id={notesId} className={INPUT.base} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional discharge notes" />
        </div>
      </div>

      <div className={MODAL.footer}>
        <button type="button" className={BTN.secondary} onClick={onClose}>Cancel</button>
        <button type="button" className={BTN.danger} onClick={handleDischarge}
          disabled={submitting || !dischargeDate}>
          {submitting ? 'Discharging...' : 'Confirm Discharge'}
        </button>
      </div>
    </Modal>
  );
}
