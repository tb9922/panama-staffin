import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import Modal from '../components/Modal.jsx';
import { getCurrentHome, getLoggedInUser, getHrContracts, createHrContract, updateHrContract } from '../lib/api.js';
import { CONTRACT_TYPES, CONTRACT_STATUSES, getStatusBadge } from '../lib/hr.js';
import StaffPicker from '../components/StaffPicker.jsx';
import FileAttachments from '../components/FileAttachments.jsx';
import Pagination from '../components/Pagination.jsx';

const emptyForm = () => ({
  staff_id: '', contract_type: 'permanent', start_date: '', end_date: '',
  status: 'active', hours_per_week: '', hourly_rate: '',
  probation_end_date: '', notes: '',
});

export default function ContractManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  useDirtyGuard(showModal);

  // Filters
  const [filterStaff, setFilterStaff] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');

  const home = getCurrentHome();
  const isAdmin = getLoggedInUser()?.role === 'admin';

  const LIMIT = 50;

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const filters = { limit: LIMIT, offset };
      if (filterStaff) filters.staffId = filterStaff;
      if (filterStatus) filters.status = filterStatus;
      if (filterType) filters.contractType = filterType;
      const res = await getHrContracts(home, filters);
      setItems(res?.rows || []);
      setTotal(res?.total || 0);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [home, filterStaff, filterStatus, filterType, offset]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setOffset(0); }, [filterStaff, filterStatus, filterType]);

  function closeModal() {
    setShowModal(false);
    setEditing(null);
    setForm(emptyForm());
    setFormError('');
  }

  function openNew() {
    setEditing(null);
    setForm(emptyForm());
    setShowModal(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({
      staff_id: item.staff_id || '',
      contract_type: item.contract_type || 'permanent',
      start_date: item.start_date || '',
      end_date: item.end_date || '',
      status: item.status || 'active',
      hours_per_week: item.hours_per_week ?? '',
      hourly_rate: item.hourly_rate ?? '',
      probation_end_date: item.probation_end_date || '',
      notes: item.notes || '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    setFormError('');
    setError(null);
    if (!form.staff_id) { setFormError('Staff member is required'); return; }
    if (!form.start_date) { setFormError('Start date is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        hours_per_week: form.hours_per_week !== '' ? parseFloat(form.hours_per_week) : null,
        hourly_rate: form.hourly_rate !== '' ? parseFloat(form.hourly_rate) : null,
      };
      if (editing) await updateHrContract(editing.id, { ...payload, _version: editing.version });
      else await createHrContract(home, payload);
      setShowModal(false); setEditing(null); setForm(emptyForm()); load();
    } catch (e) {
      if (e.message?.includes('modified by another user')) {
        setError('This record was modified by another user. Please close and reopen to get the latest version.');
        load();
      } else { setError(e.message); }
    } finally { setSaving(false); }
  }

  async function handleExport() {
    const { downloadXLSX } = await import('../lib/excel.js');
    downloadXLSX('contracts', [{
      name: 'Contracts',
      headers: ['Staff ID', 'Contract Type', 'Start Date', 'End Date', 'Status', 'Hours/Week', 'Probation End'],
      rows: items.map(i => [
        i.staff_id,
        CONTRACT_TYPES.find(t => t.id === i.contract_type)?.name || i.contract_type,
        i.start_date || '', i.end_date || '',
        CONTRACT_STATUSES.find(s => s.id === i.status)?.name || i.status,
        i.hours_per_week ?? '', i.probation_end_date || '',
      ]),
    }]);
  }

  // Probation tracker: contracts in probation with days remaining
  const probationItems = items.filter(c => c.status === 'probation' && c.probation_end_date);
  const today = new Date().toISOString().slice(0, 10);

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const diff = (new Date(dateStr) - new Date(today)) / 86400000;
    return Math.ceil(diff);
  }

  const f = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  if (loading) return <div className={PAGE.container} role="status"><div className={CARD.padded}><p className="text-center py-10 text-gray-500">Loading contracts...</p></div></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Contract Manager</h1>
          <p className={PAGE.subtitle}>Staff contracts, probation tracking, and employment terms</p>
        </div>
        <div className="flex gap-2">
          <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleExport}>Export Excel</button>
          {isAdmin && <button className={BTN.primary + ' ' + BTN.sm} onClick={openNew}>New Contract</button>}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <StaffPicker value={filterStaff} onChange={setFilterStaff} showAll showInactive small />
        <select className={INPUT.select + ' max-w-[160px]'} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {CONTRACT_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className={INPUT.select + ' max-w-[180px]'} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {CONTRACT_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {/* Probation Tracker */}
      {probationItems.length > 0 && (
        <div className={CARD.padded + ' mb-4'}>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Probation Tracker</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {probationItems.map(c => {
              const days = daysUntil(c.probation_end_date);
              const overdue = days !== null && days < 0;
              const soon = days !== null && days >= 0 && days <= 14;
              return (
                <div key={c.id} className={`p-3 rounded-lg border ${overdue ? 'border-red-200 bg-red-50' : soon ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                  <p className="text-sm font-medium">{c.staff_id}</p>
                  <p className="text-xs text-gray-500">Ends: {c.probation_end_date}</p>
                  <p className={`text-xs font-semibold ${overdue ? 'text-red-600' : soon ? 'text-amber-600' : 'text-gray-600'}`}>
                    {overdue ? `${Math.abs(days)} days overdue` : `${days} days remaining`}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Staff ID</th>
                <th scope="col" className={TABLE.th}>Contract Type</th>
                <th scope="col" className={TABLE.th}>Start Date</th>
                <th scope="col" className={TABLE.th}>Status</th>
                <th scope="col" className={TABLE.th}>Probation End</th>
                <th scope="col" className={TABLE.th}>Hours/Week</th>
                <th scope="col" className={TABLE.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={7} className={TABLE.empty}>No contracts</td></tr>}
              {items.map(item => (
                <tr key={item.id} className={TABLE.tr}>
                  <td className={TABLE.td + ' font-medium'}>{item.staff_id}</td>
                  <td className={TABLE.td}>
                    {CONTRACT_TYPES.find(t => t.id === item.contract_type)?.name || item.contract_type}
                  </td>
                  <td className={TABLE.td}>{item.start_date || '—'}</td>
                  <td className={TABLE.td}>
                    <span className={BADGE[getStatusBadge(item.status, CONTRACT_STATUSES)]}>
                      {CONTRACT_STATUSES.find(s => s.id === item.status)?.name || item.status}
                    </span>
                  </td>
                  <td className={TABLE.td}>{item.probation_end_date || '—'}</td>
                  <td className={TABLE.tdMono}>{item.hours_per_week ?? '—'}</td>
                  {isAdmin && <td className={TABLE.td}>
                    <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => openEdit(item)}>Edit</button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination total={total} limit={LIMIT} offset={offset} onChange={setOffset} />

      {/* Modal */}
      {showModal && (
        <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Contract' : 'New Contract'} size="xl">
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <StaffPicker value={form.staff_id || ''} onChange={val => f('staff_id', val)} label="Staff Member" />
                <div>
                  <label className={INPUT.label}>Contract Type</label>
                  <select className={INPUT.select} value={form.contract_type} onChange={e => f('contract_type', e.target.value)}>
                    {CONTRACT_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={INPUT.label}>Start Date</label>
                  <input type="date" className={INPUT.base} value={form.start_date} onChange={e => f('start_date', e.target.value)} />
                </div>
                <div>
                  <label className={INPUT.label}>End Date</label>
                  <input type="date" className={INPUT.base} value={form.end_date} onChange={e => f('end_date', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={INPUT.label}>Status</label>
                  <select className={INPUT.select} value={form.status} onChange={e => f('status', e.target.value)}>
                    {CONTRACT_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={INPUT.label}>Probation End Date</label>
                  <input type="date" className={INPUT.base} value={form.probation_end_date} onChange={e => f('probation_end_date', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={INPUT.label}>Hours/Week</label>
                  <input type="number" step="0.5" className={INPUT.base} value={form.hours_per_week} onChange={e => f('hours_per_week', e.target.value)} />
                </div>
                <div>
                  <label className={INPUT.label}>Hourly Rate</label>
                  <input type="number" step="0.01" className={INPUT.base} value={form.hourly_rate} onChange={e => f('hourly_rate', e.target.value)} />
                </div>
              </div>
              <div>
                <label className={INPUT.label}>Notes</label>
                <textarea className={INPUT.base} rows={3} value={form.notes} onChange={e => f('notes', e.target.value)} />
              </div>
            </div>
            <FileAttachments caseType="contract" caseId={editing?.id} />
            {formError && <p className="text-sm text-red-600 mt-2">{formError}</p>}
            <div className={MODAL.footer}>
              <button className={BTN.secondary} onClick={closeModal} disabled={saving}>Cancel</button>
              <button className={BTN.primary} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</button>
            </div>
        </Modal>
      )}
    </div>
  );
}
