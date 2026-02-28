import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import { getCurrentHome, getHrFamilyLeave, createHrFamilyLeave, updateHrFamilyLeave } from '../lib/api.js';
import { FAMILY_LEAVE_TYPES, FAMILY_LEAVE_STATUSES, getStatusBadge } from '../lib/hr.js';
import StaffPicker from '../components/StaffPicker.jsx';
import FileAttachments from '../components/FileAttachments.jsx';

const PROTECTED_TYPES = ['maternity', 'adoption'];

function typeName(id) {
  return FAMILY_LEAVE_TYPES.find(t => t.id === id)?.name || id;
}

function statusName(id) {
  return FAMILY_LEAVE_STATUSES.find(s => s.id === id)?.name || id;
}

const blankForm = () => ({
  staff_id: '', leave_type: 'maternity', start_date: '', end_date: '',
  status: 'planned', expected_return: '', actual_return: '',
  kit_days_used: 0, pay_type: '', notes: '',
});

export default function FamilyLeaveTracker() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Filters
  const [filterStaff, setFilterStaff] = useState('');
  const [filterType, setFilterType] = useState('');

  const home = getCurrentHome();
  useDirtyGuard(showModal);

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const filters = {};
      if (filterStaff) filters.staffId = filterStaff;
      if (filterType) filters.type = filterType;
      const res = await getHrFamilyLeave(home, filters);
      setItems(res?.rows || []);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [home, filterStaff, filterType]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!showModal) return;
    const handler = e => {
      if (e.key === 'Escape') { setShowModal(false); setEditing(null); setForm(blankForm()); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showModal]);

  function openNew() {
    setEditing(null);
    setForm(blankForm());
    setShowModal(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({
      staff_id: item.staff_id || '',
      leave_type: item.leave_type || 'maternity',
      start_date: item.start_date || '',
      end_date: item.end_date || '',
      status: item.status || 'planned',
      expected_return: item.expected_return || '',
      actual_return: item.actual_return || '',
      kit_days_used: item.kit_days_used ?? 0,
      pay_type: item.pay_type || '',
      notes: item.notes || '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    setError(null);
    setFormError('');
    if (!form.staff_id) { setFormError('Staff member is required'); return; }
    if (!form.leave_type) { setFormError('Leave type is required'); return; }
    if (!form.start_date) { setFormError('Start date is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        kit_days_used: parseInt(form.kit_days_used, 10) || 0,
      };
      if (editing) {
        await updateHrFamilyLeave(editing.id, { ...payload, _version: editing.version });
      } else {
        await createHrFamilyLeave(home, payload);
      }
      setShowModal(false);
      setForm(blankForm());
      setEditing(null);
      load();
    } catch (e) {
      if (e.message?.includes('modified by another user')) {
        setError('This record was modified by another user. Please close and reopen to get the latest version.');
        load();
      } else { setError(e.message); }
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    const { downloadXLSX } = await import('../lib/excel.js');
    downloadXLSX('family_leave', [{
      name: 'Family Leave',
      headers: ['Staff ID', 'Leave Type', 'Start Date', 'End Date', 'Status', 'Expected Return', 'Actual Return', 'KIT Days', 'Pay Type', 'Notes'],
      rows: items.map(i => [
        i.staff_id, typeName(i.leave_type), i.start_date || '', i.end_date || '',
        statusName(i.status), i.expected_return || '', i.actual_return || '',
        i.kit_days_used ?? 0, i.pay_type || '', i.notes || '',
      ]),
    }]);
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  if (loading) return <div className={PAGE.container}><div className={CARD.padded}><p className="text-center py-10 text-gray-500">Loading family leave data...</p></div></div>;

  const isProtected = PROTECTED_TYPES.includes(form.leave_type);

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Family Leave</h1>
          <p className={PAGE.subtitle}>Maternity, paternity, shared parental, adoption, bereavement, neonatal care leave</p>
        </div>
        <div className="flex gap-2">
          <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleExport}>Export Excel</button>
          <button className={BTN.primary + ' ' + BTN.sm} onClick={openNew}>New Leave Record</button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>}

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <StaffPicker value={filterStaff} onChange={setFilterStaff} showAll showInactive small />
        <select className={INPUT.select + ' max-w-[200px]'} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Leave Types</option>
          {FAMILY_LEAVE_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th className={TABLE.th}>Staff ID</th>
                <th className={TABLE.th}>Leave Type</th>
                <th className={TABLE.th}>Start Date</th>
                <th className={TABLE.th}>End Date</th>
                <th className={TABLE.th}>Status</th>
                <th className={TABLE.th}>Expected Return</th>
                <th className={TABLE.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={7} className={TABLE.empty}>No family leave records</td></tr>}
              {items.map(item => (
                <tr key={item.id} className={TABLE.tr}>
                  <td className={TABLE.td}>{item.staff_id}</td>
                  <td className={TABLE.td}>
                    {typeName(item.leave_type)}
                    {PROTECTED_TYPES.includes(item.leave_type) && <span className={BADGE.purple + ' ml-1'}>Protected</span>}
                  </td>
                  <td className={TABLE.td}>{item.start_date || '—'}</td>
                  <td className={TABLE.td}>{item.end_date || '—'}</td>
                  <td className={TABLE.td}><span className={BADGE[getStatusBadge(item.status, FAMILY_LEAVE_STATUSES)]}>{statusName(item.status)}</span></td>
                  <td className={TABLE.td}>{item.expected_return || '—'}</td>
                  <td className={TABLE.td}>
                    <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => openEdit(item)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className={MODAL.overlay} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className={MODAL.panelXl} onClick={e => e.stopPropagation()}>
            <h3 className={MODAL.title}>{editing ? 'Edit Family Leave' : 'New Family Leave Record'}</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <StaffPicker value={form.staff_id || ''} onChange={val => set('staff_id', val)} label="Staff Member" required />
                <div>
                  <label className={INPUT.label}>Leave Type *</label>
                  <select className={INPUT.select} value={form.leave_type} onChange={e => set('leave_type', e.target.value)}>
                    {FAMILY_LEAVE_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>

              {isProtected && (
                <div className="bg-purple-50 border border-purple-200 text-purple-700 px-4 py-3 rounded-lg text-sm">
                  <strong>Protected Period:</strong> Staff on {typeName(form.leave_type).toLowerCase()} are protected from dismissal during leave and for 18 months after return (Equality Act 2010 / ERA 1996).
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={INPUT.label}>Start Date *</label>
                  <input type="date" className={INPUT.base} value={form.start_date} onChange={e => set('start_date', e.target.value)} />
                </div>
                <div>
                  <label className={INPUT.label}>End Date</label>
                  <input type="date" className={INPUT.base} value={form.end_date} onChange={e => set('end_date', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={INPUT.label}>Status</label>
                  <select className={INPUT.select} value={form.status} onChange={e => set('status', e.target.value)}>
                    {FAMILY_LEAVE_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={INPUT.label}>Expected Return</label>
                  <input type="date" className={INPUT.base} value={form.expected_return} onChange={e => set('expected_return', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={INPUT.label}>Actual Return</label>
                  <input type="date" className={INPUT.base} value={form.actual_return} onChange={e => set('actual_return', e.target.value)} />
                </div>
                <div>
                  <label className={INPUT.label}>KIT Days Used</label>
                  <input type="number" min="0" className={INPUT.base} value={form.kit_days_used} onChange={e => set('kit_days_used', e.target.value)} />
                </div>
              </div>
              <div>
                <label className={INPUT.label}>Pay Type</label>
                <input className={INPUT.base} value={form.pay_type} onChange={e => set('pay_type', e.target.value)} placeholder="e.g. SMP, SPP, ShPP" />
              </div>
              <div>
                <label className={INPUT.label}>Notes</label>
                <textarea className={INPUT.base} rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} />
              </div>
            </div>
            <FileAttachments caseType="family_leave" caseId={editing?.id} />
            {formError && <p className="text-sm text-red-600 mt-2">{formError}</p>}
            <div className={MODAL.footer}>
              <button className={BTN.secondary} onClick={() => setShowModal(false)} disabled={saving}>Cancel</button>
              <button className={BTN.primary} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
