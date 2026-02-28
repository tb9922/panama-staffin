import { useState, useEffect, useRef } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE, TAB } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import Modal from '../components/Modal.jsx';
import {
  getCurrentHome, getHrGrievance, createHrGrievance, updateHrGrievance,
  getGrievanceActions, createGrievanceAction, updateGrievanceAction,
  getHrCaseNotes, createHrCaseNote,
} from '../lib/api.js';
import { GRIEVANCE_CATEGORIES, GRIEVANCE_STATUSES, getStatusBadge } from '../lib/hr.js';
import StaffPicker from '../components/StaffPicker.jsx';
import FileAttachments from '../components/FileAttachments.jsx';
import InvestigationMeetings from '../components/InvestigationMeetings.jsx';

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

export default function GrievanceTracker() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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
  useDirtyGuard(showModal);
  const [filterStatus, setFilterStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const home = getCurrentHome();
  const editReqRef = useRef(0);

  useEffect(() => {
    let stale = false;
    (async () => {
      if (!home) return;
      setLoading(true);
      try {
        const filters = {};
        if (filterStaff) filters.staffId = filterStaff;
        if (filterStatus) filters.status = filterStatus;
        const res = await getHrGrievance(home, filters);
        if (!stale) { setCases(res?.rows || []); setError(null); }
      } catch (e) { if (!stale) setError(e.message); }
      finally { if (!stale) setLoading(false); }
    })();
    return () => { stale = true; };
  }, [home, filterStaff, filterStatus, refreshKey]);

  function openCreate() {
    setEditing(null);
    setForm({ date_raised: new Date().toISOString().slice(0, 10), category: 'other', status: 'open', confidential: false, raised_by_method: 'written' });
    setModalTab('details');
    setCaseNotes([]);
    setActions([]);
    setNoteText('');
    setShowActionForm(false);
    setActionForm({});
    setShowModal(true);
  }

  async function openEdit(c) {
    const reqId = ++editReqRef.current;
    setEditing(c);
    setForm({ ...c });
    setModalTab('details');
    setNoteText('');
    setShowActionForm(false);
    setActionForm({});
    setCaseNotes([]);
    setActions([]);
    setShowModal(true);
    if (c.id) {
      const [notes, acts] = await Promise.all([
        getHrCaseNotes(home, 'grievance', c.id).catch(() => []),
        getGrievanceActions(c.id).catch(() => []),
      ]);
      if (editReqRef.current !== reqId) return; // stale
      setCaseNotes(notes);
      setActions(Array.isArray(acts) ? acts : []);
    }
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
    setError(null);
  }

  async function handleSave() {
    setError(null);
    const missing = [];
    if (!form.staff_id) missing.push('Staff Member');
    if (!form.date_raised) missing.push('Date Raised');
    if (!form.category) missing.push('Category');
    if (!form.description?.trim()) missing.push('Description');
    if (missing.length) { setError(`Required: ${missing.join(', ')}`); return; }
    setSaving(true);
    try {
      if (editing?.id) {
        await updateHrGrievance(editing.id, { ...form, _version: editing.version });
      } else {
        await createHrGrievance(home, form);
      }
      closeModal();
      setRefreshKey(k => k + 1);
    } catch (e) {
      if (e.message?.includes('modified by another user')) {
        setError('This record was modified by another user. Please close and reopen to get the latest version.');
        setRefreshKey(k => k + 1);
      } else { setError(e.message); }
    }
    finally { setSaving(false); }
  }

  async function handleAddNote() {
    if (!noteText.trim() || !editing?.id || saving) return;
    setSaving(true);
    try {
      await createHrCaseNote(home, 'grievance', editing.id, { note: noteText.trim() });
      setCaseNotes(await getHrCaseNotes(home, 'grievance', editing.id));
      setNoteText('');
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleAddAction() {
    if (!actionForm.description || !editing?.id || saving) return;
    setSaving(true);
    try {
      await createGrievanceAction(editing.id, actionForm);
      setActions(await getGrievanceActions(editing.id));
      setActionForm({});
      setShowActionForm(false);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleCompleteAction(action) {
    if (saving) return;
    setSaving(true);
    try {
      await updateGrievanceAction(action.id, { ...action, status: 'completed', completed_date: new Date().toISOString().slice(0, 10) });
      setActions(await getGrievanceActions(editing.id));
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleExport() {
    const { downloadXLSX } = await import('../lib/excel.js');
    downloadXLSX('grievance_cases', [{
      name: 'Grievances',
      headers: ['Staff ID', 'Date Raised', 'Category', 'Confidential', 'Status', 'Outcome'],
      rows: cases.map(c => [
        c.staff_id, c.date_raised,
        GRIEVANCE_CATEGORIES.find(cat => cat.id === c.category)?.name || c.category,
        c.confidential ? 'Yes' : 'No',
        GRIEVANCE_STATUSES.find(s => s.id === c.status)?.name || c.status,
        c.outcome || '',
      ]),
    }]);
  }

  function clearFilters() {
    setFilterStaff('');
    setFilterStatus('');
  }

  const f = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  if (loading) return <div className={PAGE.container}><div className={CARD.padded}><p className="text-center py-10 text-gray-500">Loading grievance cases...</p></div></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Grievance Tracker</h1>
          <p className={PAGE.subtitle}>ACAS-compliant grievance case management</p>
        </div>
        <div className="flex gap-2">
          <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleExport}>Export Excel</button>
          <button className={BTN.primary + ' ' + BTN.sm} onClick={openCreate}>New Case</button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <StaffPicker value={filterStaff} onChange={setFilterStaff} showAll showInactive small />
        <div>
          <label className={INPUT.label}>Status</label>
          <select className={INPUT.select + ' py-1.5 text-sm'} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All</option>
            {GRIEVANCE_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        {(filterStaff || filterStatus) && (
          <button className={BTN.ghost + ' ' + BTN.sm} onClick={clearFilters}>Clear</button>
        )}
      </div>

      {/* Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th className={TABLE.th}>Staff ID</th>
                <th className={TABLE.th}>Date Raised</th>
                <th className={TABLE.th}>Category</th>
                <th className={TABLE.th}>Confidential</th>
                <th className={TABLE.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {cases.length === 0 && <tr><td colSpan={5} className={TABLE.empty}>No grievance cases</td></tr>}
              {cases.map(c => (
                <tr key={c.id} className={TABLE.tr + ' cursor-pointer'} onClick={() => openEdit(c)}>
                  <td className={TABLE.tdMono}>{c.staff_id}</td>
                  <td className={TABLE.td}>{c.date_raised}</td>
                  <td className={TABLE.td}>{GRIEVANCE_CATEGORIES.find(cat => cat.id === c.category)?.name || c.category}</td>
                  <td className={TABLE.td}>
                    {c.confidential
                      ? <span className={BADGE.red}>Yes</span>
                      : <span className={BADGE.gray}>No</span>}
                  </td>
                  <td className={TABLE.td}>
                    <span className={BADGE[getStatusBadge(c.status, GRIEVANCE_STATUSES)]}>
                      {GRIEVANCE_STATUSES.find(s => s.id === c.status)?.name || c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && renderModal()}
    </div>
  );

  function renderModal() {
    return (
      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Grievance Case' : 'New Grievance Case'} size="xl">
          {/* Modal tabs */}
          <div className={TAB.bar}>
            {MODAL_TABS.map(t => {
              if ((t.id === 'notes' || t.id === 'actions') && !editing) return null;
              return (
                <button key={t.id} onClick={() => setModalTab(t.id)}
                  className={`${TAB.button} ${modalTab === t.id ? TAB.active : TAB.inactive}`}>{t.label}</button>
              );
            })}
          </div>

          {modalTab === 'details' && renderDetailsTab()}
          {modalTab === 'acknowledgement' && renderAcknowledgementTab()}
          {modalTab === 'investigation' && renderInvestigationTab()}
          {modalTab === 'hearing' && renderHearingTab()}
          {modalTab === 'outcome' && renderOutcomeTab()}
          {modalTab === 'appeal' && renderAppealTab()}
          {modalTab === 'actions' && renderActionsTab()}
          {modalTab === 'notes' && renderNotesTab()}

          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm mb-3">{error}</div>}
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
          <StaffPicker value={form.staff_id || ''} onChange={val => f('staff_id', val)} label="Staff Member" />
          <div>
            <label className={INPUT.label}>Date Raised</label>
            <input type="date" className={INPUT.base} value={form.date_raised || ''} onChange={e => f('date_raised', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={INPUT.label}>Category</label>
            <select className={INPUT.select} value={form.category || ''} onChange={e => f('category', e.target.value)}>
              <option value="">Select...</option>
              {GRIEVANCE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Raised By</label>
            <select className={INPUT.select} value={form.raised_by_method || 'written'} onChange={e => f('raised_by_method', e.target.value)}>
              <option value="verbal">Verbal</option>
              <option value="written">Written</option>
              <option value="email">Email</option>
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Status</label>
            <select className={INPUT.select} value={form.status || 'open'} onChange={e => f('status', e.target.value)}>
              {GRIEVANCE_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Description</label>
          <textarea className={INPUT.base} rows={3} value={form.description || ''} onChange={e => f('description', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Protected Characteristic</label>
            <select className={INPUT.select} value={form.protected_characteristic || ''} onChange={e => f('protected_characteristic', e.target.value)}>
              {PROTECTED_CHARACTERISTICS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex items-center pt-6">
            <input type="checkbox" id="grv-confidential" checked={form.confidential || false} onChange={e => f('confidential', e.target.checked)} className="mr-2" />
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
            <input type="date" className={INPUT.base} value={form.acknowledged_date || ''} onChange={e => f('acknowledged_date', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Acknowledged By</label>
            <input className={INPUT.base} value={form.acknowledged_by || ''} onChange={e => f('acknowledged_by', e.target.value)} />
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
            <input className={INPUT.base} value={form.investigation_officer || ''} onChange={e => f('investigation_officer', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Investigation Start Date</label>
            <input type="date" className={INPUT.base} value={form.investigation_start_date || ''} onChange={e => f('investigation_start_date', e.target.value)} />
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Investigation Notes</label>
          <textarea className={INPUT.base} rows={3} value={form.investigation_notes || ''} onChange={e => f('investigation_notes', e.target.value)} />
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
            <input type="date" className={INPUT.base} value={form.hearing_date || ''} onChange={e => f('hearing_date', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Hearing Chair</label>
            <input className={INPUT.base} value={form.hearing_chair || ''} onChange={e => f('hearing_chair', e.target.value)} />
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Companion Name</label>
          <input className={INPUT.base} value={form.hearing_companion_name || ''} onChange={e => f('hearing_companion_name', e.target.value)} placeholder="Trade union rep or colleague" />
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
            <input className={INPUT.base} value={form.outcome || ''} onChange={e => f('outcome', e.target.value)} placeholder="e.g. upheld, partially upheld, not upheld" />
          </div>
          <div>
            <label className={INPUT.label}>Outcome Date</label>
            <input type="date" className={INPUT.base} value={form.outcome_date || ''} onChange={e => f('outcome_date', e.target.value)} />
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Outcome Notes</label>
          <textarea className={INPUT.base} rows={3} value={form.outcome_reason || ''} onChange={e => f('outcome_reason', e.target.value)} />
        </div>
        <div className="flex items-center">
          <input type="checkbox" id="grv-mediation" checked={form.mediation_offered || false} onChange={e => f('mediation_offered', e.target.checked)} className="mr-2" />
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
            <input type="date" className={INPUT.base} value={form.appeal_date || ''} onChange={e => f('appeal_date', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Appeal Outcome Date</label>
            <input type="date" className={INPUT.base} value={form.appeal_outcome_date || ''} onChange={e => f('appeal_outcome_date', e.target.value)} />
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Appeal Grounds</label>
          <textarea className={INPUT.base} rows={3} value={form.appeal_grounds || ''} onChange={e => f('appeal_grounds', e.target.value)} />
        </div>
        <div>
          <label className={INPUT.label}>Appeal Outcome</label>
          <input className={INPUT.base} value={form.appeal_outcome || ''} onChange={e => f('appeal_outcome', e.target.value)} placeholder="e.g. upheld, overturned, modified" />
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
          {actions.map(a => (
            <div key={a.id} className="flex items-start justify-between border border-gray-100 rounded-lg p-3">
              <div>
                <p className="text-sm text-gray-800">{a.description}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {a.assigned_to ? `Assigned: ${a.assigned_to}` : ''}
                  {a.due_date ? ` | Due: ${a.due_date}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-3 shrink-0">
                {a.status === 'completed' || a.completed_date
                  ? <span className={BADGE.green}>Done</span>
                  : <button className={BTN.success + ' ' + BTN.xs} onClick={() => handleCompleteAction(a)} disabled={saving}>Complete</button>
                }
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
          {caseNotes.map(n => (
            <div key={n.id} className="border border-gray-100 rounded-lg p-3">
              <p className="text-sm text-gray-800">{n.content}</p>
              <p className="text-xs text-gray-400 mt-1">
                {n.author || 'System'} — {n.created_at ? new Date(n.created_at).toLocaleString() : ''}
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
