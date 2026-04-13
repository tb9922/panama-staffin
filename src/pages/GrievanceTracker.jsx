import { useState, useEffect, useRef, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import Modal from '../components/Modal.jsx';
import TabBar from '../components/TabBar.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import {
  getCurrentHome,
  getHrGrievance,
  createHrGrievance,
  updateHrGrievance,
  getGrievanceActions,
  createGrievanceAction,
  updateGrievanceAction,
  getHrCaseNotes,
  createHrCaseNote,
} from '../lib/api.js';
import { GRIEVANCE_CATEGORIES, GRIEVANCE_STATUSES, getStatusBadge } from '../lib/hr.js';
import Pagination from '../components/Pagination.jsx';
import StaffPicker from '../components/StaffPicker.jsx';
import FileAttachments from '../components/FileAttachments.jsx';
import InvestigationMeetings from '../components/InvestigationMeetings.jsx';
import { clickableRowProps } from '../lib/a11y.js';
import { useData } from '../contexts/DataContext.jsx';
import { todayLocalISO } from '../lib/localDates.js';
import useTransientNotice from '../hooks/useTransientNotice.js';

const PROTECTED_CHARACTERISTICS = [
  { id: '', name: 'None' },
  { id: 'age', name: 'Age' },
  { id: 'disability', name: 'Disability' },
  { id: 'gender_reassignment', name: 'Gender Reassignment' },
  { id: 'marriage', name: 'Marriage & Civil Partnership' },
  { id: 'pregnancy', name: 'Pregnancy & Maternity' },
  { id: 'race', name: 'Race' },
  { id: 'religion', name: 'Religion or Belief' },
  { id: 'sex', name: 'Sex' },
  { id: 'sexual_orientation', name: 'Sexual Orientation' },
];

const MODAL_TABS = [
  { id: 'details', label: 'Details' },
  { id: 'acknowledgement', label: 'Acknowledgement' },
  { id: 'investigation', label: 'Investigation' },
  { id: 'hearing', label: 'Hearing' },
  { id: 'outcome', label: 'Outcome' },
  { id: 'appeal', label: 'Appeal' },
  { id: 'actions', label: 'Actions' },
  { id: 'notes', label: 'Notes' },
];

const LIMIT = 50;

export default function GrievanceTracker() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [modalTab, setModalTab] = useState('details');
  const [caseNotes, setCaseNotes] = useState([]);
  const [noteText, setNoteText] = useState('');
  const [actions, setActions] = useState([]);
  const [actionForm, setActionForm] = useState({});
  const [showActionForm, setShowActionForm] = useState(false);
  const [filterStaff, setFilterStaff] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalError, setModalError] = useState(null);

  const home = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('hr');
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const editReqRef = useRef(0);

  useDirtyGuard(showModal);

  useEffect(() => setOffset(0), [filterStaff, filterStatus]);

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const filters = { limit: LIMIT, offset };
      if (filterStaff) filters.staffId = filterStaff;
      if (filterStatus) filters.status = filterStatus;
      const res = await getHrGrievance(home, filters);
      setCases(res?.rows || []);
      setTotal(res?.total || 0);
      setPageError(null);
    } catch (e) {
      setPageError(e.message || 'Failed to load grievance cases');
    } finally {
      setLoading(false);
    }
  }, [home, filterStaff, filterStatus, offset]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  function openCreate() {
    setEditing(null);
    setForm({
      date_raised: todayLocalISO(),
      category: 'other',
      status: 'open',
      confidential: false,
      raised_by_method: 'written',
    });
    setModalTab('details');
    setCaseNotes([]);
    setActions([]);
    setNoteText('');
    setShowActionForm(false);
    setActionForm({});
    setModalError(null);
    setShowModal(true);
  }

  async function openEdit(record) {
    const reqId = ++editReqRef.current;
    setEditing(record);
    setForm({ ...record, description: record.subject_summary || record.description || '' });
    setModalTab('details');
    setNoteText('');
    setShowActionForm(false);
    setActionForm({});
    setCaseNotes([]);
    setActions([]);
    setModalError(null);
    setShowModal(true);

    if (!record.id) return;

    const [notes, acts] = await Promise.all([
      getHrCaseNotes(home, 'grievance', record.id).catch(() => []),
      getGrievanceActions(record.id).catch(() => []),
    ]);

    if (editReqRef.current !== reqId) return;
    setCaseNotes(notes);
    setActions(Array.isArray(acts) ? acts : []);
  }

  function closeModal() {
    setShowModal(false);
    setEditing(null);
    setForm({});
    setCaseNotes([]);
    setActions([]);
    setNoteText('');
    setShowActionForm(false);
    setActionForm({});
    setModalError(null);
  }

  async function handleSave() {
    setModalError(null);
    const missing = [];
    if (!form.staff_id) missing.push('Staff Member');
    if (!form.date_raised) missing.push('Date Raised');
    if (!form.category) missing.push('Category');
    if (!form.description?.trim()) missing.push('Description');
    if (missing.length) {
      setModalError(`Required: ${missing.join(', ')}`);
      return;
    }

    setSaving(true);
    try {
      if (editing?.id) {
        await updateHrGrievance(editing.id, { ...form, _version: editing.version });
      } else {
        await createHrGrievance(home, form);
      }
      closeModal();
      showNotice(editing?.id ? 'Grievance case updated.' : 'Grievance case created.');
      setRefreshKey(key => key + 1);
    } catch (e) {
      if (e.message?.includes('modified by another user')) {
        setModalError('This record was modified by another user. Please close and reopen to get the latest version.');
        setRefreshKey(key => key + 1);
      } else {
        setModalError(e.message || 'Failed to save grievance case');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleAddNote() {
    if (!noteText.trim() || !editing?.id || saving) return;
    setSaving(true);
    try {
      await createHrCaseNote(home, 'grievance', editing.id, { note: noteText.trim() });
      setCaseNotes(await getHrCaseNotes(home, 'grievance', editing.id));
      setNoteText('');
      showNotice('Case note added.');
    } catch (e) {
      setModalError(e.message || 'Failed to add case note');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddAction() {
    if (!actionForm.description || !editing?.id || saving) return;
    setSaving(true);
    try {
      await createGrievanceAction(editing.id, actionForm);
      setActions(await getGrievanceActions(editing.id));
      setActionForm({});
      setShowActionForm(false);
      showNotice('Grievance action added.');
    } catch (e) {
      setModalError(e.message || 'Failed to add action');
    } finally {
      setSaving(false);
    }
  }

  async function handleCompleteAction(action) {
    if (saving) return;
    setSaving(true);
    try {
      await updateGrievanceAction(action.id, {
        ...action,
        status: 'completed',
        completed_date: todayLocalISO(),
        _version: action.version,
      });
      setActions(await getGrievanceActions(editing.id));
      showNotice('Grievance action marked complete.');
    } catch (e) {
      setModalError(e.message || 'Failed to complete action');
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    const { downloadXLSX } = await import('../lib/excel.js');
    downloadXLSX('grievance_cases', [{
      name: 'Grievances',
      headers: ['Staff ID', 'Date Raised', 'Category', 'Confidential', 'Status', 'Outcome'],
      rows: cases.map(record => [
        record.staff_id,
        record.date_raised,
        GRIEVANCE_CATEGORIES.find(category => category.id === record.category)?.name || record.category,
        record.confidential ? 'Yes' : 'No',
        GRIEVANCE_STATUSES.find(status => status.id === record.status)?.name || record.status,
        record.outcome || '',
      ]),
    }]);
  }

  function clearFilters() {
    setFilterStaff('');
    setFilterStatus('');
  }

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  if (loading) {
    return (
      <div className={PAGE.container}>
        <LoadingState message="Loading grievance cases..." card />
      </div>
    );
  }

  if (pageError) {
    return (
      <div className={PAGE.container}>
        <ErrorState title="Could not load grievance cases" message={pageError} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Grievance Tracker</h1>
          <p className={PAGE.subtitle}>ACAS-compliant grievance case management</p>
        </div>
        <div className="flex gap-2">
          <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleExport}>Export Excel</button>
          {canEdit && <button className={BTN.primary + ' ' + BTN.sm} onClick={openCreate}>New Case</button>}
        </div>
      </div>

      {notice && (
        <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">
          {notice.content}
        </InlineNotice>
      )}

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <StaffPicker value={filterStaff} onChange={setFilterStaff} showAll showInactive small />
        <div>
          <label className={INPUT.label}>Status</label>
          <select className={INPUT.select + ' py-1.5 text-sm'} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All</option>
            {GRIEVANCE_STATUSES.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}
          </select>
        </div>
        {(filterStaff || filterStatus) && (
          <button className={BTN.ghost + ' ' + BTN.sm} onClick={clearFilters}>Clear</button>
        )}
      </div>

      {cases.length === 0 ? (
        <div className={CARD.padded}>
          <EmptyState
            title="No grievance cases yet"
            description={canEdit ? 'Start the first grievance case to track acknowledgements, investigations, actions, and outcomes in one place.' : 'Grievance cases will appear here once they are recorded.'}
            actionLabel={canEdit ? 'New Case' : undefined}
            onAction={canEdit ? openCreate : undefined}
          />
        </div>
      ) : (
        <div className={CARD.flush}>
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th scope="col" className={TABLE.th}>Staff ID</th>
                  <th scope="col" className={TABLE.th}>Date Raised</th>
                  <th scope="col" className={TABLE.th}>Category</th>
                  <th scope="col" className={TABLE.th}>Confidential</th>
                  <th scope="col" className={TABLE.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {cases.map(record => (
                  <tr
                    key={record.id}
                    className={`${TABLE.tr}${canEdit ? ' cursor-pointer' : ''}`}
                    {...clickableRowProps(() => canEdit && openEdit(record))}
                  >
                    <td className={TABLE.tdMono}>{record.staff_id}</td>
                    <td className={TABLE.td}>{record.date_raised}</td>
                    <td className={TABLE.td}>{GRIEVANCE_CATEGORIES.find(category => category.id === record.category)?.name || record.category}</td>
                    <td className={TABLE.td}>
                      {record.confidential ? <span className={BADGE.red}>Yes</span> : <span className={BADGE.gray}>No</span>}
                    </td>
                    <td className={TABLE.td}>
                      <span className={BADGE[getStatusBadge(record.status, GRIEVANCE_STATUSES)]}>
                        {GRIEVANCE_STATUSES.find(status => status.id === record.status)?.name || record.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination total={total} limit={LIMIT} offset={offset} onChange={setOffset} />

      {showModal && renderModal()}
    </div>
  );

  function renderModal() {
    return (
      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Grievance Case' : 'New Grievance Case'} size="xl">
        <TabBar tabs={editing ? MODAL_TABS : MODAL_TABS.filter(tab => tab.id !== 'notes' && tab.id !== 'actions')} activeTab={modalTab} onTabChange={setModalTab} />

        {modalTab === 'details' && renderDetailsTab()}
        {modalTab === 'acknowledgement' && renderAcknowledgementTab()}
        {modalTab === 'investigation' && renderInvestigationTab()}
        {modalTab === 'hearing' && renderHearingTab()}
        {modalTab === 'outcome' && renderOutcomeTab()}
        {modalTab === 'appeal' && renderAppealTab()}
        {modalTab === 'actions' && renderActionsTab()}
        {modalTab === 'notes' && renderNotesTab()}

        {modalError && <ErrorState title="This grievance case needs attention" message={modalError} className="mb-3" />}

        <div className={MODAL.footer}>
          <button className={BTN.secondary} onClick={closeModal} disabled={saving}>Cancel</button>
          <button className={BTN.primary} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</button>
        </div>
      </Modal>
    );
  }

  function renderDetailsTab() {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <StaffPicker value={form.staff_id || ''} onChange={val => setField('staff_id', val)} label="Staff Member" required />
          <div>
            <label className={INPUT.label}>Date Raised *</label>
            <input type="date" className={INPUT.base} value={form.date_raised || ''} onChange={e => setField('date_raised', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={INPUT.label}>Category *</label>
            <select aria-label="Category" className={INPUT.select} value={form.category || ''} onChange={e => setField('category', e.target.value)}>
              <option value="">Select...</option>
              {GRIEVANCE_CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Raised By</label>
            <select className={INPUT.select} value={form.raised_by_method || 'written'} onChange={e => setField('raised_by_method', e.target.value)}>
              <option value="verbal">Verbal</option>
              <option value="written">Written</option>
              <option value="email">Email</option>
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Status</label>
            <select className={INPUT.select} value={form.status || 'open'} onChange={e => setField('status', e.target.value)}>
              {GRIEVANCE_STATUSES.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Description *</label>
          <textarea aria-label="Description" className={INPUT.base} rows={3} value={form.description || ''} onChange={e => setField('description', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Protected Characteristic</label>
            <select className={INPUT.select} value={form.protected_characteristic || ''} onChange={e => setField('protected_characteristic', e.target.value)}>
              {PROTECTED_CHARACTERISTICS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div className="flex items-center pt-6">
            <input type="checkbox" id="grv-confidential" checked={form.confidential || false} onChange={e => setField('confidential', e.target.checked)} className="mr-2" />
            <label htmlFor="grv-confidential" className="text-sm">Confidential</label>
          </div>
        </div>
      </div>
    );
  }

  function renderAcknowledgementTab() {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Acknowledged Date</label>
            <input type="date" className={INPUT.base} value={form.acknowledged_date || ''} onChange={e => setField('acknowledged_date', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Acknowledged By</label>
            <input className={INPUT.base} value={form.acknowledged_by || ''} onChange={e => setField('acknowledged_by', e.target.value)} />
          </div>
        </div>
      </div>
    );
  }

  function renderInvestigationTab() {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Investigation Officer</label>
            <input className={INPUT.base} value={form.investigation_officer || ''} onChange={e => setField('investigation_officer', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Investigation Start Date</label>
            <input type="date" className={INPUT.base} value={form.investigation_start_date || ''} onChange={e => setField('investigation_start_date', e.target.value)} />
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Investigation Notes</label>
          <textarea className={INPUT.base} rows={3} value={form.investigation_notes || ''} onChange={e => setField('investigation_notes', e.target.value)} />
        </div>
        <InvestigationMeetings caseType="grievance" caseId={editing?.id} />
        <FileAttachments caseType="grievance" caseId={editing?.id} />
      </div>
    );
  }

  function renderHearingTab() {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Hearing Date</label>
            <input type="date" className={INPUT.base} value={form.hearing_date || ''} onChange={e => setField('hearing_date', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Hearing Chair</label>
            <input className={INPUT.base} value={form.hearing_chair || ''} onChange={e => setField('hearing_chair', e.target.value)} />
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Companion Name</label>
          <input className={INPUT.base} value={form.hearing_companion_name || ''} onChange={e => setField('hearing_companion_name', e.target.value)} placeholder="Trade union rep or colleague" />
        </div>
      </div>
    );
  }

  function renderOutcomeTab() {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Outcome</label>
            <select className={INPUT.select} value={form.outcome || ''} onChange={e => setField('outcome', e.target.value)}>
              <option value="">-- Select --</option>
              <option value="upheld">Upheld</option>
              <option value="partially_upheld">Partially Upheld</option>
              <option value="not_upheld">Not Upheld</option>
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Outcome Date</label>
            <input type="date" className={INPUT.base} value={form.outcome_date || ''} onChange={e => setField('outcome_date', e.target.value)} />
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Outcome Notes</label>
          <textarea className={INPUT.base} rows={3} value={form.outcome_reason || ''} onChange={e => setField('outcome_reason', e.target.value)} />
        </div>
        <div className="flex items-center">
          <input type="checkbox" id="grv-mediation" checked={form.mediation_offered || false} onChange={e => setField('mediation_offered', e.target.checked)} className="mr-2" />
          <label htmlFor="grv-mediation" className="text-sm">Mediation Offered</label>
        </div>
      </div>
    );
  }

  function renderAppealTab() {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Appeal Date</label>
            <input type="date" className={INPUT.base} value={form.appeal_date || ''} onChange={e => setField('appeal_date', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Appeal Outcome Date</label>
            <input type="date" className={INPUT.base} value={form.appeal_outcome_date || ''} onChange={e => setField('appeal_outcome_date', e.target.value)} />
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Appeal Grounds</label>
          <textarea className={INPUT.base} rows={3} value={form.appeal_grounds || ''} onChange={e => setField('appeal_grounds', e.target.value)} />
        </div>
        <div>
          <label className={INPUT.label}>Appeal Outcome</label>
          <select className={INPUT.select} value={form.appeal_outcome || ''} onChange={e => setField('appeal_outcome', e.target.value)}>
            <option value="">-- Select --</option>
            <option value="upheld">Upheld</option>
            <option value="overturned">Overturned</option>
            <option value="modified">Modified</option>
          </select>
        </div>
      </div>
    );
  }

  function renderActionsTab() {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h4 className="text-sm font-semibold text-gray-700">Grievance Actions</h4>
          <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => { setShowActionForm(true); setActionForm({}); }}>Add Action</button>
        </div>

        {showActionForm && (
          <div className="border border-gray-200 rounded-lg p-3 space-y-3">
            <div>
              <label className={INPUT.label}>Description</label>
              <input className={INPUT.base} value={actionForm.description || ''} onChange={e => setActionForm({ ...actionForm, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={INPUT.label}>Assigned To</label>
                <input className={INPUT.base} value={actionForm.assigned_to || ''} onChange={e => setActionForm({ ...actionForm, assigned_to: e.target.value })} />
              </div>
              <div>
                <label className={INPUT.label}>Due Date</label>
                <input type="date" className={INPUT.base} value={actionForm.due_date || ''} onChange={e => setActionForm({ ...actionForm, due_date: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <button className={BTN.primary + ' ' + BTN.xs} onClick={handleAddAction} disabled={saving}>Save</button>
              <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => setShowActionForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {actions.length === 0 && <p className="text-sm text-gray-400">No actions recorded</p>}
          {actions.map(action => (
            <div key={action.id} className="flex items-start justify-between border border-gray-100 rounded-lg p-3">
              <div>
                <p className="text-sm text-gray-800">{action.description}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {action.assigned_to ? `Assigned: ${action.assigned_to}` : ''}
                  {action.due_date ? ` | Due: ${action.due_date}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-3 shrink-0">
                {action.status === 'completed' || action.completed_date
                  ? <span className={BADGE.green}>Done</span>
                  : <button className={BTN.success + ' ' + BTN.xs} onClick={() => handleCompleteAction(action)} disabled={saving}>Complete</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderNotesTab() {
    return (
      <div className="space-y-4">
        <div className="space-y-3 max-h-60 overflow-y-auto">
          {caseNotes.length === 0 && <p className="text-sm text-gray-400">No case notes yet</p>}
          {caseNotes.map(note => (
            <div key={note.id} className="border border-gray-100 rounded-lg p-3">
              <p className="text-sm text-gray-800">{note.content}</p>
              <p className="text-xs text-gray-400 mt-1">
                {note.author || 'System'} - {note.created_at ? new Date(note.created_at).toLocaleString('en-GB') : ''}
              </p>
            </div>
          ))}
        </div>
        <div>
          <label className={INPUT.label}>Add Note</label>
          <textarea className={INPUT.base} rows={2} value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Type a case note..." />
        </div>
        <button className={BTN.primary + ' ' + BTN.sm} onClick={handleAddNote} disabled={!noteText.trim() || saving}>{saving ? 'Adding...' : 'Add Note'}</button>
        <FileAttachments caseType="grievance" caseId={editing?.id} />
      </div>
    );
  }
}
