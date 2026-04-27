import { useCallback, useEffect, useId, useMemo, useState } from 'react';
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
  completeAuditTask,
  createAuditTask,
  deleteAuditTask,
  generateAuditTasks,
  getAuditTasks,
  updateAuditTask,
} from '../lib/api.js';

const EMPTY_TASK = {
  template_key: '',
  title: '',
  category: 'governance',
  frequency: 'ad_hoc',
  period_start: '',
  period_end: '',
  due_date: '',
  owner_user_id: '',
  status: 'open',
  evidence_required: true,
  evidence_notes: '',
};

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'annual', 'ad_hoc'];
const STATUSES = ['open', 'completed', 'verified', 'cancelled'];
const CATEGORIES = ['governance', 'medication', 'infection_control', 'health_safety', 'care_records', 'environment', 'staffing'];

function titleCase(value) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function statusBadge(status) {
  if (status === 'verified') return BADGE.green;
  if (status === 'completed') return BADGE.blue;
  if (status === 'cancelled') return BADGE.gray;
  return BADGE.amber;
}

function taskPayload(form) {
  return {
    ...form,
    template_key: form.template_key || null,
    period_start: form.period_start || null,
    period_end: form.period_end || null,
    owner_user_id: form.owner_user_id ? Number(form.owner_user_id) : null,
    evidence_notes: form.evidence_notes || null,
    _version: form._version,
  };
}

function TaskModal({ isOpen, task, form, setForm, saveError, canEdit, onClose, onSave, onDelete }) {
  const titleId = useId();
  const categoryId = useId();
  const frequencyId = useId();
  const dueDateId = useId();
  const periodStartId = useId();
  const periodEndId = useId();
  const ownerId = useId();
  const statusId = useId();
  const templateId = useId();
  const evidenceRequiredId = useId();
  const evidenceNotesId = useId();

  const setField = (key, value) => setForm(current => ({ ...current, [key]: value }));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={task ? 'Edit Audit Task' : 'New Audit Task'} size="wide">
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
          <label htmlFor={categoryId} className={INPUT.label}>Category</label>
          <select id={categoryId} className={INPUT.select} value={form.category} onChange={e => setField('category', e.target.value)} disabled={!canEdit}>
            {CATEGORIES.map(category => <option key={category} value={category}>{titleCase(category)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={frequencyId} className={INPUT.label}>Frequency</label>
          <select id={frequencyId} className={INPUT.select} value={form.frequency} onChange={e => setField('frequency', e.target.value)} disabled={!canEdit}>
            {FREQUENCIES.map(frequency => <option key={frequency} value={frequency}>{titleCase(frequency)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={periodStartId} className={INPUT.label}>Period start</label>
          <input id={periodStartId} type="date" className={INPUT.base} value={form.period_start} onChange={e => setField('period_start', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label htmlFor={periodEndId} className={INPUT.label}>Period end</label>
          <input id={periodEndId} type="date" className={INPUT.base} value={form.period_end} onChange={e => setField('period_end', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label htmlFor={ownerId} className={INPUT.label}>Owner user ID</label>
          <input id={ownerId} type="number" min="1" inputMode="numeric" className={INPUT.base} value={form.owner_user_id} onChange={e => setField('owner_user_id', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label htmlFor={statusId} className={INPUT.label}>Status</label>
          <select id={statusId} className={INPUT.select} value={form.status} onChange={e => setField('status', e.target.value)} disabled={!canEdit}>
            {STATUSES.map(status => <option key={status} value={status}>{titleCase(status)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={templateId} className={INPUT.label}>Template key</label>
          <input id={templateId} className={INPUT.base} value={form.template_key} onChange={e => setField('template_key', e.target.value)} disabled={!canEdit} />
        </div>
        <div className="flex items-center gap-3 pt-7">
          <input id={evidenceRequiredId} type="checkbox" className="h-4 w-4 rounded border-[var(--line-2)] text-[var(--accent)] focus:ring-[var(--accent)]" checked={form.evidence_required} onChange={e => setField('evidence_required', e.target.checked)} disabled={!canEdit} />
          <label htmlFor={evidenceRequiredId} className="text-sm font-medium text-[var(--ink-2)]">Evidence required</label>
        </div>
        <div className="md:col-span-2">
          <label htmlFor={evidenceNotesId} className={INPUT.label}>Evidence notes</label>
          <textarea id={evidenceNotesId} className={`${INPUT.base} min-h-24`} value={form.evidence_notes} onChange={e => setField('evidence_notes', e.target.value)} disabled={!canEdit} />
        </div>
      </div>
      <div className={MODAL.footer}>
        {task && canEdit && <button type="button" className={`${BTN.danger} mr-auto`} onClick={onDelete}>Delete</button>}
        <button type="button" className={BTN.secondary} onClick={onClose}>Close</button>
        {canEdit && <button type="button" className={BTN.primary} onClick={onSave} disabled={!form.title || !form.due_date}>Save</button>}
      </div>
    </Modal>
  );
}

export default function AuditCalendar() {
  const filterStatusId = useId();
  const filterCategoryId = useId();
  const { activeHome, canWrite } = useData();
  const canEdit = canWrite('governance');
  const { confirm, ConfirmDialog } = useConfirm();
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const [tasks, setTasks] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ status: '', category: '' });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_TASK });
  useDirtyGuard(modalOpen);

  const load = useCallback(async () => {
    if (!activeHome) return;
    setLoading(true);
    try {
      const result = await getAuditTasks(activeHome, filters);
      setTasks(Array.isArray(result.tasks) ? result.tasks : []);
      setTotal(result._total || 0);
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load audit tasks');
    } finally {
      setLoading(false);
    }
  }, [activeHome, filters]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return {
      open: tasks.filter(task => task.status === 'open').length,
      overdue: tasks.filter(task => task.status === 'open' && task.due_date < today).length,
      completed: tasks.filter(task => task.status === 'completed' || task.status === 'verified').length,
    };
  }, [tasks]);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_TASK });
    setSaveError(null);
    setModalOpen(true);
  }

  function openEdit(task) {
    setEditing(task);
    setForm({
      ...EMPTY_TASK,
      ...task,
      template_key: task.template_key || '',
      period_start: task.period_start || '',
      period_end: task.period_end || '',
      owner_user_id: task.owner_user_id || '',
      evidence_notes: task.evidence_notes || '',
      evidence_required: Boolean(task.evidence_required),
      _version: task.version,
    });
    setSaveError(null);
    setModalOpen(true);
  }

  async function saveTask() {
    try {
      if (editing) await updateAuditTask(activeHome, editing.id, taskPayload(form));
      else await createAuditTask(activeHome, taskPayload(form));
      setModalOpen(false);
      showNotice(editing ? 'Audit task updated.' : 'Audit task created.');
      await load();
    } catch (e) {
      setSaveError(e.message || 'Unable to save audit task');
    }
  }

  async function removeTask() {
    if (!editing) return;
    const ok = await confirm({ title: 'Delete Audit Task', message: 'Delete this audit task?', confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await deleteAuditTask(activeHome, editing.id);
      setModalOpen(false);
      showNotice('Audit task deleted.');
      await load();
    } catch (e) {
      setSaveError(e.message || 'Unable to delete audit task');
    }
  }

  async function completeTask(task) {
    try {
      await completeAuditTask(activeHome, task.id, { _version: task.version });
      showNotice('Audit task completed.');
      await load();
    } catch (e) {
      setError(e.message || 'Unable to complete audit task');
    }
  }

  async function generateRecurringTasks() {
    try {
      setGenerating(true);
      const result = await generateAuditTasks(activeHome);
      showNotice(`${result.inserted || 0} recurring audit task${result.inserted === 1 ? '' : 's'} generated.`);
      await load();
    } catch (e) {
      setError(e.message || 'Unable to generate recurring audit tasks');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Audit Calendar</h1>
          <p className={PAGE.subtitle}>Recurring checks, due dates and sign-off evidence.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN.secondary} onClick={load}>Refresh</button>
          {canEdit && <button type="button" className={BTN.secondary} onClick={generateRecurringTasks} disabled={generating}>{generating ? 'Generating...' : 'Generate Recurring'}</button>}
          {canEdit && <button type="button" className={BTN.primary} onClick={openNew}>New Task</button>}
        </div>
      </div>

      {notice && <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">{notice.content}</InlineNotice>}
      {error && <ErrorState title="Audit calendar unavailable" message={error} onRetry={load} className="mb-4" />}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className={CARD.padded}><p className="text-sm text-[var(--ink-3)]">Open</p><p className="mt-2 text-2xl font-semibold text-[var(--ink)]">{stats.open}</p></div>
        <div className={CARD.padded}><p className="text-sm text-[var(--ink-3)]">Overdue</p><p className="mt-2 text-2xl font-semibold text-[var(--alert)]">{stats.overdue}</p></div>
        <div className={CARD.padded}><p className="text-sm text-[var(--ink-3)]">Completed</p><p className="mt-2 text-2xl font-semibold text-[var(--ok)]">{stats.completed}</p></div>
      </div>

      <div className={`${CARD.padded} mb-4`}>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label htmlFor={filterStatusId} className={INPUT.label}>Status</label>
            <select id={filterStatusId} className={INPUT.select} value={filters.status} onChange={e => setFilters(current => ({ ...current, status: e.target.value }))}>
              <option value="">All statuses</option>
              {STATUSES.map(status => <option key={status} value={status}>{titleCase(status)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={filterCategoryId} className={INPUT.label}>Category</label>
            <select id={filterCategoryId} className={INPUT.select} value={filters.category} onChange={e => setFilters(current => ({ ...current, category: e.target.value }))}>
              <option value="">All categories</option>
              {CATEGORIES.map(category => <option key={category} value={category}>{titleCase(category)}</option>)}
            </select>
          </div>
          <div className="flex items-end text-sm text-[var(--ink-3)]">{total} tasks</div>
        </div>
      </div>

      <div className={CARD.flush}>
        {loading ? <LoadingState message="Loading audit tasks..." /> : (
          tasks.length === 0 ? <EmptyState title="No audit tasks" description="Scheduled checks will appear here." /> : (
            <div className={TABLE.wrapper}>
              <table className={TABLE.table}>
                <thead className={TABLE.thead}>
                  <tr>
                    <th className={TABLE.th}>Task</th>
                    <th className={TABLE.th}>Category</th>
                    <th className={TABLE.th}>Frequency</th>
                    <th className={TABLE.th}>Due</th>
                    <th className={TABLE.th}>Status</th>
                    <th className={TABLE.th}>Evidence</th>
                    <th className={TABLE.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map(task => (
                    <tr key={task.id} className={TABLE.tr}>
                      <td className={TABLE.td}><button type="button" className="text-left font-semibold text-[var(--ink)] hover:text-[var(--accent)]" onClick={() => openEdit(task)}>{task.title}</button></td>
                      <td className={TABLE.td}>{titleCase(task.category)}</td>
                      <td className={TABLE.td}>{titleCase(task.frequency)}</td>
                      <td className={TABLE.td}>{task.due_date}</td>
                      <td className={TABLE.td}><span className={statusBadge(task.status)}>{titleCase(task.status)}</span></td>
                      <td className={TABLE.td}>{task.evidence_required ? 'Required' : 'Optional'}</td>
                      <td className={`${TABLE.td} whitespace-nowrap`}>
                        {canEdit && task.status === 'open' && <button type="button" className={`${BTN.success} ${BTN.xs} mr-2`} onClick={() => completeTask(task)}>Complete</button>}
                        <button type="button" className={`${BTN.ghost} ${BTN.xs}`} onClick={() => openEdit(task)}>Open</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      <TaskModal
        isOpen={modalOpen}
        task={editing}
        form={form}
        setForm={setForm}
        saveError={saveError}
        canEdit={canEdit}
        onClose={() => setModalOpen(false)}
        onSave={saveTask}
        onDelete={removeTask}
      />
      <ConfirmDialog />
    </div>
  );
}
