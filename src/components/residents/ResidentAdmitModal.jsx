import { useState } from 'react';
import { BTN, INPUT, MODAL } from '../../lib/design.js';
import { FUNDING_TYPES, CARE_TYPES } from '../../lib/finance.js';
import { createFinanceResident, getLoggedInUser } from '../../lib/api.js';
import Modal from '../Modal.jsx';
import { todayLocalISO } from '../../lib/localDates.js';

const today = () => todayLocalISO();

const EMPTY = {
  resident_name: '', room_number: '', care_type: 'residential', funding_type: 'self_funded',
  funding_authority: '', funding_reference: '', admission_date: today(), notes: '',
  weekly_fee: '', la_contribution: '', chc_contribution: '', fnc_amount: '',
  top_up_amount: '', top_up_payer: '', top_up_contact: '',
};

export default function ResidentAdmitModal({ home, onClose, onSaved }) {
  const [tab, setTab] = useState('profile');
  const [form, setForm] = useState({ ...EMPTY });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const data = { ...form, status: 'active', created_by: getLoggedInUser()?.username };
      // Convert empty strings to null for numeric fields
      for (const k of ['weekly_fee', 'la_contribution', 'chc_contribution', 'fnc_amount', 'top_up_amount']) {
        if (data[k] === '' || data[k] == null) data[k] = null;
        else data[k] = parseFloat(data[k]);
      }
      const created = await createFinanceResident(home, data);
      onSaved(created);
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
  ];

  return (
    <Modal isOpen onClose={onClose} title="Admit Resident" size="lg">
      <form onSubmit={handleSubmit}>
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
              <input className={INPUT.base} required value={form.resident_name} onChange={e => set('resident_name', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Room Number</label>
                <input className={INPUT.base} value={form.room_number} onChange={e => set('room_number', e.target.value)} />
              </div>
              <div>
                <label className={INPUT.label}>Admission Date</label>
                <input type="date" className={INPUT.base} value={form.admission_date} onChange={e => set('admission_date', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Care Type</label>
                <select className={INPUT.select} value={form.care_type} onChange={e => set('care_type', e.target.value)}>
                  {CARE_TYPES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className={INPUT.label}>Funding Type</label>
                <select className={INPUT.select} value={form.funding_type} onChange={e => set('funding_type', e.target.value)}>
                  {FUNDING_TYPES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Funding Authority</label>
                <input className={INPUT.base} value={form.funding_authority} onChange={e => set('funding_authority', e.target.value)} />
              </div>
              <div>
                <label className={INPUT.label}>Funding Reference</label>
                <input className={INPUT.base} value={form.funding_reference} onChange={e => set('funding_reference', e.target.value)} />
              </div>
            </div>
            <div>
              <label className={INPUT.label}>Notes</label>
              <textarea className={INPUT.base} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
        )}

        {tab === 'fees' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Weekly Fee</label>
                <input type="number" step="0.01" className={INPUT.base} value={form.weekly_fee} onChange={e => set('weekly_fee', e.target.value)} />
              </div>
              <div>
                <label className={INPUT.label}>LA Contribution</label>
                <input type="number" step="0.01" className={INPUT.base} value={form.la_contribution} onChange={e => set('la_contribution', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>CHC Contribution</label>
                <input type="number" step="0.01" className={INPUT.base} value={form.chc_contribution} onChange={e => set('chc_contribution', e.target.value)} />
              </div>
              <div>
                <label className={INPUT.label}>FNC Amount</label>
                <input type="number" step="0.01" className={INPUT.base} value={form.fnc_amount} onChange={e => set('fnc_amount', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={INPUT.label}>Top-Up Amount</label>
                <input type="number" step="0.01" className={INPUT.base} value={form.top_up_amount} onChange={e => set('top_up_amount', e.target.value)} />
              </div>
              <div>
                <label className={INPUT.label}>Top-Up Payer</label>
                <input className={INPUT.base} value={form.top_up_payer} onChange={e => set('top_up_payer', e.target.value)} />
              </div>
              <div>
                <label className={INPUT.label}>Top-Up Contact</label>
                <input className={INPUT.base} value={form.top_up_contact} onChange={e => set('top_up_contact', e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {/* Bed assignment note */}
        <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded text-sm text-gray-600">
          After saving, assign a bed in Bed Manager.
        </div>

        <div className={MODAL.footer}>
          <button type="button" className={BTN.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={BTN.primary} disabled={submitting || !form.resident_name.trim()}>
            {submitting ? 'Admitting...' : 'Admit Resident'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
