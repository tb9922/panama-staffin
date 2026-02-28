import { useState, useMemo, useEffect } from 'react';
import { formatDate } from '../../lib/rotation.js';
import { calculateExpiry, TRAINING_METHODS, getRequiredLevel } from '../../lib/training.js';
import { MODAL, INPUT, BTN } from '../../lib/design.js';
import { upsertTrainingRecord, deleteTrainingRecord } from '../../lib/api.js';
import Modal from '../Modal.jsx';

export default function TrainingRecordModal({ isOpen, onClose, staffId, staffName, typeId, typeName, type, existing, homeSlug, staff, onSaved }) {
  const today = formatDate(new Date());

  const initForm = () => ({
    completed: existing?.completed || today,
    trainer: existing?.trainer || '',
    method: existing?.method || 'classroom',
    certificate_ref: existing?.certificate_ref || '',
    evidence_ref: existing?.evidence_ref || '',
    notes: existing?.notes || '',
    level: existing?.level || '',
  });

  const [form, setForm] = useState(initForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Reset form when modal opens for a different cell
  useEffect(() => { if (isOpen) setForm(initForm()); }, [isOpen, staffId, typeId]);

  const modalExpiry = useMemo(() => {
    if (!form.completed || !type) return '';
    return calculateExpiry(form.completed, type.refresher_months);
  }, [form.completed, type]);

  const typeLevels = type?.levels || null;

  const staffMember = staff?.find(s => s.id === staffId);
  const requiredLevel = type && staffMember ? getRequiredLevel(type, staffMember.role) : null;

  async function handleSave() {
    if (!form.completed) return;
    setSaving(true);
    setError(null);
    try {
      const record = {
        completed: form.completed,
        expiry: calculateExpiry(form.completed, type?.refresher_months),
        trainer: form.trainer,
        method: form.method,
        certificate_ref: form.certificate_ref,
        evidence_ref: form.evidence_ref,
        notes: form.notes,
      };
      if (typeLevels && form.level) record.level = form.level;
      await upsertTrainingRecord(homeSlug, staffId, typeId, record);
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Remove this training record?')) return;
    setSaving(true);
    setError(null);
    try {
      await deleteTrainingRecord(homeSlug, staffId, typeId);
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={existing ? 'Edit Training' : 'Record Training'} size="lg">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={INPUT.label}>Staff Member</label>
            <p className="text-sm text-gray-800 font-medium">{staffName}</p>
          </div>
          <div>
            <label className={INPUT.label}>Training Type</label>
            <p className="text-sm text-gray-800 font-medium">{typeName}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={INPUT.label}>Completion Date</label>
            <input type="date" value={form.completed} onChange={e => setForm({ ...form, completed: e.target.value })} className={INPUT.base} />
          </div>
          <div>
            <label className={INPUT.label}>Expiry Date (auto)</label>
            <input type="date" value={modalExpiry} disabled className={`${INPUT.base} bg-gray-50 text-gray-500`} />
            {type && <p className="text-[10px] text-gray-400 mt-0.5">{type.refresher_months} months from completion</p>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={INPUT.label}>Trainer / Provider</label>
            <input type="text" value={form.trainer} onChange={e => setForm({ ...form, trainer: e.target.value })}
              className={INPUT.base} placeholder="Name or organisation" />
          </div>
          <div>
            <label className={INPUT.label}>Method</label>
            <select value={form.method} onChange={e => setForm({ ...form, method: e.target.value })} className={INPUT.select}>
              {TRAINING_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
        {typeLevels && (
          <div>
            <label className={INPUT.label}>Level Achieved</label>
            <select value={form.level} onChange={e => setForm({ ...form, level: e.target.value })} className={INPUT.select}>
              <option value="">Select level...</option>
              {typeLevels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            {requiredLevel && (
              <p className="text-[10px] text-gray-400 mt-0.5">Required for {staffMember?.role}: {requiredLevel.name}</p>
            )}
          </div>
        )}
        <div>
          <label className={INPUT.label}>Certificate Reference</label>
          <input type="text" value={form.certificate_ref} onChange={e => setForm({ ...form, certificate_ref: e.target.value })}
            className={INPUT.base} placeholder="e.g. FS-2025-042" />
        </div>
        <div>
          <label className={INPUT.label}>Evidence File Reference</label>
          <input type="text" value={form.evidence_ref} onChange={e => setForm({ ...form, evidence_ref: e.target.value })}
            className={INPUT.base} placeholder="e.g. /training/fire-safety/JS-2025.pdf" />
          <p className="text-[10px] text-gray-400 mt-0.5">File path or reference for offline evidence management</p>
        </div>
        <div>
          <label className={INPUT.label}>Notes</label>
          <input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
            className={INPUT.base} placeholder="Optional notes" />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      <div className={MODAL.footer}>
        {existing && (
          <button onClick={handleDelete} disabled={saving} className={`${BTN.danger} ${BTN.sm} mr-auto`}>Remove</button>
        )}
        <button onClick={onClose} className={BTN.ghost}>Cancel</button>
        <button onClick={handleSave} disabled={!form.completed || saving}
          className={`${BTN.primary} disabled:opacity-50`}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}
