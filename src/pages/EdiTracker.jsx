import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import Modal from '../components/Modal.jsx';
import { getCurrentHome, getHrEdi, createHrEdi, updateHrEdi } from '../lib/api.js';
import { EDI_RECORD_TYPES, EDI_STATUSES, HARASSMENT_CATEGORIES, getStatusBadge } from '../lib/hr.js';
import StaffPicker from '../components/StaffPicker.jsx';
import FileAttachments from '../components/FileAttachments.jsx';
import Pagination from '../components/Pagination.jsx';
import { useData } from '../contexts/DataContext.jsx';

function recordTypeName(id) {
  return EDI_RECORD_TYPES.find(t => t.id === id)?.name || id;
}

function statusName(id) {
  return EDI_STATUSES.find(s => s.id === id)?.name || id;
}

function categoryName(id) {
  return HARASSMENT_CATEGORIES.find(c => c.id === id)?.name || id;
}

const blankForm = () => ({
  record_type: 'harassment_complaint', staff_id: '',
  date_recorded: new Date().toISOString().slice(0, 10),
  category: '', status: 'open', notes: '',
  // harassment-specific
  third_party: false, respondent_name: '', respondent_role: '',
  // reasonable adjustment-specific
  condition_description: '', adjustments: '',
});

export default function EdiTracker() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  // Filters
  const [filterType, setFilterType] = useState('');
  const [filterStaff, setFilterStaff] = useState('');

  const home = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('hr');
  useDirtyGuard(showModal);

  const LIMIT = 50;

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const filters = { limit: LIMIT, offset };
      if (filterType) filters.recordType = filterType;
      if (filterStaff) filters.staffId = filterStaff;
      const res = await getHrEdi(home, filters);
      setItems(res?.rows || []);
      setTotal(res?.total || 0);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [home, filterType, filterStaff, offset]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setOffset(0); }, [filterType, filterStaff]);

  function closeModal() {
    setShowModal(false);
    setEditing(null);
    setForm(blankForm());
    setFormError('');
  }

  function openNew() {
    setEditing(null);
    setForm(blankForm());
    setFormError('');
    setShowModal(true);
  }

  function openEdit(item) {
    setEditing(item);
    setFormError('');
    setForm({
      record_type: item.record_type || 'harassment_complaint',
      staff_id: item.staff_id || '',
      date_recorded: item.date_recorded || '',
      category: item.category || '',
      status: item.status || 'open',
      notes: item.notes || '',
      third_party: item.third_party || false,
      respondent_name: item.respondent_name || '',
      respondent_role: item.respondent_role || '',
      condition_description: item.condition_description || '',
      adjustments: item.adjustments || '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    setFormError('');
    setError(null);
    if (!form.staff_id) { setFormError('Staff member is required'); return; }
    if (!form.record_type) { setFormError('Record type is required'); return; }
    if (!form.date_recorded) { setFormError('Date recorded is required'); return; }
    setSaving(true);
    try {
      const payload = { ...form };
      // Strip fields not relevant to selected record type
      if (payload.record_type !== 'harassment_complaint') {
        delete payload.third_party;
        delete payload.respondent_name;
        delete payload.respondent_role;
      }
      if (payload.record_type !== 'reasonable_adjustment') {
        delete payload.condition_description;
        delete payload.adjustments;
      }
      if (editing) {
        await updateHrEdi(editing.id, { ...payload, _version: editing.version });
      } else {
        await createHrEdi(home, payload);
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
    downloadXLSX('edi_records', [{
      name: 'EDI',
      headers: ['Record Type', 'Staff ID', 'Date Recorded', 'Category', 'Status', 'Notes'],
      rows: items.map(i => [
        recordTypeName(i.record_type), i.staff_id, i.date_recorded || '',
        i.category || '', statusName(i.status), i.notes || '',
      ]),
    }]);
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  if (loading) return <div className={PAGE.container} role="status"><div className={CARD.padded}><p className="text-center py-10 text-gray-500">Loading EDI data...</p></div></div>;

  const isHarassment = form.record_type === 'harassment_complaint';
  const isAdjustment = form.record_type === 'reasonable_adjustment';

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Equality, Diversity & Inclusion</h1>
          <p className={PAGE.subtitle}>Harassment complaints and reasonable adjustments — Equality Act 2010</p>
        </div>
        <div className="flex gap-2">
          <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleExport}>Export Excel</button>
          {canEdit && <button className={BTN.primary + ' ' + BTN.sm} onClick={openNew}>New Record</button>}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4" role="alert">{error}</div>}

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <select className={INPUT.select + ' max-w-[200px]'} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Record Types</option>
          {EDI_RECORD_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <StaffPicker value={filterStaff} onChange={setFilterStaff} showAll showInactive small />
      </div>

      {/* Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Record Type</th>
                <th scope="col" className={TABLE.th}>Staff ID</th>
                <th scope="col" className={TABLE.th}>Date Recorded</th>
                <th scope="col" className={TABLE.th}>Category</th>
                <th scope="col" className={TABLE.th}>Status</th>
                {canEdit && <th scope="col" className={TABLE.th}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={6} className={TABLE.empty}>No EDI records</td></tr>}
              {items.map(item => (
                <tr key={item.id} className={TABLE.tr}>
                  <td className={TABLE.td}>{recordTypeName(item.record_type)}</td>
                  <td className={TABLE.td}>{item.staff_id}</td>
                  <td className={TABLE.td}>{item.date_recorded || '—'}</td>
                  <td className={TABLE.td}>
                    {item.record_type === 'harassment_complaint'
                      ? categoryName(item.category)
                      : (item.category || '—')}
                  </td>
                  <td className={TABLE.td}><span className={BADGE[getStatusBadge(item.status, EDI_STATUSES)]}>{statusName(item.status)}</span></td>
                  {canEdit && <td className={TABLE.td}>
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
        <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit EDI Record' : 'New EDI Record'} size="xl">
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={INPUT.label}>Record Type *</label>
                  <select className={INPUT.select} value={form.record_type} onChange={e => set('record_type', e.target.value)}>
                    {EDI_RECORD_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <StaffPicker value={form.staff_id || ''} onChange={val => set('staff_id', val)} label="Staff Member" required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={INPUT.label}>Date Recorded *</label>
                  <input type="date" className={INPUT.base} value={form.date_recorded} onChange={e => set('date_recorded', e.target.value)} />
                </div>
                <div>
                  <label className={INPUT.label}>Status</label>
                  <select className={INPUT.select} value={form.status} onChange={e => set('status', e.target.value)}>
                    {EDI_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Category — context-dependent */}
              <div>
                <label className={INPUT.label}>Category</label>
                {isHarassment ? (
                  <select className={INPUT.select} value={form.category} onChange={e => set('category', e.target.value)}>
                    <option value="">— Select —</option>
                    {HARASSMENT_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                ) : (
                  <input className={INPUT.base} value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Physical, Sensory, Neurodivergent" />
                )}
              </div>

              {/* Harassment-specific fields */}
              {isHarassment && (
                <>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="edi-third-party" checked={form.third_party} onChange={e => set('third_party', e.target.checked)} />
                    <label htmlFor="edi-third-party" className="text-sm text-gray-700">Third-party harassment (perpetrator is not an employee)</label>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={INPUT.label}>Respondent Name</label>
                      <input className={INPUT.base} value={form.respondent_name} onChange={e => set('respondent_name', e.target.value)} />
                    </div>
                    <div>
                      <label className={INPUT.label}>Respondent Role</label>
                      <input className={INPUT.base} value={form.respondent_role} onChange={e => set('respondent_role', e.target.value)} />
                    </div>
                  </div>
                </>
              )}

              {/* Reasonable adjustment-specific fields */}
              {isAdjustment && (
                <>
                  <div>
                    <label className={INPUT.label}>Condition Description</label>
                    <textarea className={INPUT.base} rows={2} value={form.condition_description} onChange={e => set('condition_description', e.target.value)} placeholder="Describe the condition or disability" />
                  </div>
                  <div>
                    <label className={INPUT.label}>Adjustments</label>
                    <textarea className={INPUT.base} rows={3} value={form.adjustments} onChange={e => set('adjustments', e.target.value)} placeholder="Describe the reasonable adjustments made or requested" />
                  </div>
                </>
              )}

              <div>
                <label className={INPUT.label}>Notes</label>
                <textarea className={INPUT.base} rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} />
              </div>
            </div>
            <FileAttachments caseType="edi" caseId={editing?.id} />
            {formError && <p className="text-sm text-red-600 mt-2">{formError}</p>}
            <div className={MODAL.footer}>
              <button className={BTN.secondary} disabled={saving} onClick={closeModal}>Cancel</button>
              <button className={BTN.primary} disabled={saving} onClick={handleSave}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</button>
            </div>
        </Modal>
      )}
    </div>
  );
}
