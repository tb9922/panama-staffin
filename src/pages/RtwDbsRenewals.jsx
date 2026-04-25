import { useState, useEffect, useCallback, useId } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE, ESC_COLORS } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import Modal from '../components/Modal.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { getCurrentHome, getHrRenewals, createHrRenewal, updateHrRenewal } from '../lib/api.js';
import { RENEWAL_CHECK_TYPES, RENEWAL_STATUSES, getStatusBadge } from '../lib/hr.js';
import StaffPicker from '../components/StaffPicker.jsx';
import FileAttachments from '../components/FileAttachments.jsx';
import Pagination from '../components/Pagination.jsx';
import { useData } from '../contexts/DataContext.jsx';
import { parseLocalDate, todayLocalISO } from '../lib/localDates.js';

const RTW_DOCUMENT_TYPE_OPTIONS = [
  { id: 'passport', name: 'Passport' },
  { id: 'brp', name: 'BRP' },
  { id: 'share_code', name: 'Share Code' },
  { id: 'settled_status', name: 'Settled Status' },
  { id: 'pre_settled', name: 'Pre-Settled Status' },
];

function checkTypeName(id) {
  return RENEWAL_CHECK_TYPES.find(t => t.id === id)?.name || id;
}

function statusName(id) {
  return RENEWAL_STATUSES.find(s => s.id === id)?.name || id;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntil(dateStr) {
  const date = parseLocalDate(dateStr);
  const today = parseLocalDate(todayLocalISO());
  if (!date || !today) return null;
  return Math.ceil((date.getTime() - today.getTime()) / DAY_MS);
}

function getRenewalUrgency(item) {
  if (item.status === 'overdue' || item.status === 'expired') {
    return { level: 'red', label: item.status === 'expired' ? 'expired' : 'overdue' };
  }
  if (!item.expiry_date) return null;
  const days = daysUntil(item.expiry_date);
  if (days == null) return null;
  if (days < 0) return { level: 'red', label: `overdue by ${Math.abs(days)}d` };
  if (days <= 14) return { level: 'amber', label: days === 0 ? 'due today' : `due in ${days}d` };
  if (days <= 30) return { level: 'yellow', label: `due in ${days}d` };
  return null;
}

const blankForm = () => ({
  staff_id: '', check_type: 'dbs',
  last_checked: '', expiry_date: '',
  status: 'current',
  checked_by: '', notes: '',
  // DBS-specific
  certificate_number: '', dbs_disclosure_level: '', dbs_update_service_registered: false,
  dbs_update_service_last_checked: '', dbs_barred_list_check: true,
  // RTW-specific
  document_type: '', rtw_next_check_due: '',
});

const LIMIT = 50;

export default function RtwDbsRenewals() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
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
  const [filterStatus, setFilterStatus] = useState('');

  const home = getCurrentHome();
  const renewalCheckTypeId = useId();
  const renewalLastCheckedId = useId();
  const renewalExpiryDateId = useId();
  const renewalStatusId = useId();
  const renewalCheckedById = useId();
  const renewalCertificateNumberId = useId();
  const renewalDisclosureLevelId = useId();
  const renewalUpdateServiceRegisteredId = useId();
  const renewalUpdateServiceLastCheckedId = useId();
  const renewalBarredListCheckId = useId();
  const renewalDocumentTypeId = useId();
  const renewalRtwNextCheckDueId = useId();
  const renewalNotesId = useId();
  const { canWrite } = useData();
  const canEdit = canWrite('hr');
  useDirtyGuard(showModal);

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const filters = { limit: LIMIT, offset };
      if (filterStaff) filters.staffId = filterStaff;
      if (filterType) filters.checkType = filterType;
      if (filterStatus) filters.status = filterStatus;
      const res = await getHrRenewals(home, filters);
      setItems(res?.rows || []);
      setTotal(res?.total || 0);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [home, filterStaff, filterType, filterStatus, offset]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setOffset(0); }, [filterStaff, filterType, filterStatus]);

  function closeModal() {
    setShowModal(false);
    setEditing(null);
    setForm(blankForm());
    setFormError('');
  }

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
      checked_by: item.checked_by || '',
      notes: item.notes || '',
      certificate_number: item.certificate_number || '',
      dbs_disclosure_level: item.dbs_disclosure_level || '',
      dbs_update_service_registered: item.dbs_update_service_registered ?? false,
      dbs_update_service_last_checked: item.dbs_update_service_last_checked || '',
      dbs_barred_list_check: item.dbs_barred_list_check ?? true,
      document_type: item.document_type || '',
      rtw_next_check_due: item.rtw_next_check_due || '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    setError(null);
    setFormError('');
    if (!form.staff_id) { setFormError('Staff member is required'); return; }
    if (!form.check_type) { setFormError('Check type is required'); return; }
    setSaving(true);
    try {
      const payload = { ...form };
      // Strip fields not relevant to check type
      if (payload.check_type !== 'dbs') {
        delete payload.certificate_number;
        delete payload.dbs_disclosure_level;
        delete payload.dbs_update_service_registered;
        delete payload.dbs_update_service_last_checked;
        delete payload.dbs_barred_list_check;
      }
      if (payload.check_type !== 'rtw') {
        delete payload.document_type;
        delete payload.rtw_next_check_due;
      }
      if (editing) {
        await updateHrRenewal(editing.id, { ...payload, _version: editing.version });
      } else {
        await createHrRenewal(home, payload);
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
    downloadXLSX('rtw_dbs_renewals', [{
      name: 'Renewals',
      headers: ['Staff ID', 'Check Type', 'Last Checked', 'Expiry Date', 'Status', 'Checked By', 'Certificate No', 'Document Type', 'Notes'],
      rows: items.map(i => [
        i.staff_id, checkTypeName(i.check_type), i.last_checked || '', i.expiry_date || '',
        statusName(i.status), i.checked_by || '',
        i.certificate_number || '', i.document_type || '', i.notes || '',
      ]),
    }]);
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading renewal data..." card /></div>;

  const urgencyCounts = items.reduce((counts, item) => {
    const urgency = getRenewalUrgency(item);
    if (urgency?.level === 'red') counts.red += 1;
    if (urgency?.level === 'amber' || urgency?.level === 'yellow') counts.soon += 1;
    return counts;
  }, { red: 0, soon: 0 });

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>RTW & DBS Renewals</h1>
          <p className={PAGE.subtitle}>
            Right to Work and DBS check tracking — CQC Reg 19 (Fit & proper persons employed)
            {urgencyCounts.red > 0 && <span className="text-red-600 font-semibold ml-2">{urgencyCounts.red} overdue/expired</span>}
            {urgencyCounts.soon > 0 && <span className={`${ESC_COLORS.amber.text} font-semibold ml-2`}>{urgencyCounts.soon} due within 30 days</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleExport}>Export Excel</button>
          {canEdit && <button className={BTN.primary + ' ' + BTN.sm} onClick={openNew}>New Check</button>}
        </div>
      </div>

      {error && <ErrorState title="Unable to load renewal records" message={error} onRetry={load} className="mb-4" />}

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
                <th scope="col" className={TABLE.th}>Staff ID</th>
                <th scope="col" className={TABLE.th}>Check Type</th>
                <th scope="col" className={TABLE.th}>Last Checked</th>
                <th scope="col" className={TABLE.th}>Expiry Date</th>
                <th scope="col" className={TABLE.th}>Status</th>
                <th scope="col" className={TABLE.th}>Checked By</th>
                {canEdit && <th scope="col" className={TABLE.th}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className={TABLE.empty}>
                    <EmptyState
                      title="No renewal records"
                      description={canEdit ? 'Create the first RTW or DBS check to start tracking due dates and expiries.' : 'Renewal records will appear here once they have been recorded.'}
                      actionLabel={canEdit ? 'New Check' : undefined}
                      onAction={canEdit ? openNew : undefined}
                      compact
                    />
                  </td>
                </tr>
              )}
              {items.map(item => {
                const urgency = getRenewalUrgency(item);
                const highlighted = urgency ? ESC_COLORS[urgency.level].card : '';
                return (
                  <tr key={item.id} className={`${TABLE.tr} ${highlighted}`}>
                    <td className={TABLE.td}>{item.staff_id}</td>
                    <td className={TABLE.td}>{checkTypeName(item.check_type)}</td>
                    <td className={TABLE.td}>{item.last_checked || '—'}</td>
                    <td className={TABLE.td}>
                      <span className={urgency ? `${ESC_COLORS[urgency.level].text} font-semibold` : ''}>
                        {item.expiry_date || '—'}
                        {urgency && ` (${urgency.label})`}
                      </span>
                    </td>
                    <td className={TABLE.td}><span className={BADGE[getStatusBadge(item.status, RENEWAL_STATUSES)]}>{statusName(item.status)}</span></td>
                    <td className={TABLE.td}>{item.checked_by || '—'}</td>
                    {canEdit && <td className={TABLE.td}>
                      <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => openEdit(item)}>Edit</button>
                    </td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination total={total} limit={LIMIT} offset={offset} onChange={setOffset} />
      </div>

      {/* Modal */}
      {showModal && (
        <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Renewal Check' : 'New Renewal Check'} size="xl">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <StaffPicker value={form.staff_id || ''} onChange={val => set('staff_id', val)} label="Staff Member" required />
                <div>
                  <label htmlFor={renewalCheckTypeId} className={INPUT.label}>Check Type *</label>
                  <select id={renewalCheckTypeId} className={INPUT.select} value={form.check_type} onChange={e => set('check_type', e.target.value)}>
                    {RENEWAL_CHECK_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={renewalLastCheckedId} className={INPUT.label}>Last Checked</label>
                  <input id={renewalLastCheckedId} type="date" className={INPUT.base} value={form.last_checked} onChange={e => set('last_checked', e.target.value)} />
                </div>
                <div>
                  <label htmlFor={renewalExpiryDateId} className={INPUT.label}>Expiry Date</label>
                  <input id={renewalExpiryDateId} type="date" className={INPUT.base} value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={renewalStatusId} className={INPUT.label}>Status</label>
                  <select id={renewalStatusId} className={INPUT.select} value={form.status} onChange={e => set('status', e.target.value)}>
                    {RENEWAL_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor={renewalCheckedById} className={INPUT.label}>Checked By</label>
                <input id={renewalCheckedById} className={INPUT.base} value={form.checked_by} onChange={e => set('checked_by', e.target.value)} />
              </div>

              {/* DBS-specific */}
              {form.check_type === 'dbs' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor={renewalCertificateNumberId} className={INPUT.label}>Certificate Number</label>
                    <input id={renewalCertificateNumberId} className={INPUT.base} value={form.certificate_number} onChange={e => set('certificate_number', e.target.value)} placeholder="DBS certificate number" />
                  </div>
                  <div>
                    <label htmlFor={renewalDisclosureLevelId} className={INPUT.label}>Disclosure Level</label>
                    <select id={renewalDisclosureLevelId} className={INPUT.select} value={form.dbs_disclosure_level} onChange={e => set('dbs_disclosure_level', e.target.value)}>
                      <option value="">Select...</option>
                      <option value="enhanced">Enhanced</option>
                      <option value="enhanced_barred">Enhanced + Barred List</option>
                      <option value="standard">Standard</option>
                      <option value="basic">Basic</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input id={renewalBarredListCheckId} type="checkbox" checked={form.dbs_barred_list_check} onChange={e => set('dbs_barred_list_check', e.target.checked)} />
                    <label htmlFor={renewalBarredListCheckId} className="text-sm text-gray-700">Barred List Checked</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input id={renewalUpdateServiceRegisteredId} type="checkbox" checked={form.dbs_update_service_registered} onChange={e => set('dbs_update_service_registered', e.target.checked)} />
                    <label htmlFor={renewalUpdateServiceRegisteredId} className="text-sm text-gray-700">DBS Update Service Registered</label>
                  </div>
                  {form.dbs_update_service_registered && (
                    <div>
                      <label htmlFor={renewalUpdateServiceLastCheckedId} className={INPUT.label}>Last Update Service Check</label>
                      <input id={renewalUpdateServiceLastCheckedId} type="date" className={INPUT.base} value={form.dbs_update_service_last_checked} onChange={e => set('dbs_update_service_last_checked', e.target.value)} />
                    </div>
                  )}
                </div>
              )}

              {/* RTW-specific */}
              {form.check_type === 'rtw' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor={renewalDocumentTypeId} className={INPUT.label}>Document Type</label>
                    <select id={renewalDocumentTypeId} className={INPUT.select} value={form.document_type} onChange={e => set('document_type', e.target.value)}>
                      <option value="">Select document type</option>
                      {RTW_DOCUMENT_TYPE_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={renewalRtwNextCheckDueId} className={INPUT.label}>Next RTW Check Due</label>
                    <input id={renewalRtwNextCheckDueId} type="date" className={INPUT.base} value={form.rtw_next_check_due} onChange={e => set('rtw_next_check_due', e.target.value)} />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor={renewalNotesId} className={INPUT.label}>Notes</label>
                <textarea id={renewalNotesId} className={INPUT.base} rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} />
              </div>
            </div>
            <FileAttachments caseType="renewal" caseId={editing?.id} />
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
