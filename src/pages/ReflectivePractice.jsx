import { useCallback, useEffect, useId, useState } from 'react';
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
  createReflectivePractice,
  deleteReflectivePractice,
  getReflectivePractice,
  updateReflectivePractice,
} from '../lib/api.js';
import { todayLocalISO } from '../lib/localDates.js';

const EMPTY_ENTRY = {
  staff_id: '',
  practice_date: todayLocalISO(),
  facilitator: '',
  category: 'reflective_practice',
  topic: '',
  reflection: '',
  learning_outcome: '',
  wellbeing_notes: '',
  action_summary: '',
};

const CATEGORIES = ['reflective_practice', 'supervision_learning', 'incident_reflection', 'wellbeing', 'qa_review'];

function titleCase(value) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function entryPayload(form) {
  return {
    ...form,
    staff_id: form.staff_id || null,
    facilitator: form.facilitator || null,
    reflection: form.reflection || null,
    learning_outcome: form.learning_outcome || null,
    wellbeing_notes: form.wellbeing_notes || null,
    action_summary: form.action_summary || null,
    _version: form._version,
  };
}

function EntryModal({ isOpen, entry, form, setForm, saveError, canEdit, onClose, onSave, onDelete }) {
  const staffId = useId();
  const dateId = useId();
  const facilitatorId = useId();
  const categoryId = useId();
  const topicId = useId();
  const reflectionId = useId();
  const learningId = useId();
  const wellbeingId = useId();
  const actionId = useId();

  const setField = (key, value) => setForm(current => ({ ...current, [key]: value }));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={entry ? 'Edit Reflection' : 'New Reflection'} size="wide">
      {saveError && <InlineNotice variant="error" className="mb-4">{saveError}</InlineNotice>}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor={topicId} className={INPUT.label}>Topic</label>
          <input id={topicId} className={INPUT.base} value={form.topic} onChange={e => setField('topic', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label htmlFor={dateId} className={INPUT.label}>Date</label>
          <input id={dateId} type="date" className={INPUT.base} value={form.practice_date} onChange={e => setField('practice_date', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label htmlFor={staffId} className={INPUT.label}>Staff ID</label>
          <input id={staffId} className={INPUT.base} value={form.staff_id} onChange={e => setField('staff_id', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label htmlFor={facilitatorId} className={INPUT.label}>Facilitator</label>
          <input id={facilitatorId} className={INPUT.base} value={form.facilitator} onChange={e => setField('facilitator', e.target.value)} disabled={!canEdit} />
        </div>
        <div className="md:col-span-2">
          <label htmlFor={categoryId} className={INPUT.label}>Category</label>
          <select id={categoryId} className={INPUT.select} value={form.category} onChange={e => setField('category', e.target.value)} disabled={!canEdit}>
            {CATEGORIES.map(category => <option key={category} value={category}>{titleCase(category)}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label htmlFor={reflectionId} className={INPUT.label}>Reflection</label>
          <textarea id={reflectionId} className={`${INPUT.base} min-h-24`} value={form.reflection} onChange={e => setField('reflection', e.target.value)} disabled={!canEdit} />
        </div>
        <div className="md:col-span-2">
          <label htmlFor={learningId} className={INPUT.label}>Learning outcome</label>
          <textarea id={learningId} className={`${INPUT.base} min-h-20`} value={form.learning_outcome} onChange={e => setField('learning_outcome', e.target.value)} disabled={!canEdit} />
        </div>
        <div className="md:col-span-2">
          <label htmlFor={wellbeingId} className={INPUT.label}>Wellbeing notes</label>
          <textarea id={wellbeingId} className={`${INPUT.base} min-h-20`} value={form.wellbeing_notes} onChange={e => setField('wellbeing_notes', e.target.value)} disabled={!canEdit} />
        </div>
        <div className="md:col-span-2">
          <label htmlFor={actionId} className={INPUT.label}>Action summary</label>
          <textarea id={actionId} className={`${INPUT.base} min-h-20`} value={form.action_summary} onChange={e => setField('action_summary', e.target.value)} disabled={!canEdit} />
        </div>
      </div>
      <div className={MODAL.footer}>
        {entry && canEdit && <button type="button" className={`${BTN.danger} mr-auto`} onClick={onDelete}>Delete</button>}
        <button type="button" className={BTN.secondary} onClick={onClose}>Close</button>
        {canEdit && <button type="button" className={BTN.primary} onClick={onSave} disabled={!form.topic || !form.practice_date}>Save</button>}
      </div>
    </Modal>
  );
}

export default function ReflectivePractice() {
  const { activeHome, canWrite } = useData();
  const canEdit = canWrite('hr');
  const { confirm, ConfirmDialog } = useConfirm();
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_ENTRY });
  useDirtyGuard(modalOpen);

  const load = useCallback(async () => {
    if (!activeHome) return;
    setLoading(true);
    try {
      const result = await getReflectivePractice(activeHome);
      setEntries(Array.isArray(result.entries) ? result.entries : []);
      setTotal(result._total || 0);
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load reflective practice');
    } finally {
      setLoading(false);
    }
  }, [activeHome]);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_ENTRY, practice_date: todayLocalISO() });
    setSaveError(null);
    setModalOpen(true);
  }

  function openEdit(entry) {
    setEditing(entry);
    setForm({
      ...EMPTY_ENTRY,
      ...entry,
      staff_id: entry.staff_id || '',
      facilitator: entry.facilitator || '',
      reflection: entry.reflection || '',
      learning_outcome: entry.learning_outcome || '',
      wellbeing_notes: entry.wellbeing_notes || '',
      action_summary: entry.action_summary || '',
      _version: entry.version,
    });
    setSaveError(null);
    setModalOpen(true);
  }

  async function saveEntry() {
    try {
      if (editing) await updateReflectivePractice(activeHome, editing.id, entryPayload(form));
      else await createReflectivePractice(activeHome, entryPayload(form));
      setModalOpen(false);
      showNotice(editing ? 'Reflection updated.' : 'Reflection saved.');
      await load();
    } catch (e) {
      setSaveError(e.message || 'Unable to save reflection');
    }
  }

  async function removeEntry() {
    if (!editing) return;
    const ok = await confirm({ title: 'Delete Reflection', message: 'Delete this reflective-practice entry?', confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await deleteReflectivePractice(activeHome, editing.id);
      setModalOpen(false);
      showNotice('Reflection deleted.');
      await load();
    } catch (e) {
      setSaveError(e.message || 'Unable to delete reflection');
    }
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Reflective Practice</h1>
          <p className={PAGE.subtitle}>Staff learning, wellbeing themes and follow-up actions.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN.secondary} onClick={load}>Refresh</button>
          {canEdit && <button type="button" className={BTN.primary} onClick={openNew}>New Reflection</button>}
        </div>
      </div>

      {notice && <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">{notice.content}</InlineNotice>}
      {error && <ErrorState title="Reflective practice unavailable" message={error} onRetry={load} className="mb-4" />}

      <div className={CARD.flush}>
        {loading ? <LoadingState message="Loading reflective practice..." /> : (
          entries.length === 0 ? <EmptyState title="No reflections" description="Reflective-practice entries will appear here." /> : (
            <div className={TABLE.wrapper}>
              <table className={TABLE.table}>
                <thead className={TABLE.thead}>
                  <tr>
                    <th className={TABLE.th}>Topic</th>
                    <th className={TABLE.th}>Date</th>
                    <th className={TABLE.th}>Staff</th>
                    <th className={TABLE.th}>Category</th>
                    <th className={TABLE.th}>Facilitator</th>
                    <th className={TABLE.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => (
                    <tr key={entry.id} className={TABLE.tr}>
                      <td className={TABLE.td}>
                        <button type="button" className="text-left font-semibold text-[var(--ink)] hover:text-[var(--accent)]" onClick={() => openEdit(entry)}>{entry.topic}</button>
                      </td>
                      <td className={TABLE.td}>{entry.practice_date}</td>
                      <td className={TABLE.td}>{entry.staff_id || '-'}</td>
                      <td className={TABLE.td}><span className={BADGE.blue}>{titleCase(entry.category)}</span></td>
                      <td className={TABLE.td}>{entry.facilitator || '-'}</td>
                      <td className={TABLE.td}><button type="button" className={`${BTN.ghost} ${BTN.xs}`} onClick={() => openEdit(entry)}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
      <p className="mt-3 text-sm text-[var(--ink-3)]">{total} entries</p>

      <EntryModal
        isOpen={modalOpen}
        entry={editing}
        form={form}
        setForm={setForm}
        saveError={saveError}
        canEdit={canEdit}
        onClose={() => setModalOpen(false)}
        onSave={saveEntry}
        onDelete={removeEntry}
      />
      {ConfirmDialog}
    </div>
  );
}
