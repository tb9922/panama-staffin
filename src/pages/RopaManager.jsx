import { useState, useEffect, useMemo, useCallback } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { BTN, CARD, TABLE, INPUT, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import FileAttachments from '../components/FileAttachments.jsx';
import { useData } from '../contexts/DataContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import {
  getCurrentHome,
  getRopaActivities,
  createRopaActivity,
  updateRopaActivity,
  deleteRopaActivity,
  getRecordAttachments,
  uploadRecordAttachment,
  deleteRecordAttachment,
  downloadRecordAttachment,
} from '../lib/api.js';
import { LEGAL_BASES } from '../lib/gdpr.js';

const EMPTY_FORM = {
  purpose: '', legal_basis: 'legal_obligation', categories_of_individuals: '', categories_of_data: '',
  categories_of_recipients: '', international_transfers: false, transfer_safeguards: '',
  retention_period: '', security_measures: '', data_source: '', system_or_asset: '',
  special_category: false, dpia_required: false, status: 'active',
  last_reviewed: '', next_review_due: '', notes: '',
};

const STATUS_BADGES = { active: 'green', under_review: 'amber', archived: 'gray' };

export default function RopaManager() {
  const home = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('gdpr');
  const { confirm, ConfirmDialog } = useConfirm();
  const { showToast } = useToast();

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  useDirtyGuard(showModal);

  const [filterStatus, setFilterStatus] = useState('');

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true); setError(null);
    try {
      const data = await getRopaActivities(home, { status: filterStatus || undefined, limit: 200 });
      setItems(data.rows || []); setTotal(data.total || 0);
    } catch (e) { setError(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  }, [home, filterStatus]);

  useEffect(() => { load(); }, [load]);

  function openNew() { setEditing(null); setForm({ ...EMPTY_FORM }); setFormError(''); setShowModal(true); }
  function openEdit(item) {
    setEditing(item);
    setForm(Object.fromEntries(Object.keys(EMPTY_FORM).map(k => [k, item[k] ?? EMPTY_FORM[k]])));
    setFormError(''); setShowModal(true);
  }
  function closeModal() { setShowModal(false); setEditing(null); setFormError(''); }

  async function handleSave() {
    if (!form.purpose.trim() || !form.legal_basis || !form.categories_of_individuals.trim() || !form.categories_of_data.trim()) {
      setFormError('Purpose, legal basis, individuals, and data categories are required'); return;
    }
    setSaving(true); setFormError('');
    try {
      if (editing) {
        await updateRopaActivity(home, editing.id, { ...form, _version: editing.version });
        showToast({ title: 'Processing activity updated', message: form.purpose });
      } else {
        await createRopaActivity(home, form);
        showToast({ title: 'Processing activity added', message: form.purpose });
      }
      closeModal(); load();
    } catch (e) { setFormError(e.message || 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!await confirm('Archive this processing activity?')) return;
    try {
      await deleteRopaActivity(home, id);
      showToast({ title: 'Processing activity archived' });
      load();
    }
    catch (e) { setError(e.message); }
  }

  const stats = useMemo(() => ({
    total, active: items.filter(i => i.status === 'active').length,
    special: items.filter(i => i.special_category).length,
    review: items.filter(i => i.status === 'under_review').length,
  }), [items, total]);

  if (!home) {
    return (
      <div className={PAGE.container}>
        <EmptyState
          title="Select a home to review processing activities"
          description="Choose a home to view the record of processing activities."
        />
      </div>
    );
  }

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading processing activities..." /></div>;

  if (error && items.length === 0) {
    return (
      <div className={PAGE.container}>
        <ErrorState title="Processing register needs attention" message={error} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Record of Processing Activities</h1>
          <p className="text-sm text-gray-500">Article 30 UK GDPR — documented processing activities</p>
        </div>
        {canEdit && <button className={BTN.primary} onClick={openNew}>+ Add Activity</button>}
      </div>

      {error && <ErrorState title="Processing activity needs attention" message={error} onRetry={() => void load()} className="mb-4" />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className={CARD.padded}><p className="text-xs text-gray-500">Total Activities</p><p className="text-2xl font-bold">{stats.total}</p></div>
        <div className={CARD.padded}><p className="text-xs text-gray-500">Active</p><p className="text-2xl font-bold text-green-600">{stats.active}</p></div>
        <div className={CARD.padded}><p className="text-xs text-gray-500">Special Category</p><p className="text-2xl font-bold text-purple-600">{stats.special}</p></div>
        <div className={CARD.padded}><p className="text-xs text-gray-500">Under Review</p><p className="text-2xl font-bold text-amber-600">{stats.review}</p></div>
      </div>

      <div className="mb-4">
        <select className={`${INPUT.select} w-40`} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="under_review">Under Review</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <div className={CARD.flush}>
        {items.length === 0 ? (
          <EmptyState
            title="No processing activities recorded"
            description={canEdit
              ? 'Start the first processing record so legal basis, data categories, and evidence are all documented here.'
              : 'No processing activities are recorded for this home yet.'}
            actionLabel={canEdit ? 'Add activity' : undefined}
            onAction={canEdit ? openNew : undefined}
          />
        ) : (
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th className={TABLE.th}>Purpose</th>
                  <th className={TABLE.th}>Legal Basis</th>
                  <th className={TABLE.th}>Individuals</th>
                  <th className={TABLE.th}>Data Categories</th>
                  <th className={TABLE.th}>Status</th>
                  {canEdit && <th className={TABLE.th}></th>}
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className={TABLE.tr}>
                    <td className={TABLE.td}>
                      <div className="font-medium">{item.purpose}</div>
                      {item.special_category && <span className={`${BADGE.purple} text-[10px] mt-0.5`}>Special Category</span>}
                      {item.dpia_required && <span className={`${BADGE.amber} text-[10px] mt-0.5 ml-1`}>DPIA Required</span>}
                    </td>
                    <td className={TABLE.td}><span className={BADGE.blue}>{LEGAL_BASES.find(b => b.id === item.legal_basis)?.label || item.legal_basis}</span></td>
                    <td className={TABLE.td}><span className="text-sm">{item.categories_of_individuals}</span></td>
                    <td className={TABLE.td}><span className="text-sm">{item.categories_of_data}</span></td>
                    <td className={TABLE.td}><span className={BADGE[STATUS_BADGES[item.status] || 'gray']}>{item.status?.replace(/_/g, ' ')}</span></td>
                    {canEdit && (
                      <td className={TABLE.td}>
                        <div className="flex gap-1">
                          <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => openEdit(item)}>Edit</button>
                          <button className={`${BTN.ghost} ${BTN.xs}`} onClick={() => handleDelete(item.id)}>Archive</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Processing Activity' : 'Add Processing Activity'} size="xl">
        <div className="space-y-4">
          <InlineNotice>
            <p>Document the legal basis, data categories, recipients, and safeguards together so the processing record stays inspection-ready.</p>
          </InlineNotice>
          {formError && <ErrorState title="Processing activity needs attention" message={formError} />}
          <div>
            <label className={INPUT.label}>Purpose of Processing *</label>
            <input className={INPUT.base} value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} placeholder="e.g. Staff payroll processing" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Legal Basis *</label>
              <select className={INPUT.select} value={form.legal_basis} onChange={e => setForm({ ...form, legal_basis: e.target.value })}>
                {LEGAL_BASES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            </div>
            <div>
              <label className={INPUT.label}>Status</label>
              <select className={INPUT.select} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="under_review">Under Review</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Categories of Individuals *</label>
              <input className={INPUT.base} value={form.categories_of_individuals} onChange={e => setForm({ ...form, categories_of_individuals: e.target.value })} placeholder="e.g. Staff, residents, next-of-kin" />
            </div>
            <div>
              <label className={INPUT.label}>Categories of Data *</label>
              <input className={INPUT.base} value={form.categories_of_data} onChange={e => setForm({ ...form, categories_of_data: e.target.value })} placeholder="e.g. Contact, health, financial" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Recipients</label>
              <input className={INPUT.base} value={form.categories_of_recipients} onChange={e => setForm({ ...form, categories_of_recipients: e.target.value })} placeholder="e.g. HMRC, CQC, ICO" />
            </div>
            <div>
              <label className={INPUT.label}>Retention Period</label>
              <input className={INPUT.base} value={form.retention_period} onChange={e => setForm({ ...form, retention_period: e.target.value })} placeholder="e.g. 7 years after leaving" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Data Source</label>
              <input className={INPUT.base} value={form.data_source} onChange={e => setForm({ ...form, data_source: e.target.value })} placeholder="e.g. Direct from individual" />
            </div>
            <div>
              <label className={INPUT.label}>System / Asset</label>
              <input className={INPUT.base} value={form.system_or_asset} onChange={e => setForm({ ...form, system_or_asset: e.target.value })} placeholder="e.g. Panama Staffing" />
            </div>
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.special_category} onChange={e => setForm({ ...form, special_category: e.target.checked })} className="rounded border-gray-300" />
              <span className="text-sm">Special Category Data (Art 9)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.international_transfers} onChange={e => setForm({ ...form, international_transfers: e.target.checked })} className="rounded border-gray-300" />
              <span className="text-sm">International Transfers</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.dpia_required} onChange={e => setForm({ ...form, dpia_required: e.target.checked })} className="rounded border-gray-300" />
              <span className="text-sm">DPIA Required</span>
            </label>
          </div>
          <div>
            <label className={INPUT.label}>Notes</label>
            <textarea className={INPUT.base} rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <FileAttachments
            caseType="ropa"
            caseId={editing?.id}
            readOnly={!canEdit}
            title="ROPA Evidence"
            emptyText="No processing activity evidence uploaded yet."
            saveFirstText="Save this processing activity first, then attach retention schedules, transfer safeguards, and supporting documents."
            getFiles={getRecordAttachments}
            uploadFile={uploadRecordAttachment}
            deleteFile={deleteRecordAttachment}
            downloadFile={downloadRecordAttachment}
          />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className={BTN.secondary} onClick={closeModal}>Cancel</button>
          <button className={BTN.primary} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</button>
        </div>
      </Modal>
      {ConfirmDialog}
    </div>
  );
}
