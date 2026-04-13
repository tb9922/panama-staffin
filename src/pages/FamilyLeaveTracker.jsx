import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import Modal from '../components/Modal.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { getCurrentHome, getHrFamilyLeave, createHrFamilyLeave, updateHrFamilyLeave } from '../lib/api.js';
import { FAMILY_LEAVE_TYPES, FAMILY_LEAVE_STATUSES, getStatusBadge } from '../lib/hr.js';
import StaffPicker from '../components/StaffPicker.jsx';
import FileAttachments from '../components/FileAttachments.jsx';
import Pagination from '../components/Pagination.jsx';
import { useData } from '../contexts/DataContext.jsx';
import useTransientNotice from '../hooks/useTransientNotice.js';

const PROTECTED_TYPES = ['maternity', 'adoption'];
const LIMIT = 50;

function normalizeLeaveType(value) {
  if (value === 'parental') return 'parental_unpaid';
  if (value === 'bereavement') return 'parental_bereavement';
  return value || 'maternity';
}

function normalizeLeaveStatus(value) {
  if (value === 'planned') return 'requested';
  if (value === 'ended') return 'returned';
  return value || 'requested';
}

function typeName(id) {
  return FAMILY_LEAVE_TYPES.find(t => t.id === id)?.name || id;
}

function statusName(id) {
  return FAMILY_LEAVE_STATUSES.find(s => s.id === id)?.name || id;
}

const blankForm = () => ({
  staff_id: '',
  leave_type: 'maternity',
  start_date: '',
  end_date: '',
  status: 'requested',
  expected_return: '',
  actual_return: '',
  kit_days_used: 0,
  pay_type: 'none',
  notes: '',
});

export default function FamilyLeaveTracker() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filterStaff, setFilterStaff] = useState('');
  const [filterType, setFilterType] = useState('');

  const home = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('hr');
  const { notice, showNotice, clearNotice } = useTransientNotice();

  useDirtyGuard(showModal);

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const filters = { limit: LIMIT, offset };
      if (filterStaff) filters.staffId = filterStaff;
      if (filterType) filters.type = filterType;
      const res = await getHrFamilyLeave(home, filters);
      setItems(res?.rows || []);
      setTotal(res?.total || 0);
      setPageError(null);
    } catch (e) {
      setPageError(e.message || 'Failed to load family leave records');
    } finally {
      setLoading(false);
    }
  }, [home, filterStaff, filterType, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [filterStaff, filterType]);

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
    setForm({
      staff_id: item.staff_id || '',
      leave_type: normalizeLeaveType(item.leave_type),
      start_date: item.start_date || '',
      end_date: item.end_date || '',
      status: normalizeLeaveStatus(item.status),
      expected_return: item.expected_return || '',
      actual_return: item.actual_return || '',
      kit_days_used: item.kit_days_used ?? 0,
      pay_type: item.pay_type || 'none',
      notes: item.notes || '',
    });
    setFormError('');
    setShowModal(true);
  }

  async function handleSave() {
    setFormError('');
    if (!form.staff_id) {
      setFormError('Staff member is required');
      return;
    }
    if (!form.leave_type) {
      setFormError('Leave type is required');
      return;
    }
    if (!form.start_date) {
      setFormError('Start date is required');
      return;
    }

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
      closeModal();
      showNotice(editing ? 'Family leave record updated.' : 'Family leave record added.');
      void load();
    } catch (e) {
      if (e.message?.includes('modified by another user')) {
        setFormError('This record was modified by another user. Please close and reopen to get the latest version.');
        void load();
      } else {
        setFormError(e.message || 'Failed to save family leave record');
      }
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
        i.staff_id,
        typeName(i.leave_type),
        i.start_date || '',
        i.end_date || '',
        statusName(i.status),
        i.expected_return || '',
        i.actual_return || '',
        i.kit_days_used ?? 0,
        i.pay_type || '',
        i.notes || '',
      ]),
    }]);
  }

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  if (loading) {
    return (
      <div className={PAGE.container}>
        <LoadingState message="Loading family leave data..." card />
      </div>
    );
  }

  if (pageError) {
    return (
      <div className={PAGE.container}>
        <ErrorState title="Could not load family leave records" message={pageError} onRetry={() => void load()} />
      </div>
    );
  }

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
          {canEdit && <button className={BTN.primary + ' ' + BTN.sm} onClick={openNew}>New Leave Record</button>}
        </div>
      </div>

      {notice && (
        <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">
          {notice.content}
        </InlineNotice>
      )}

      <div className="flex gap-3 mb-4 flex-wrap">
        <StaffPicker value={filterStaff} onChange={setFilterStaff} showAll showInactive small />
        <select className={INPUT.select + ' max-w-[200px]'} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Leave Types</option>
          {FAMILY_LEAVE_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {items.length === 0 ? (
        <div className={CARD.padded}>
          <EmptyState
            title="No family leave records yet"
            description={canEdit ? 'Record the first family leave period to track protected leave, return dates, and statutory pay.' : 'Family leave records will appear here once they are recorded.'}
            actionLabel={canEdit ? 'New Leave Record' : undefined}
            onAction={canEdit ? openNew : undefined}
          />
        </div>
      ) : (
        <div className={CARD.flush}>
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th scope="col" className={TABLE.th}>Staff ID</th>
                  <th scope="col" className={TABLE.th}>Leave Type</th>
                  <th scope="col" className={TABLE.th}>Start Date</th>
                  <th scope="col" className={TABLE.th}>End Date</th>
                  <th scope="col" className={TABLE.th}>Status</th>
                  <th scope="col" className={TABLE.th}>Expected Return</th>
                  {canEdit && <th scope="col" className={TABLE.th}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className={TABLE.tr}>
                    <td className={TABLE.td}>{item.staff_id}</td>
                    <td className={TABLE.td}>
                      {PROTECTED_TYPES.includes(item.leave_type)
                        ? (
                          <>
                            <span>Family Leave</span>
                            <span className={BADGE.purple + ' ml-1'}>Protected</span>
                          </>
                        )
                        : typeName(item.leave_type)}
                    </td>
                    <td className={TABLE.td}>{item.start_date || '--'}</td>
                    <td className={TABLE.td}>{item.end_date || '--'}</td>
                    <td className={TABLE.td}>
                      <span className={BADGE[getStatusBadge(item.status, FAMILY_LEAVE_STATUSES)]}>{statusName(item.status)}</span>
                    </td>
                    <td className={TABLE.td}>{item.expected_return || '--'}</td>
                    {canEdit && (
                      <td className={TABLE.td}>
                        <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => openEdit(item)}>Edit</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Pagination total={total} limit={LIMIT} offset={offset} onChange={setOffset} />

      {showModal && (
        <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Family Leave' : 'New Family Leave Record'} size="xl">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <StaffPicker value={form.staff_id || ''} onChange={val => setField('staff_id', val)} label="Staff Member" required />
              <div>
                <label className={INPUT.label}>Leave Type *</label>
                <select className={INPUT.select} value={form.leave_type} onChange={e => setField('leave_type', e.target.value)}>
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
                <input type="date" aria-label="Start Date" className={INPUT.base} value={form.start_date} onChange={e => setField('start_date', e.target.value)} />
              </div>
              <div>
                <label className={INPUT.label}>End Date</label>
                <input type="date" aria-label="End Date" className={INPUT.base} value={form.end_date} onChange={e => setField('end_date', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={INPUT.label}>Status</label>
                <select aria-label="Status" className={INPUT.select} value={form.status} onChange={e => setField('status', e.target.value)}>
                  {FAMILY_LEAVE_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className={INPUT.label}>Expected Return</label>
                <input type="date" aria-label="Expected Return" className={INPUT.base} value={form.expected_return} onChange={e => setField('expected_return', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={INPUT.label}>Actual Return</label>
                <input type="date" aria-label="Actual Return" className={INPUT.base} value={form.actual_return} onChange={e => setField('actual_return', e.target.value)} />
              </div>
              <div>
                <label className={INPUT.label}>KIT Days Used</label>
                <input type="number" min="0" aria-label="KIT Days Used" className={INPUT.base} value={form.kit_days_used} onChange={e => setField('kit_days_used', e.target.value)} />
              </div>
            </div>

            <div>
              <label className={INPUT.label}>Pay Type</label>
              <select aria-label="Pay Type" className={INPUT.select} value={form.pay_type} onChange={e => setField('pay_type', e.target.value)}>
                <option value="">Select pay type</option>
                <option value="SMP">SMP</option>
                <option value="SPP">SPP</option>
                <option value="ShPP">ShPP</option>
                <option value="SAP">SAP</option>
                <option value="none">No statutory pay</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">Choose the statutory payment route that applies, or leave this as no statutory pay.</p>
            </div>

            <div>
              <label className={INPUT.label}>Notes</label>
              <textarea aria-label="Notes" className={INPUT.base} rows={3} value={form.notes} onChange={e => setField('notes', e.target.value)} />
            </div>
          </div>

          <FileAttachments caseType="family_leave" caseId={editing?.id} />

          {formError && <p className="text-sm text-red-600 mt-2">{formError}</p>}

          <div className={MODAL.footer}>
            <button className={BTN.secondary} onClick={closeModal} disabled={saving}>Cancel</button>
            <button className={BTN.primary} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
