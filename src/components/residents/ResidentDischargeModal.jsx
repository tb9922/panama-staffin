import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BTN, INPUT, MODAL } from '../../lib/design.js';
import FileAttachments from '../FileAttachments.jsx';
import {
  getRecordAttachments,
  uploadRecordAttachment,
  deleteRecordAttachment,
  downloadRecordAttachment,
  updateFinanceResident,
} from '../../lib/api.js';
import { todayLocalISO } from '../../lib/localDates.js';
import Modal from '../Modal.jsx';
import InlineNotice from '../InlineNotice.jsx';

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

  const hasBed = resident.bed != null;
  const bedManagerUrl = resident?.id ? `/beds?residentId=${resident.id}` : '/beds';

  async function handleDischarge() {
    setSubmitting(true);
    setError(null);
    try {
      const existingNotes = resident.notes || '';
      const appendedNotes = existingNotes + (notes.trim() ? '\nDischarge: ' + notes.trim() : '');
      await updateFinanceResident(home, resident.id, {
        status: reason,
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
      {error && (
        <InlineNotice variant="error" className="mb-3">
          {error}
        </InlineNotice>
      )}

      {hasBed && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
          This resident is in Room {resident.bed.room_number}. Discharging does <strong>not</strong> free the bed automatically.{' '}
          <Link to={bedManagerUrl} className="text-blue-600 underline font-medium">Update in Bed Manager &rarr;</Link>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className={INPUT.label}>Reason *</label>
          <select className={INPUT.select} value={reason} onChange={e => setReason(e.target.value)}>
            {DISCHARGE_REASONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className={INPUT.label}>Discharge Date *</label>
          <input type="date" className={INPUT.base} value={dischargeDate} onChange={e => setDischargeDate(e.target.value)} />
        </div>
        <div>
          <label className={INPUT.label}>Notes</label>
          <textarea className={INPUT.base} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional discharge notes" />
        </div>
        <div className="border-t pt-3">
          <FileAttachments
            caseType="finance_resident"
            caseId={resident.id}
            title="Resident Evidence"
            emptyText="No resident documents uploaded yet."
            getFiles={getRecordAttachments}
            uploadFile={uploadRecordAttachment}
            deleteFile={deleteRecordAttachment}
            downloadFile={downloadRecordAttachment}
          />
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
