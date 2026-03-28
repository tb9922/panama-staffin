import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BTN, INPUT, MODAL, BADGE } from '../../lib/design.js';
import { FUNDING_TYPES, CARE_TYPES, getLabel, formatCurrency } from '../../lib/finance.js';
import { updateFinanceResident, getFinanceFeeHistory } from '../../lib/api.js';
import Modal from '../Modal.jsx';

export default function ResidentEditModal({ home, resident, canEdit, onClose, onSaved }) {
  const [tab, setTab] = useState('profile');
  const [form, setForm] = useState({ ...resident });
  const [feeHistory, setFeeHistory] = useState([]);
  const [feeChangeReason, setFeeChangeReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const readOnly = !canEdit;

  const feeChanged = form.weekly_fee != resident.weekly_fee;

  useEffect(() => {
    if (tab === 'history') {
      getFinanceFeeHistory(home, resident.id).then(r => setFeeHistory(r.rows || r || [])).catch(() => setFeeHistory([]));
    }
  }, [tab, home, resident.id]);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    try {
      const data = { ...form, _version: resident.version };
      // Convert empty strings to null for numeric fields
      for (const k of ['weekly_fee', 'la_contribution', 'chc_contribution', 'fnc_amount', 'top_up_amount']) {
        if (data[k] === '' || data[k] == null) data[k] = null;
        else data[k] = parseFloat(data[k]);
      }
      if (feeChanged && feeChangeReason) data._fee_change_reason = feeChangeReason;
      // Strip fields that aren't in the update schema
      delete data.id; delete data.home_id; delete data.version;
      delete data.created_by; delete data.created_at; delete data.updated_at;
      delete data.bed; delete data._total;
      const result = await updateFinanceResident(home, resident.id, data);
      if (!result) {
        setError('This resident was updated by someone else \u2014 please close and reopen.');
        return;
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const tabs = [
    { id: 'profile', label: 'Profile' },
    { id: 'fees', label: 'Fees' },
    { id: 'history', label: 'Fee History' },
  ];
  const bedManagerUrl = resident?.id ? `/beds?residentId=${resident.id}` : '/beds';

  return (
    <Modal isOpen onClose={onClose} title={resident.resident_name} size="lg">
      {/* Bed display — read-only */}
      {resident.status === 'active' && (
        <div className={`mb-4 p-3 rounded text-sm ${resident.bed ? 'bg-gray-50 border border-gray-200' : 'bg-amber-50 border border-amber-200'}`}>
          {resident.bed ? (
            resident.bed.status === 'hospital_hold' ? (
              <span>&#127973; {resident.bed.room_number} ({getLabel(resident.bed.room_type, [{id:'single',label:'Single'},{id:'shared',label:'Shared'},{id:'en_suite',label:'En Suite'},{id:'nursing',label:'Nursing'},{id:'bariatric',label:'Bariatric'}])}{resident.bed.floor ? `, Floor ${resident.bed.floor}` : ''}) &mdash; Hospital Hold &nbsp;<Link to={bedManagerUrl} className="text-blue-600 underline">Manage in Bed Manager &rarr;</Link></span>
            ) : (
              <span>&#128716; {resident.bed.room_number} ({getLabel(resident.bed.room_type, [{id:'single',label:'Single'},{id:'shared',label:'Shared'},{id:'en_suite',label:'En Suite'},{id:'nursing',label:'Nursing'},{id:'bariatric',label:'Bariatric'}])}{resident.bed.floor ? `, Floor ${resident.bed.floor}` : ''}) &mdash; Occupied &nbsp;<Link to={bedManagerUrl} className="text-blue-600 underline">Manage in Bed Manager &rarr;</Link></span>
            )
          ) : (
            <span className="text-amber-700">No bed assigned &mdash; <Link to={bedManagerUrl} className="text-blue-600 underline font-medium">Assign in Bed Manager &rarr;</Link></span>
          )}
        </div>
      )}

      {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}

      <div className="flex gap-2 mb-4 border-b">
        {tabs.map(t => (
          <button key={t.id} type="button"
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="space-y-3">
          <div>
            <label className={INPUT.label}>Resident Name *</label>
            <input className={INPUT.base} value={form.resident_name || ''} onChange={e => set('resident_name', e.target.value)} disabled={readOnly} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Room Number</label>
              <input className={INPUT.base} value={form.room_number || ''} onChange={e => set('room_number', e.target.value)} disabled={readOnly} />
            </div>
            <div>
              <label className={INPUT.label}>Admission Date</label>
              <input type="date" className={INPUT.base} value={form.admission_date || ''} onChange={e => set('admission_date', e.target.value)} disabled={readOnly} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Care Type</label>
              <select className={INPUT.select} value={form.care_type || ''} onChange={e => set('care_type', e.target.value)} disabled={readOnly}>
                {CARE_TYPES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className={INPUT.label}>Funding Type</label>
              <select className={INPUT.select} value={form.funding_type || ''} onChange={e => set('funding_type', e.target.value)} disabled={readOnly}>
                {FUNDING_TYPES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Funding Authority</label>
              <input className={INPUT.base} value={form.funding_authority || ''} onChange={e => set('funding_authority', e.target.value)} disabled={readOnly} />
            </div>
            <div>
              <label className={INPUT.label}>Funding Reference</label>
              <input className={INPUT.base} value={form.funding_reference || ''} onChange={e => set('funding_reference', e.target.value)} disabled={readOnly} />
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Notes</label>
            <textarea className={INPUT.base} rows={2} value={form.notes || ''} onChange={e => set('notes', e.target.value)} disabled={readOnly} />
          </div>
        </div>
      )}

      {tab === 'fees' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Weekly Fee</label>
              <input type="number" step="0.01" className={INPUT.base} value={form.weekly_fee ?? ''} onChange={e => set('weekly_fee', e.target.value)} disabled={readOnly} />
            </div>
            <div>
              <label className={INPUT.label}>LA Contribution</label>
              <input type="number" step="0.01" className={INPUT.base} value={form.la_contribution ?? ''} onChange={e => set('la_contribution', e.target.value)} disabled={readOnly} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>CHC Contribution</label>
              <input type="number" step="0.01" className={INPUT.base} value={form.chc_contribution ?? ''} onChange={e => set('chc_contribution', e.target.value)} disabled={readOnly} />
            </div>
            <div>
              <label className={INPUT.label}>FNC Amount</label>
              <input type="number" step="0.01" className={INPUT.base} value={form.fnc_amount ?? ''} onChange={e => set('fnc_amount', e.target.value)} disabled={readOnly} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={INPUT.label}>Top-Up Amount</label>
              <input type="number" step="0.01" className={INPUT.base} value={form.top_up_amount ?? ''} onChange={e => set('top_up_amount', e.target.value)} disabled={readOnly} />
            </div>
            <div>
              <label className={INPUT.label}>Top-Up Payer</label>
              <input className={INPUT.base} value={form.top_up_payer || ''} onChange={e => set('top_up_payer', e.target.value)} disabled={readOnly} />
            </div>
            <div>
              <label className={INPUT.label}>Top-Up Contact</label>
              <input className={INPUT.base} value={form.top_up_contact || ''} onChange={e => set('top_up_contact', e.target.value)} disabled={readOnly} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Last Fee Review</label>
              <input type="date" className={INPUT.base} value={form.last_fee_review || ''} onChange={e => set('last_fee_review', e.target.value)} disabled={readOnly} />
            </div>
            <div>
              <label className={INPUT.label}>Next Fee Review</label>
              <input type="date" className={INPUT.base} value={form.next_fee_review || ''} onChange={e => set('next_fee_review', e.target.value)} disabled={readOnly} />
            </div>
          </div>
          {feeChanged && canEdit && (
            <div>
              <label className={INPUT.label}>Fee Change Reason *</label>
              <input className={INPUT.base} value={feeChangeReason} onChange={e => setFeeChangeReason(e.target.value)} placeholder="e.g. Annual fee uplift" />
            </div>
          )}
          {resident.last_payment_date && (
            <div className="mt-3 p-3 bg-gray-50 rounded border border-gray-200 text-sm">
              <span className="text-gray-500">Last payment:</span>{' '}
              <span className="font-medium">{formatCurrency(resident.last_payment_amount)}</span>
              <span className="text-gray-400 ml-1">on {resident.last_payment_date}</span>
            </div>
          )}
          {resident.outstanding_balance > 0 && (
            <div className="mt-2 p-3 bg-amber-50 rounded border border-amber-200 text-sm">
              <span className="text-amber-700 font-medium">Outstanding: {formatCurrency(resident.outstanding_balance)}</span>
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {feeHistory.length === 0 ? (
            <p className="text-sm text-gray-500">No fee changes recorded.</p>
          ) : (
            feeHistory.map((h, i) => (
              <div key={i} className="p-2 bg-gray-50 rounded text-sm">
                <span className="font-medium">{h.effective_date}</span>: {formatCurrency(h.previous_weekly)} &rarr; {formatCurrency(h.new_weekly)}
                {h.reason && <span className="text-gray-500 ml-2">({h.reason})</span>}
              </div>
            ))
          )}
        </div>
      )}

      {canEdit && (
        <div className={MODAL.footer}>
          <button type="button" className={BTN.secondary} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN.primary} onClick={handleSave}
            disabled={submitting || !form.resident_name?.trim() || (feeChanged && !feeChangeReason.trim())}>
            {submitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
    </Modal>
  );
}
