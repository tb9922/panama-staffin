import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import { getCurrentHome, getHrRenewals, createHrRenewal, updateHrRenewal } from '../lib/api.js';
import { RENEWAL_CHECK_TYPES, RENEWAL_STATUSES, getStatusBadge } from '../lib/hr.js';
import StaffPicker from '../components/StaffPicker.jsx';
import FileAttachments from '../components/FileAttachments.jsx';

function checkTypeName(id) {
  return RENEWAL_CHECK_TYPES.find(t => t.id === id)?.name || id;
}

function statusName(id) {
  return RENEWAL_STATUSES.find(s => s.id === id)?.name || id;
}

function isHighlighted(item) {
  return item.status === 'overdue' || item.status === 'expired';
}

const blankForm = () => ({
  staff_id: '', check_type: 'dbs',
  last_checked: '', expiry_date: '',
  status: 'current', reference: '',
  checked_by: '', notes: '',
  // DBS-specific
  certificate_number: '',
  // RTW-specific
  document_type: '',
});

export default function RtwDbsRenewals() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm());

  // Filters
  const [filterStaff, setFilterStaff] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const home = getCurrentHome();

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const filters = {};
      if (filterStaff) filters.staffId = filterStaff;
      if (filterType) filters.checkType = filterType;
      if (filterStatus) filters.status = filterStatus;
      setItems(await getHrRenewals(home, filters));
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [home, filterStaff, filterType, filterStatus]);

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
      check_type: item.check_type || 'dbs',
      last_checked: item.last_checked || '',
      expiry_date: item.expiry_date || '',
      status: item.status || 'current',
      reference: item.reference || '',
      checked_by: item.checked_by || '',
      notes: item.notes || '',
      certificate_number: item.certificate_number || '',
      document_type: item.document_type || '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    setError(null);
    if (!form.staff_id || !form.check_type) return;
    try {
      const payload = { ...form };
      // Strip fields not relevant to check type
      if (payload.check_type !== 'dbs') {
        delete payload.certificate_number;
      }
      if (payload.check_type !== 'rtw') {
        delete payload.document_type;
      }
      if (editing) {
        await updateHrRenewal(editing.id, payload);
      } else {
        await createHrRenewal(home, payload);
      }
      setShowModal(false);
      setForm(blankForm());
      setEditing(null);
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleExport() {
    const { downloadXLSX } = await import('../lib/excel.js');
    downloadXLSX('rtw_dbs_renewals', [{
      name: 'Renewals',
      headers: ['Staff ID', 'Check Type', 'Last Checked', 'Expiry Date', 'Status', 'Reference', 'Checked By', 'Certificate No', 'Document Type', 'Notes'],
      rows: items.map(i => [
        i.staff_id, checkTypeName(i.check_type), i.last_checked || '', i.expiry_date || '',
        statusName(i.status), i.reference || '', i.checked_by || '',
        i.certificate_number || '', i.document_type || '', i.notes || '',
      ]),
    }]);
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  if (loading) return <div className={PAGE.container}><div className={CARD.padded}><p className="text-center py-10 text-gray-500">Loading renewal data...</p></div></div>;

  const overdueCount = items.filter(isHighlighted).length;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>RTW & DBS Renewals</h1>
          <p className={PAGE.subtitle}>
            Right to Work and DBS check tracking — CQC Reg 19 (Fit & proper persons employed)
            {overdueCount > 0 && <span className="text-red-600 font-semibold ml-2">{overdueCount} overdue/expired</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleExport}>Export Excel</button>
          <button className={BTN.primary + ' ' + BTN.sm} onClick={openNew}>New Check</button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>}

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <StaffPicker value={filterStaff} onChange={setFilterStaff} showAll showInactive small />
        <select className={INPUT.select + ' max-w-[200px]'} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Check Types</option>
          {RENEWAL_CHECK_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className={INPUT.select + ' max-w-[200px]'} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {RENEWAL_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th className={TABLE.th}>Staff ID</th>
                <th className={TABLE.th}>Check Type</th>
                <th className={TABLE.th}>Last Checked</th>
                <th className={TABLE.th}>Expiry Date</th>
                <th className={TABLE.th}>Status</th>
                <th className={TABLE.th}>Checked By</th>
                <th className={TABLE.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={7} className={TABLE.empty}>No renewal records</td></tr>}
              {items.map(item => {
                const highlighted = isHighlighted(item);
                return (
                  <tr key={item.id} className={`${TABLE.tr} ${highlighted ? 'bg-red-50' : ''}`}>
                    <td className={TABLE.td}>{item.staff_id}</td>
                    <td className={TABLE.td}>{checkTypeName(item.check_type)}</td>
                    <td className={TABLE.td}>{item.last_checked || '—'}</td>
                    <td className={TABLE.td}>
                      <span className={highlighted ? 'text-red-600 font-semibold' : ''}>
                        {item.expiry_date || '—'}
                      </span>
                    </td>
                    <td className={TABLE.td}><span className={BADGE[getStatusBadge(item.status, RENEWAL_STATUSES)]}>{statusName(item.status)}</span></td>
                    <td className={TABLE.td}>{item.checked_by || '—'}</td>
                    <td className={TABLE.td}>
                      <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => openEdit(item)}>Edit</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className={MODAL.overlay} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className={MODAL.panelXl} onClick={e => e.stopPropagation()}>
            <h3 className={MODAL.title}>{editing ? 'Edit Renewal Check' : 'New Renewal Check'}</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <StaffPicker value={form.staff_id || ''} onChange={val => set('staff_id', val)} label="Staff Member" required />
                <div>
                  <label className={INPUT.label}>Check Type *</label>
                  <select className={INPUT.select} value={form.check_type} onChange={e => set('check_type', e.target.value)}>
                    {RENEWAL_CHECK_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={INPUT.label}>Last Checked</label>
                  <input type="date" className={INPUT.base} value={form.last_checked} onChange={e => set('last_checked', e.target.value)} />
                </div>
                <div>
                  <label className={INPUT.label}>Expiry Date</label>
                  <input type="date" className={INPUT.base} value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={INPUT.label}>Status</label>
                  <select className={INPUT.select} value={form.status} onChange={e => set('status', e.target.value)}>
                    {RENEWAL_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={INPUT.label}>Reference</label>
                  <input className={INPUT.base} value={form.reference} onChange={e => set('reference', e.target.value)} placeholder="Reference number" />
                </div>
              </div>
              <div>
                <label className={INPUT.label}>Checked By</label>
                <input className={INPUT.base} value={form.checked_by} onChange={e => set('checked_by', e.target.value)} />
              </div>

              {/* DBS-specific */}
              {form.check_type === 'dbs' && (
                <div>
                  <label className={INPUT.label}>Certificate Number</label>
                  <input className={INPUT.base} value={form.certificate_number} onChange={e => set('certificate_number', e.target.value)} placeholder="DBS certificate number" />
                </div>
              )}

              {/* RTW-specific */}
              {form.check_type === 'rtw' && (
                <div>
                  <label className={INPUT.label}>Document Type</label>
                  <input className={INPUT.base} value={form.document_type} onChange={e => set('document_type', e.target.value)} placeholder="e.g. Passport, BRP, Share Code" />
                </div>
              )}

              <div>
                <label className={INPUT.label}>Notes</label>
                <textarea className={INPUT.base} rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} />
              </div>
            </div>
            <FileAttachments caseType="renewal" caseId={editing?.id} />
            <div className={MODAL.footer}>
              <button className={BTN.secondary} onClick={() => setShowModal(false)}>Cancel</button>
              <button className={BTN.primary} onClick={handleSave}>{editing ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
