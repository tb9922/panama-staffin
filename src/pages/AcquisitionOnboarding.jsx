import { useCallback, useEffect, useMemo, useState } from 'react';
import { BADGE, BTN, CARD, INPUT, MODAL, PAGE, TABLE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { useConfirm } from '../hooks/useConfirm.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import useTransientNotice from '../hooks/useTransientNotice.js';
import { useData } from '../contexts/DataContext.jsx';
import {
  createAcquisitionItem,
  deleteAcquisitionItem,
  getAcquisitionChecklist,
  initializeAcquisitionChecklist,
  updateAcquisitionItem,
} from '../lib/acquisitionApi.js';

const ITEM_DEFINITIONS = [
  { item_key: 'staff_import', title: 'Staff import' },
  { item_key: 'resident_import', title: 'Resident import' },
  { item_key: 'training_import', title: 'Training import' },
  { item_key: 'rota_baseline', title: 'Rota baseline' },
  { item_key: 'documents', title: 'Documents' },
  { item_key: 'users', title: 'Users' },
  { item_key: 'audit_templates', title: 'Audit templates' },
  { item_key: 'go_live_signoff', title: 'Go-live signoff' },
];

const STATUS_OPTIONS = ['not_started', 'in_progress', 'blocked', 'ready', 'complete'];

const EMPTY_FORM = {
  item_key: '',
  title: '',
  description: '',
  status: 'not_started',
  owner_name: '',
  due_date: '',
  expected_count: 0,
  imported_count: 0,
  issue_count: 0,
  evidence_ref: '',
  notes: '',
  blockers: '',
};

function titleCase(value) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function badgeForStatus(status) {
  if (status === 'complete') return BADGE.green;
  if (status === 'ready') return BADGE.blue;
  if (status === 'blocked') return BADGE.red;
  if (status === 'in_progress') return BADGE.amber;
  return BADGE.gray;
}

function textOrDash(value) {
  return value ? value : '-';
}

function toForm(item) {
  return {
    ...EMPTY_FORM,
    ...item,
    description: item?.description || '',
    owner_name: item?.owner_name || '',
    due_date: item?.due_date || '',
    evidence_ref: item?.evidence_ref || '',
    notes: item?.notes || '',
    blockers: item?.blockers || '',
    expected_count: item?.expected_count ?? 0,
    imported_count: item?.imported_count ?? 0,
    issue_count: item?.issue_count ?? 0,
    _version: item?.version,
  };
}

function toPayload(form, editing) {
  return {
    ...(editing ? {} : { item_key: form.item_key }),
    title: form.title || undefined,
    description: form.description || null,
    status: form.status,
    owner_name: form.owner_name || null,
    due_date: form.due_date || null,
    expected_count: Number(form.expected_count) || 0,
    imported_count: Number(form.imported_count) || 0,
    issue_count: Number(form.issue_count) || 0,
    evidence_ref: form.evidence_ref || null,
    notes: form.notes || null,
    blockers: form.blockers || null,
    ...(editing ? { _version: form._version } : {}),
  };
}

function ItemModal({
  item,
  form,
  setForm,
  missingItems,
  canEdit,
  saveError,
  onClose,
  onSave,
  onDelete,
}) {
  const editing = Boolean(item);
  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  return (
    <Modal isOpen={true} onClose={onClose} title={editing ? 'Edit Acquisition Item' : 'Add Acquisition Item'} size="wide">
      {saveError && <InlineNotice variant="error" className="mb-4">{saveError}</InlineNotice>}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className={INPUT.label} htmlFor="acq-item-key">Item</label>
          {editing ? (
            <input id="acq-item-key" className={INPUT.base} value={ITEM_DEFINITIONS.find(def => def.item_key === form.item_key)?.title || form.item_key} disabled />
          ) : (
            <select id="acq-item-key" className={INPUT.select} value={form.item_key} onChange={e => setField('item_key', e.target.value)} disabled={!canEdit}>
              <option value="">Select item</option>
              {missingItems.map(def => <option key={def.item_key} value={def.item_key}>{def.title}</option>)}
            </select>
          )}
        </div>
        <div>
          <label className={INPUT.label} htmlFor="acq-status">Status</label>
          <select id="acq-status" className={INPUT.select} value={form.status} onChange={e => setField('status', e.target.value)} disabled={!canEdit}>
            {STATUS_OPTIONS.map(status => <option key={status} value={status}>{titleCase(status)}</option>)}
          </select>
        </div>
        <div>
          <label className={INPUT.label} htmlFor="acq-title">Title</label>
          <input id="acq-title" className={INPUT.base} value={form.title} onChange={e => setField('title', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label className={INPUT.label} htmlFor="acq-owner">Owner</label>
          <input id="acq-owner" className={INPUT.base} value={form.owner_name} onChange={e => setField('owner_name', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label className={INPUT.label} htmlFor="acq-due-date">Due date</label>
          <input id="acq-due-date" type="date" className={INPUT.base} value={form.due_date} onChange={e => setField('due_date', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label className={INPUT.label} htmlFor="acq-evidence-ref">Evidence ref</label>
          <input id="acq-evidence-ref" className={INPUT.base} value={form.evidence_ref} onChange={e => setField('evidence_ref', e.target.value)} disabled={!canEdit} />
        </div>
        <div className="grid grid-cols-3 gap-3 md:col-span-2">
          <div>
            <label className={INPUT.label} htmlFor="acq-expected">Expected</label>
            <input id="acq-expected" type="number" min="0" className={INPUT.base} value={form.expected_count} onChange={e => setField('expected_count', e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <label className={INPUT.label} htmlFor="acq-imported">Imported</label>
            <input id="acq-imported" type="number" min="0" className={INPUT.base} value={form.imported_count} onChange={e => setField('imported_count', e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <label className={INPUT.label} htmlFor="acq-issues">Issues</label>
            <input id="acq-issues" type="number" min="0" className={INPUT.base} value={form.issue_count} onChange={e => setField('issue_count', e.target.value)} disabled={!canEdit} />
          </div>
        </div>
        <div className="md:col-span-2">
          <label className={INPUT.label} htmlFor="acq-description">Description</label>
          <textarea id="acq-description" className={`${INPUT.base} min-h-20`} value={form.description} onChange={e => setField('description', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label className={INPUT.label} htmlFor="acq-notes">Notes</label>
          <textarea id="acq-notes" className={`${INPUT.base} min-h-24`} value={form.notes} onChange={e => setField('notes', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label className={INPUT.label} htmlFor="acq-blockers">Blockers</label>
          <textarea id="acq-blockers" className={`${INPUT.base} min-h-24`} value={form.blockers} onChange={e => setField('blockers', e.target.value)} disabled={!canEdit} />
        </div>
      </div>
      <div className={MODAL.footer}>
        {editing && canEdit && (
          <button type="button" className={`${BTN.danger} mr-auto`} onClick={onDelete}>Delete</button>
        )}
        <button type="button" className={BTN.secondary} onClick={onClose}>Close</button>
        {canEdit && (
          <button type="button" className={BTN.primary} onClick={onSave} disabled={!editing && !form.item_key}>Save</button>
        )}
      </div>
    </Modal>
  );
}

export default function AcquisitionOnboarding() {
  const { activeHome, canWrite } = useData();
  const canEdit = canWrite('governance');
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const { confirm, ConfirmDialog } = useConfirm();
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  useDirtyGuard(modalOpen);

  const load = useCallback(async () => {
    if (!activeHome) return;
    setLoading(true);
    try {
      const result = await getAcquisitionChecklist(activeHome, filter ? { status: filter } : {});
      setItems(Array.isArray(result.items) ? result.items : []);
      setSummary(result.summary || null);
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load acquisition onboarding');
    } finally {
      setLoading(false);
    }
  }, [activeHome, filter]);

  useEffect(() => { load(); }, [load]);

  const missingItems = useMemo(() => {
    const present = new Set(items.map(item => item.item_key));
    return ITEM_DEFINITIONS.filter(def => !present.has(def.item_key));
  }, [items]);

  const localSummary = useMemo(() => {
    if (summary) return summary;
    const total = items.length;
    const ready = items.filter(item => ['ready', 'complete'].includes(item.status)).length;
    const blocked = items.filter(item => item.status === 'blocked').length;
    const issueCount = items.reduce((sum, item) => sum + (item.issue_count || 0), 0);
    return { total, ready, blocked, issue_count: issueCount, readiness_percent: total ? Math.round((ready / total) * 100) : 0 };
  }, [items, summary]);

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, item_key: missingItems[0]?.item_key || '' });
    setSaveError(null);
    setModalOpen(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm(toForm(item));
    setSaveError(null);
    setModalOpen(true);
  }

  async function handleInitialize() {
    if (!activeHome) return;
    setSaving(true);
    try {
      await initializeAcquisitionChecklist(activeHome);
      showNotice('Checklist initialized.');
      await load();
    } catch (e) {
      setError(e.message || 'Failed to initialize checklist');
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!activeHome) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editing) {
        await updateAcquisitionItem(activeHome, editing.id, toPayload(form, true));
        showNotice('Checklist item updated.');
      } else {
        await createAcquisitionItem(activeHome, toPayload(form, false));
        showNotice('Checklist item added.');
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setSaveError(e.message || 'Failed to save checklist item');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editing || !activeHome) return;
    if (!await confirm('Delete this acquisition checklist item?')) return;
    setSaving(true);
    try {
      await deleteAcquisitionItem(activeHome, editing.id, { _version: editing.version });
      setModalOpen(false);
      showNotice('Checklist item deleted.', { variant: 'warning' });
      await load();
    } catch (e) {
      setSaveError(e.message || 'Failed to delete checklist item');
    } finally {
      setSaving(false);
    }
  }

  async function quickStatus(item, status) {
    if (!activeHome) return;
    try {
      await updateAcquisitionItem(activeHome, item.id, { status, _version: item.version });
      showNotice(`Marked ${titleCase(status)}.`);
      await load();
    } catch (e) {
      setError(e.message || 'Failed to update status');
    }
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Acquisition Onboarding</h1>
          <p className={PAGE.subtitle}>Import readiness, access setup and go-live control for the selected home.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && items.length === 0 && (
            <button type="button" className={BTN.primary} onClick={handleInitialize} disabled={saving}>Initialize Checklist</button>
          )}
          {canEdit && missingItems.length > 0 && (
            <button type="button" className={BTN.secondary} onClick={openAdd}>Add Item</button>
          )}
        </div>
      </div>

      {notice && <InlineNotice variant={notice.variant || 'success'} onDismiss={clearNotice} className="mb-4">{notice.content}</InlineNotice>}
      {error && <ErrorState message={error} onRetry={load} className="mb-4" />}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={CARD.padded}>
          <p className="text-sm text-[var(--ink-3)]">Readiness</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--ink)]">{localSummary.readiness_percent || 0}%</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-sm text-[var(--ink-3)]">Ready</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--ok)]">{localSummary.ready || 0}/{localSummary.total || 0}</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-sm text-[var(--ink-3)]">Blocked</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--alert)]">{localSummary.blocked || 0}</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-sm text-[var(--ink-3)]">Issues</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--warn)]">{localSummary.issue_count || 0}</p>
        </div>
      </div>

      <div className={`${CARD.padded} mb-4`}>
        <select className={`${INPUT.select} max-w-xs`} value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map(status => <option key={status} value={status}>{titleCase(status)}</option>)}
        </select>
      </div>

      <div className={CARD.flush}>
        {loading ? <LoadingState message="Loading acquisition onboarding..." /> : (
          items.length === 0 ? (
            <EmptyState
              title="No acquisition checklist yet"
              description={canEdit ? 'Initialize the default checklist for this home.' : 'No checklist has been created for this home.'}
              actionLabel={canEdit ? 'Initialize Checklist' : undefined}
              onAction={canEdit ? handleInitialize : undefined}
            />
          ) : (
            <div className={TABLE.wrapper}>
              <table className={TABLE.table}>
                <thead className={TABLE.thead}>
                  <tr>
                    <th className={TABLE.th}>Item</th>
                    <th className={TABLE.th}>Status</th>
                    <th className={TABLE.th}>Counts</th>
                    <th className={TABLE.th}>Owner</th>
                    <th className={TABLE.th}>Due</th>
                    <th className={TABLE.th}>Evidence</th>
                    <th className={TABLE.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} className={TABLE.tr}>
                      <td className={TABLE.td}>
                        <button type="button" className="text-left font-medium text-[var(--ink)] hover:text-[var(--accent)]" onClick={() => openEdit(item)}>
                          {item.title}
                        </button>
                        {item.blockers && <p className="mt-1 text-xs font-medium text-[var(--alert)]">Blocked: {item.blockers}</p>}
                      </td>
                      <td className={TABLE.td}><span className={badgeForStatus(item.status)}>{titleCase(item.status)}</span></td>
                      <td className={TABLE.td}>{item.imported_count || 0}/{item.expected_count || 0} <span className="text-[var(--ink-4)]">({item.issue_count || 0})</span></td>
                      <td className={TABLE.td}>{textOrDash(item.owner_name)}</td>
                      <td className={TABLE.td}>{textOrDash(item.due_date)}</td>
                      <td className={TABLE.td}>{textOrDash(item.evidence_ref)}</td>
                      <td className={`${TABLE.td} whitespace-nowrap`}>
                        <div className="flex flex-wrap gap-2">
                          {canEdit && !['ready', 'complete'].includes(item.status) && (
                            <button type="button" className={`${BTN.success} ${BTN.xs}`} onClick={() => quickStatus(item, 'ready')}>Ready</button>
                          )}
                          {canEdit && item.item_key === 'go_live_signoff' && item.status !== 'complete' && (
                            <button type="button" className={`${BTN.primary} ${BTN.xs}`} onClick={() => quickStatus(item, 'complete')}>Sign Off</button>
                          )}
                          <button type="button" className={`${BTN.ghost} ${BTN.xs}`} onClick={() => openEdit(item)}>Open</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {modalOpen && (
        <ItemModal
          item={editing}
          form={form}
          setForm={setForm}
          missingItems={missingItems}
          canEdit={canEdit && !saving}
          saveError={saveError}
          onClose={() => setModalOpen(false)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
      {ConfirmDialog}
    </div>
  );
}
