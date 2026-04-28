import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { BADGE, BTN, CARD, INPUT, MODAL, PAGE, TABLE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import useTransientNotice from '../hooks/useTransientNotice.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import { useData } from '../contexts/DataContext.jsx';
import {
  completeActionItem,
  createActionItem,
  deleteActionItem,
  getActionItems,
  getCurrentHome,
  updateActionItem,
  verifyActionItem,
} from '../lib/api.js';
import {
  ACTION_ITEM_CATEGORIES,
  ACTION_ITEM_PRIORITIES,
  ACTION_ITEM_SOURCE_TYPES,
  ACTION_ITEM_STATUSES,
} from '../../lib/actionItems.js';

const EMPTY_FORM = {
  source_type: 'standalone',
  source_id: '',
  source_action_key: '',
  title: '',
  description: '',
  category: 'operational',
  priority: 'medium',
  owner_name: '',
  owner_role: '',
  due_date: '',
  status: 'open',
  evidence_required: false,
  evidence_notes: '',
};

const LABELS = {
  standalone: 'Standalone',
  incident: 'Incident',
  ipc_audit: 'IPC',
  risk: 'Risk',
  complaint: 'Complaint',
  complaint_survey: 'Survey',
  maintenance: 'Maintenance',
  fire_drill: 'Fire drill',
  supervision: 'Supervision',
  appraisal: 'Appraisal',
  hr_grievance: 'Grievance',
  cqc_observation: 'CQC observation',
  cqc_narrative: 'CQC narrative',
  reflective_practice: 'Reflective practice',
};

const titleCase = value => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function badgeForPriority(priority) {
  if (priority === 'critical') return BADGE.red;
  if (priority === 'high') return BADGE.orange;
  if (priority === 'medium') return BADGE.amber;
  return BADGE.gray;
}

function badgeForStatus(status) {
  if (status === 'verified') return BADGE.green;
  if (status === 'completed') return BADGE.blue;
  if (status === 'cancelled') return BADGE.gray;
  if (status === 'blocked') return BADGE.red;
  if (status === 'in_progress') return BADGE.purple;
  return BADGE.amber;
}

function badgeForEscalation(level) {
  if (level >= 4) return BADGE.red;
  if (level >= 3) return BADGE.orange;
  if (level >= 2) return BADGE.amber;
  if (level >= 1) return BADGE.blue;
  return BADGE.gray;
}

function ActionItemModal({ isOpen, item, form, setForm, saveError, onClose, onSave, onDelete, canEdit }) {
  const sourceTypeId = useId();
  const sourceId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const categoryId = useId();
  const priorityId = useId();
  const ownerNameId = useId();
  const ownerRoleId = useId();
  const dueDateId = useId();
  const statusId = useId();
  const evidenceRequiredId = useId();
  const evidenceNotesId = useId();

  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={item ? 'Edit Action' : 'New Action'} size="wide">
      {saveError && <InlineNotice variant="error" className="mb-4">{saveError}</InlineNotice>}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor={titleId} className={INPUT.label}>Title</label>
          <input id={titleId} className={INPUT.base} value={form.title} onChange={e => setField('title', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label htmlFor={dueDateId} className={INPUT.label}>Due date</label>
          <input id={dueDateId} type="date" className={INPUT.base} value={form.due_date} onChange={e => setField('due_date', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label htmlFor={priorityId} className={INPUT.label}>Priority</label>
          <select id={priorityId} className={INPUT.select} value={form.priority} onChange={e => setField('priority', e.target.value)} disabled={!canEdit}>
            {ACTION_ITEM_PRIORITIES.map(priority => <option key={priority} value={priority}>{titleCase(priority)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={statusId} className={INPUT.label}>Status</label>
          <select id={statusId} className={INPUT.select} value={form.status} onChange={e => setField('status', e.target.value)} disabled={!canEdit}>
            {ACTION_ITEM_STATUSES.map(status => <option key={status} value={status}>{titleCase(status)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={categoryId} className={INPUT.label}>Category</label>
          <select id={categoryId} className={INPUT.select} value={form.category} onChange={e => setField('category', e.target.value)} disabled={!canEdit}>
            {ACTION_ITEM_CATEGORIES.map(category => <option key={category} value={category}>{titleCase(category)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={sourceTypeId} className={INPUT.label}>Source</label>
          <select id={sourceTypeId} className={INPUT.select} value={form.source_type} onChange={e => setField('source_type', e.target.value)} disabled={!canEdit || item?.source_type !== 'standalone'}>
            {ACTION_ITEM_SOURCE_TYPES.map(source => <option key={source} value={source}>{LABELS[source] || titleCase(source)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={ownerNameId} className={INPUT.label}>Owner</label>
          <input id={ownerNameId} className={INPUT.base} value={form.owner_name} onChange={e => setField('owner_name', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label htmlFor={ownerRoleId} className={INPUT.label}>Owner role</label>
          <input id={ownerRoleId} className={INPUT.base} value={form.owner_role} onChange={e => setField('owner_role', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label htmlFor={sourceId} className={INPUT.label}>Source ID</label>
          <input id={sourceId} className={INPUT.base} value={form.source_id} onChange={e => setField('source_id', e.target.value)} disabled={!canEdit || item?.source_type !== 'standalone'} />
        </div>
        <div className="flex items-center gap-3 pt-7">
          <input id={evidenceRequiredId} type="checkbox" className="h-4 w-4 rounded border-[var(--line-2)] text-[var(--accent)] focus:ring-[var(--accent)]" checked={form.evidence_required} onChange={e => setField('evidence_required', e.target.checked)} disabled={!canEdit} />
          <label htmlFor={evidenceRequiredId} className="text-sm font-medium text-[var(--ink-2)]">Evidence required</label>
        </div>
        <div className="md:col-span-2">
          <label htmlFor={descriptionId} className={INPUT.label}>Description</label>
          <textarea id={descriptionId} className={`${INPUT.base} min-h-24`} value={form.description} onChange={e => setField('description', e.target.value)} disabled={!canEdit} />
        </div>
        <div className="md:col-span-2">
          <label htmlFor={evidenceNotesId} className={INPUT.label}>Evidence notes</label>
          <textarea id={evidenceNotesId} className={`${INPUT.base} min-h-20`} value={form.evidence_notes} onChange={e => setField('evidence_notes', e.target.value)} disabled={!canEdit} />
        </div>
      </div>

      <div className={MODAL.footer}>
        {item && canEdit && (
          <button type="button" className={`${BTN.danger} mr-auto`} onClick={onDelete}>
            Delete
          </button>
        )}
        <button type="button" className={BTN.secondary} onClick={onClose}>Close</button>
        {canEdit && <button type="button" className={BTN.primary} onClick={onSave} disabled={!form.title || !form.due_date}>Save</button>}
      </div>
    </Modal>
  );
}

export default function ManagerActions() {
  const { canWrite } = useData();
  const canEdit = canWrite('governance');
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const { confirm, ConfirmDialog } = useConfirm();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [filters, setFilters] = useState({ status: '', priority: '', source_type: '', overdue: '' });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  useDirtyGuard(modalOpen);

  const home = getCurrentHome();

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const result = await getActionItems(home, filters);
      setItems(Array.isArray(result.actionItems) ? result.actionItems : []);
      setTotal(result._total || 0);
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load manager actions');
    } finally {
      setLoading(false);
    }
  }, [home, filters]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const open = items.filter(item => !['completed', 'verified', 'cancelled'].includes(item.status)).length;
    const overdue = items.filter(item => !['completed', 'verified', 'cancelled'].includes(item.status) && item.due_date && item.due_date < new Date().toISOString().slice(0, 10)).length;
    const escalated = items.filter(item => (item.escalation_level || 0) >= 3).length;
    const completed = items.filter(item => ['completed', 'verified'].includes(item.status)).length;
    return { open, overdue, escalated, completed };
  }, [items]);

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setSaveError(null);
    setModalOpen(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({
      ...EMPTY_FORM,
      ...item,
      source_id: item.source_id || '',
      source_action_key: item.source_action_key || '',
      description: item.description || '',
      owner_name: item.owner_name || '',
      owner_role: item.owner_role || '',
      evidence_notes: item.evidence_notes || '',
      evidence_required: Boolean(item.evidence_required),
      _version: item.version,
    });
    setSaveError(null);
    setModalOpen(true);
  }

  async function handleSave() {
    const payload = {
      ...form,
      source_id: form.source_id || null,
      source_action_key: form.source_action_key || null,
      description: form.description || null,
      owner_name: form.owner_name || null,
      owner_role: form.owner_role || null,
      evidence_notes: form.evidence_notes || null,
      _version: form._version,
    };
    try {
      if (editing) {
        await updateActionItem(home, editing.id, payload);
        showNotice('Action updated.');
      } else {
        await createActionItem(home, payload);
        showNotice('Action created.');
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setSaveError(e.message || 'Failed to save action');
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!await confirm('Delete this manager action?')) return;
    try {
      await deleteActionItem(home, editing.id);
      setModalOpen(false);
      showNotice('Action deleted.', { variant: 'warning' });
      await load();
    } catch (e) {
      setSaveError(e.message || 'Failed to delete action');
    }
  }

  async function handleComplete(item) {
    try {
      await completeActionItem(home, item.id, { _version: item.version });
      showNotice('Action completed.', { variant: 'success' });
      await load();
    } catch (e) {
      setError(e.message || 'Failed to complete action');
    }
  }

  async function handleVerify(item) {
    try {
      await verifyActionItem(home, item.id, { _version: item.version });
      showNotice('Action verified.', { variant: 'success' });
      await load();
    } catch (e) {
      setError(e.message || 'Failed to verify action');
    }
  }

  const setFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value }));

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Manager Actions</h1>
          <p className={PAGE.subtitle}>Owners, deadlines, escalation and verification across the home.</p>
        </div>
        {canEdit && <button type="button" className={BTN.primary} onClick={openAdd}>New Action</button>}
      </div>

      {notice && <InlineNotice variant={notice.variant || 'success'} onDismiss={clearNotice} className="mb-4">{notice.content}</InlineNotice>}
      {error && <ErrorState message={error} onRetry={load} className="mb-4" />}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={CARD.padded}><p className="text-sm text-[var(--ink-3)]">Open</p><p className="mt-1 text-2xl font-semibold text-[var(--ink)]">{stats.open}</p></div>
        <div className={CARD.padded}><p className="text-sm text-[var(--ink-3)]">Overdue</p><p className="mt-1 text-2xl font-semibold text-[var(--alert)]">{stats.overdue}</p></div>
        <div className={CARD.padded}><p className="text-sm text-[var(--ink-3)]">L3+</p><p className="mt-1 text-2xl font-semibold text-[var(--warn)]">{stats.escalated}</p></div>
        <div className={CARD.padded}><p className="text-sm text-[var(--ink-3)]">Complete</p><p className="mt-1 text-2xl font-semibold text-[var(--ok)]">{stats.completed}</p></div>
      </div>

      <div className={`${CARD.padded} mb-4`}>
        <div className="grid gap-3 md:grid-cols-4">
          <select className={INPUT.select} value={filters.status} onChange={e => setFilter('status', e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {ACTION_ITEM_STATUSES.map(status => <option key={status} value={status}>{titleCase(status)}</option>)}
          </select>
          <select className={INPUT.select} value={filters.priority} onChange={e => setFilter('priority', e.target.value)} aria-label="Filter by priority">
            <option value="">All priorities</option>
            {ACTION_ITEM_PRIORITIES.map(priority => <option key={priority} value={priority}>{titleCase(priority)}</option>)}
          </select>
          <select className={INPUT.select} value={filters.source_type} onChange={e => setFilter('source_type', e.target.value)} aria-label="Filter by source">
            <option value="">All sources</option>
            {ACTION_ITEM_SOURCE_TYPES.map(source => <option key={source} value={source}>{LABELS[source] || titleCase(source)}</option>)}
          </select>
          <select className={INPUT.select} value={filters.overdue} onChange={e => setFilter('overdue', e.target.value)} aria-label="Filter overdue actions">
            <option value="">All dates</option>
            <option value="true">Overdue only</option>
          </select>
        </div>
      </div>

      <div className={CARD.flush}>
        {loading ? <LoadingState message="Loading manager actions..." /> : (
          items.length === 0 ? (
            <EmptyState title="No actions found" description={total > 0 ? 'Adjust the filters to see more actions.' : 'Create the first manager action for this home.'} actionLabel={canEdit ? 'New Action' : undefined} onAction={canEdit ? openAdd : undefined} />
          ) : (
            <div className={TABLE.wrapper}>
              <table className={TABLE.table}>
                <thead className={TABLE.thead}>
                  <tr>
                    <th className={TABLE.th}>Action</th>
                    <th className={TABLE.th}>Owner</th>
                    <th className={TABLE.th}>Due</th>
                    <th className={TABLE.th}>Priority</th>
                    <th className={TABLE.th}>Esc</th>
                    <th className={TABLE.th}>Status</th>
                    <th className={TABLE.th}>Source</th>
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
                        {item.evidence_required && <p className="mt-1 text-xs text-[var(--ink-3)]">Evidence required</p>}
                      </td>
                      <td className={TABLE.td}>{item.owner_name || item.owner_role || '-'}</td>
                      <td className={TABLE.td}>{item.due_date || '-'}</td>
                      <td className={TABLE.td}><span className={badgeForPriority(item.priority)}>{titleCase(item.priority)}</span></td>
                      <td className={TABLE.td}><span className={badgeForEscalation(item.escalation_level)}>L{item.escalation_level || 0}</span></td>
                      <td className={TABLE.td}><span className={badgeForStatus(item.status)}>{titleCase(item.status)}</span></td>
                      <td className={TABLE.td}>{LABELS[item.source_type] || titleCase(item.source_type)}</td>
                      <td className={`${TABLE.td} whitespace-nowrap`}>
                        <div className="flex flex-wrap gap-2">
                          {canEdit && !['completed', 'verified', 'cancelled'].includes(item.status) && (
                            <button type="button" className={`${BTN.success} ${BTN.xs}`} onClick={() => handleComplete(item)}>Complete</button>
                          )}
                          {canEdit && item.status === 'completed' && (
                            <button type="button" className={`${BTN.secondary} ${BTN.xs}`} onClick={() => handleVerify(item)}>Verify</button>
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

      <ActionItemModal
        isOpen={modalOpen}
        item={editing}
        form={form}
        setForm={setForm}
        saveError={saveError}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        onDelete={handleDelete}
        canEdit={canEdit}
      />
      {ConfirmDialog}
    </div>
  );
}
