import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import Modal from '../components/Modal.jsx';
import {
  getCurrentHome, getHrDisciplinary, createHrDisciplinary, updateHrDisciplinary,
  getHrCaseNotes, createHrCaseNote,
} from '../lib/api.js';
import {
  DISCIPLINARY_CATEGORIES, DISCIPLINARY_STATUSES, DISCIPLINARY_OUTCOMES,
  getStatusBadge,
} from '../lib/hr.js';
import StaffPicker from '../components/StaffPicker.jsx';
import FileAttachments from '../components/FileAttachments.jsx';
import InvestigationMeetings from '../components/InvestigationMeetings.jsx';

const MODAL_TABS = [
  { id: 'details', label: 'Details' },
  { id: 'investigation', label: 'Investigation' },
  { id: 'hearing', label: 'Hearing' },
  { id: 'outcome', label: 'Outcome' },
  { id: 'appeal', label: 'Appeal' },
  { id: 'notes', label: 'Notes' },
];

export default function DisciplinaryTracker() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [modalTab, setModalTab] = useState('details');
  const [caseNotes, setCaseNotes] = useState([]);
  const [noteText, setNoteText] = useState('');
  const [filterStaff, setFilterStaff] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  useDirtyGuard(showModal);
  const home = getCurrentHome();

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const filters = {};
      if (filterStaff) filters.staffId = filterStaff;
      if (filterStatus) filters.status = filterStatus;
      const data = await getHrDisciplinary(home, filters);
      setCases(Array.isArray(data) ? data : []);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [home, filterStaff, filterStatus]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!showModal) return;
    const handler = e => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showModal]);

  function openCreate() {
    setEditing(null);
    setForm({ date_raised: new Date().toISOString().slice(0, 10), category: 'misconduct', status: 'open' });
    setModalTab('details');
    setCaseNotes([]);
    setNoteText('');
    setShowModal(true);
  }

  async function openEdit(c) {
    setEditing(c);
    setForm({ ...c });
    setModalTab('details');
    setNoteText('');
    if (c.id) {
      try { setCaseNotes(await getHrCaseNotes('disciplinary', c.id)); }
      catch { setCaseNotes([]); }
    }
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditing(null);
    setForm({});
    setCaseNotes([]);
    setNoteText('');
  }

  async function handleSave() {
    setError(null);
    if (!form.staff_id || !form.date_raised || !form.category) return;
    try {
      if (editing?.id) {
        await updateHrDisciplinary(editing.id, form);
      } else {
        await createHrDisciplinary(home, form);
      }
      closeModal();
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleAddNote() {
    if (!noteText.trim() || !editing?.id) return;
    try {
      await createHrCaseNote(home, 'disciplinary', editing.id, { note: noteText.trim() });
      setCaseNotes(await getHrCaseNotes('disciplinary', editing.id));
      setNoteText('');
    } catch (e) { setError(e.message); }
  }

  async function handleExport() {
    const { downloadXLSX } = await import('../lib/excel.js');
    downloadXLSX('disciplinary_cases', [{
      name: 'Disciplinary',
      headers: ['Staff ID', 'Date Raised', 'Category', 'Status', 'Outcome', 'Raised By', 'Source'],
      rows: cases.map(c => [
        c.staff_id, c.date_raised,
        DISCIPLINARY_CATEGORIES.find(cat => cat.id === c.category)?.name || c.category,
        DISCIPLINARY_STATUSES.find(s => s.id === c.status)?.name || c.status,
        DISCIPLINARY_OUTCOMES.find(o => o.id === c.outcome)?.name || c.outcome || '',
        c.raised_by || '', c.source || '',
      ]),
    }]);
  }

  function clearFilters() {
    setFilterStaff('');
    setFilterStatus('');
  }

  const f = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  if (loading) return <div className={PAGE.container}><div className={CARD.padded}><p className="text-center py-10 text-gray-500">Loading disciplinary cases...</p></div></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Disciplinary Tracker</h1>
          <p className={PAGE.subtitle}>ACAS-compliant disciplinary case management</p>
        </div>
        <div className="flex gap-2">
          <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleExport}>Export Excel</button>
          <button className={BTN.primary + ' ' + BTN.sm} onClick={openCreate}>New Case</button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <StaffPicker value={filterStaff} onChange={setFilterStaff} showAll showInactive small />
        <div>
          <label className={INPUT.label}>Status</label>
          <select className={INPUT.select + ' py-1.5 text-sm'} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All</option>
            {DISCIPLINARY_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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
                <th className={TABLE.th}>Status</th>
                <th className={TABLE.th}>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {cases.length === 0 && <tr><td colSpan={5} className={TABLE.empty}>No disciplinary cases</td></tr>}
              {cases.map(c => (
                <tr key={c.id} className={TABLE.tr + ' cursor-pointer'} onClick={() => openEdit(c)}>
                  <td className={TABLE.tdMono}>{c.staff_id}</td>
                  <td className={TABLE.td}>{c.date_raised}</td>
                  <td className={TABLE.td}>{DISCIPLINARY_CATEGORIES.find(cat => cat.id === c.category)?.name || c.category}</td>
                  <td className={TABLE.td}>
                    <span className={BADGE[getStatusBadge(c.status, DISCIPLINARY_STATUSES)]}>
                      {DISCIPLINARY_STATUSES.find(s => s.id === c.status)?.name || c.status}
                    </span>
                  </td>
                  <td className={TABLE.td}>
                    {c.outcome
                      ? DISCIPLINARY_OUTCOMES.find(o => o.id === c.outcome)?.name || c.outcome
                      : '—'}
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
      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Disciplinary Case' : 'New Disciplinary Case'} size="xl">
          {/* Modal tabs */}
          <div className="flex gap-1 mb-4 border-b border-gray-200 overflow-x-auto">
            {MODAL_TABS.map(t => {
              if (t.id === 'notes' && !editing) return null;
              return (
                <button key={t.id} onClick={() => setModalTab(t.id)}
                  className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                    modalTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}>{t.label}</button>
              );
            })}
          </div>

          {modalTab === 'details' && renderDetailsTab()}
          {modalTab === 'investigation' && renderInvestigationTab()}
          {modalTab === 'hearing' && renderHearingTab()}
          {modalTab === 'outcome' && renderOutcomeTab()}
          {modalTab === 'appeal' && renderAppealTab()}
          {modalTab === 'notes' && renderNotesTab()}

          <div className={MODAL.footer}>
            <button className={BTN.secondary} onClick={closeModal}>Cancel</button>
            <button className={BTN.primary} onClick={handleSave}>{editing ? 'Update' : 'Create'}</button>
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
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Category</label>
            <select className={INPUT.select} value={form.category || ''} onChange={e => f('category', e.target.value)}>
              <option value="">Select...</option>
              {DISCIPLINARY_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Status</label>
            <select className={INPUT.select} value={form.status || 'open'} onChange={e => f('status', e.target.value)}>
              {DISCIPLINARY_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Allegation Summary</label>
          <textarea className={INPUT.base} rows={3} value={form.allegation_summary || ''} onChange={e => f('allegation_summary', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Raised By</label>
            <input className={INPUT.base} value={form.raised_by || ''} onChange={e => f('raised_by', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Source</label>
            <input className={INPUT.base} value={form.source || ''} onChange={e => f('source', e.target.value)} placeholder="e.g. complaint, incident" />
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
            <label className={INPUT.label}>Investigation Status</label>
            <input className={INPUT.base} value={form.investigation_status || ''} onChange={e => f('investigation_status', e.target.value)} placeholder="e.g. pending, in_progress, complete" />
          </div>
          <div>
            <label className={INPUT.label}>Investigation Officer</label>
            <input className={INPUT.base} value={form.investigation_officer || ''} onChange={e => f('investigation_officer', e.target.value)} />
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Investigation Start Date</label>
          <input type="date" className={INPUT.base} value={form.investigation_start_date || ''} onChange={e => f('investigation_start_date', e.target.value)} />
        </div>
        <div>
          <label className={INPUT.label}>Investigation Notes</label>
          <textarea className={INPUT.base} rows={3} value={form.investigation_notes || ''} onChange={e => f('investigation_notes', e.target.value)} />
        </div>
        <div>
          <label className={INPUT.label}>Witnesses (JSON)</label>
          <textarea className={INPUT.base + ' font-mono text-xs'} rows={3}
            value={form.witnesses ? (typeof form.witnesses === 'string' ? form.witnesses : JSON.stringify(form.witnesses, null, 2)) : ''}
            onChange={e => f('witnesses', e.target.value)} placeholder='[{"name":"...","role":"..."}]' />
        </div>
        <div>
          <label className={INPUT.label}>Evidence Items (JSON)</label>
          <textarea className={INPUT.base + ' font-mono text-xs'} rows={3}
            value={form.evidence_items ? (typeof form.evidence_items === 'string' ? form.evidence_items : JSON.stringify(form.evidence_items, null, 2)) : ''}
            onChange={e => f('evidence_items', e.target.value)} placeholder='[{"description":"...","type":"..."}]' />
        </div>
        <InvestigationMeetings caseType="disciplinary" caseId={editing?.id} />
        <FileAttachments caseType="disciplinary" caseId={editing?.id} />
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
            <label className={INPUT.label}>Hearing Time</label>
            <input type="time" className={INPUT.base} value={form.hearing_time || ''} onChange={e => f('hearing_time', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Hearing Location</label>
            <input className={INPUT.base} value={form.hearing_location || ''} onChange={e => f('hearing_location', e.target.value)} />
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
            <select className={INPUT.select} value={form.outcome || ''} onChange={e => f('outcome', e.target.value)}>
              <option value="">Select...</option>
              {DISCIPLINARY_OUTCOMES.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Outcome Date</label>
            <input type="date" className={INPUT.base} value={form.outcome_date || ''} onChange={e => f('outcome_date', e.target.value)} />
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Warning Expiry Date</label>
          <input type="date" className={INPUT.base} value={form.warning_expiry_date || ''} onChange={e => f('warning_expiry_date', e.target.value)} />
        </div>
        <div>
          <label className={INPUT.label}>Outcome Notes</label>
          <textarea className={INPUT.base} rows={3} value={form.outcome_reason || ''} onChange={e => f('outcome_reason', e.target.value)} />
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

  function renderNotesTab() {
    return (
      <div className="space-y-4">
        <div className="space-y-3 max-h-60 overflow-y-auto">
          {caseNotes.length === 0 && <p className="text-sm text-gray-400">No case notes yet</p>}
          {caseNotes.map(n => (
            <div key={n.id} className="border border-gray-100 rounded-lg p-3">
              <p className="text-sm text-gray-800">{n.content}</p>
              <p className="text-xs text-gray-400 mt-1">
                {n.created_by || 'System'} — {n.created_at ? new Date(n.created_at).toLocaleString() : ''}
              </p>
            </div>
          ))}
        </div>
        <div>
          <label className={INPUT.label}>Add Note</label>
          <textarea className={INPUT.base} rows={2} value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Type a case note..." />
        </div>
        <button className={BTN.primary + ' ' + BTN.sm} onClick={handleAddNote} disabled={!noteText.trim()}>Add Note</button>
        <FileAttachments caseType="disciplinary" caseId={editing?.id} />
      </div>
    );
  }
}
