import { useState, useEffect, useRef } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import Modal from '../components/Modal.jsx';
import TabBar from '../components/TabBar.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import RepeatableRowsEditor from '../components/RepeatableRowsEditor.jsx';
import {
  getCurrentHome, getHrDisciplinary, createHrDisciplinary, updateHrDisciplinary,
  getHrCaseNotes, createHrCaseNote,
} from '../lib/api.js';
import {
  DISCIPLINARY_CATEGORIES, DISCIPLINARY_STATUSES, DISCIPLINARY_OUTCOMES,
  DISCIPLINARY_SOURCES, INVESTIGATION_STATUSES, INVESTIGATION_RECOMMENDATIONS,
  HEARING_STATUSES, APPEAL_STATUSES, APPEAL_OUTCOMES, OUTCOME_LETTER_METHODS,
  CLOSED_REASONS, COMPANION_ROLES,
  getStatusBadge,
} from '../lib/hr.js';
import Pagination from '../components/Pagination.jsx';
import StaffPicker from '../components/StaffPicker.jsx';
import FileAttachments from '../components/FileAttachments.jsx';
import InvestigationMeetings from '../components/InvestigationMeetings.jsx';
import { clickableRowProps } from '../lib/a11y.js';
import { useData } from '../contexts/DataContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { todayLocalISO } from '../lib/localDates.js';

const MODAL_TABS = [
  { id: 'details', label: 'Details' },
  { id: 'investigation', label: 'Investigation' },
  { id: 'suspension', label: 'Suspension' },
  { id: 'hearing', label: 'Hearing' },
  { id: 'outcome', label: 'Outcome' },
  { id: 'appeal', label: 'Appeal' },
  { id: 'notes', label: 'Notes' },
];

const WITNESS_COLUMNS = [
  { key: 'name', label: 'Name', placeholder: 'Witness name' },
  { key: 'role', label: 'Role', placeholder: 'Role or relationship' },
  { key: 'statement_summary', label: 'Statement Summary', type: 'textarea', rows: 2, fullWidth: true, placeholder: 'Key points from the witness statement' },
];

const EVIDENCE_COLUMNS = [
  { key: 'description', label: 'Description', type: 'textarea', rows: 2, fullWidth: true, placeholder: 'What evidence was reviewed?' },
  { key: 'type', label: 'Type', placeholder: 'Document, CCTV, rota, statement...' },
  { key: 'date', label: 'Date', type: 'date' },
];

function toStructuredRows(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function compactStructuredRows(rows, allowedKeys) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => Object.fromEntries(
      allowedKeys
        .map((key) => {
          const value = row?.[key];
          const cleaned = typeof value === 'string' ? value.trim() : value;
          return [key, cleaned];
        })
        .filter(([, value]) => value != null && value !== '')
    ))
    .filter((row) => Object.keys(row).length > 0);
}

export default function DisciplinaryTracker() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState(null);
  const [modalError, setModalError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [modalTab, setModalTab] = useState('details');
  const [caseNotes, setCaseNotes] = useState([]);
  const [noteText, setNoteText] = useState('');
  const [filterStaff, setFilterStaff] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  useDirtyGuard(showModal);
  const home = getCurrentHome();
  const { canWrite } = useData();
  const { showToast } = useToast();
  const canEdit = canWrite('hr');
  const editReqRef = useRef(0);
  useEffect(() => setOffset(0), [filterStaff, filterStatus]);

  const LIMIT = 50;

  useEffect(() => {
    let stale = false;
    (async () => {
      if (!home) return;
      setLoading(true);
      try {
        const filters = { limit: LIMIT, offset };
        if (filterStaff) filters.staffId = filterStaff;
        if (filterStatus) filters.status = filterStatus;
        const res = await getHrDisciplinary(home, filters);
        if (!stale) { setCases(res?.rows || []); setTotal(res?.total || 0); setPageError(null); }
      } catch (e) { if (!stale) setPageError(e.message); }
      finally { if (!stale) setLoading(false); }
    })();
    return () => { stale = true; };
  }, [home, filterStaff, filterStatus, refreshKey, offset]);

  function openCreate() {
    setEditing(null);
    setForm({
      date_raised: todayLocalISO(),
      category: 'misconduct',
      status: 'open',
      source: 'other',
      witnesses: [],
      evidence_items: [],
    });
    setModalTab('details');
    setCaseNotes([]);
    setNoteText('');
    setModalError(null);
    setShowModal(true);
  }

  async function openEdit(c) {
    const reqId = ++editReqRef.current;
    setEditing(c);
    setForm({
      ...c,
      witnesses: toStructuredRows(c.witnesses),
      evidence_items: toStructuredRows(c.evidence_items),
    });
    setModalTab('details');
    setNoteText('');
    setCaseNotes([]);
    setModalError(null);
    setShowModal(true);
    if (c.id) {
      try {
        const notes = await getHrCaseNotes(home, 'disciplinary', c.id);
        if (editReqRef.current === reqId) setCaseNotes(notes);
      } catch { if (editReqRef.current === reqId) setCaseNotes([]); }
    }
  }

  function closeModal() {
    setShowModal(false);
    setEditing(null);
    setForm({});
    setCaseNotes([]);
    setNoteText('');
    setModalError(null);
  }

  async function handleSave() {
    setModalError(null);
    const missing = [];
    if (!form.staff_id) missing.push('Staff member');
    if (!form.date_raised) missing.push('Date raised');
    if (!form.category) missing.push('Category');
    if (!form.raised_by?.trim()) missing.push('Raised by');
    if (missing.length) { setModalError(`Required fields missing: ${missing.join(', ')}`); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        witnesses: compactStructuredRows(form.witnesses, ['name', 'role', 'statement_summary']),
        evidence_items: compactStructuredRows(form.evidence_items, ['description', 'type', 'date']),
      };
      if (editing?.id) {
        await updateHrDisciplinary(editing.id, { ...payload, _version: editing.version });
        showToast({ title: 'Disciplinary case updated', message: `${form.staff_id} - ${form.category}` });
      } else {
        await createHrDisciplinary(home, payload);
        showToast({ title: 'Disciplinary case created', message: `${form.staff_id} - ${form.category}` });
      }
      closeModal();
      setRefreshKey(k => k + 1);
    } catch (e) {
      if (e.message?.includes('modified by another user')) {
        setModalError('This record was modified by another user. Please close and reopen to get the latest version.');
        setRefreshKey(k => k + 1);
      } else { setModalError(e.message); }
    }
    finally { setSaving(false); }
  }

  async function handleAddNote() {
    if (!noteText.trim() || !editing?.id || saving) return;
    setSaving(true);
    try {
      await createHrCaseNote(home, 'disciplinary', editing.id, { note: noteText.trim() });
      setCaseNotes(await getHrCaseNotes(home, 'disciplinary', editing.id));
      setNoteText('');
      showToast({ title: 'Case note added', message: 'The note is now part of the disciplinary record.' });
    } catch (e) { setModalError(e.message); }
    finally { setSaving(false); }
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
    showToast({ title: 'Excel export started', message: 'The disciplinary tracker workbook is downloading.' });
  }

  function clearFilters() {
    setFilterStaff('');
    setFilterStatus('');
  }

  const f = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  if (loading) {
    return (
      <div className={PAGE.container}>
        <LoadingState message="Loading disciplinary cases..." card />
      </div>
    );
  }

  if (pageError && cases.length === 0) {
    return (
      <div className={PAGE.container}>
        <div className={PAGE.header}>
          <div>
            <h1 className={PAGE.title}>Disciplinary Tracker</h1>
            <p className={PAGE.subtitle}>ACAS-compliant disciplinary case management</p>
          </div>
        </div>
        <ErrorState
          title="Disciplinary tracker needs attention"
          message={pageError}
          onRetry={() => setRefreshKey((value) => value + 1)}
        />
      </div>
    );
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Disciplinary Tracker</h1>
          <p className={PAGE.subtitle}>ACAS-compliant disciplinary case management</p>
        </div>
        <div className="flex gap-2">
          <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleExport}>Export Excel</button>
          {canEdit && <button className={BTN.primary + ' ' + BTN.sm} onClick={openCreate}>New Case</button>}
        </div>
      </div>

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

      {pageError && (
        <ErrorState
          title="Disciplinary action needs attention"
          message={pageError}
          onRetry={() => setRefreshKey((value) => value + 1)}
          className="mb-4"
        />
      )}

      {/* Table */}
      {cases.length === 0 ? (
        <div className={CARD.padded}>
          <EmptyState
            title="No disciplinary cases"
            description={canEdit ? 'Start the first disciplinary case to capture the allegation, investigation, hearings, and outcomes in one place.' : 'Disciplinary cases will appear here once they are recorded.'}
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
                  <th scope="col" className={TABLE.th}>Status</th>
                  <th scope="col" className={TABLE.th}>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {cases.map(c => (
                <tr key={c.id} className={`${TABLE.tr}${canEdit ? ' cursor-pointer' : ''}`} {...clickableRowProps(() => canEdit && openEdit(c))}>
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
                      : '-'}
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Pagination total={total} limit={LIMIT} offset={offset} onChange={setOffset} />

      {/* Modal */}
      {showModal && renderModal()}
    </div>
  );

  function renderModal() {
    return (
      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Disciplinary Case' : 'New Disciplinary Case'} size="xl">
          {/* Modal tabs */}
          <TabBar tabs={editing ? MODAL_TABS : MODAL_TABS.filter(t => t.id !== 'notes')} activeTab={modalTab} onTabChange={setModalTab} />

          <InlineNotice variant="info" className="mb-4">
            Save the case details first, then keep the investigation, evidence, hearings, and notes together here as the case progresses.
          </InlineNotice>
          {modalError && <ErrorState title="This disciplinary case needs attention" message={modalError} className="mb-4" />}

          {modalTab === 'details' && renderDetailsTab()}
          {modalTab === 'investigation' && renderInvestigationTab()}
          {modalTab === 'suspension' && renderSuspensionTab()}
          {modalTab === 'hearing' && renderHearingTab()}
          {modalTab === 'outcome' && renderOutcomeTab()}
          {modalTab === 'appeal' && renderAppealTab()}
          {modalTab === 'notes' && renderNotesTab()}

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
            <label className={INPUT.label}>Raised By *</label>
            <input className={INPUT.base} value={form.raised_by || ''} onChange={e => f('raised_by', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Source</label>
            <select className={INPUT.select} value={form.source || 'other'} onChange={e => f('source', e.target.value)}>
              {DISCIPLINARY_SOURCES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
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
            <select className={INPUT.select} value={form.investigation_status || 'not_started'} onChange={e => f('investigation_status', e.target.value)}>
              {INVESTIGATION_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Investigation Officer</label>
            <input className={INPUT.base} value={form.investigation_officer || ''} onChange={e => f('investigation_officer', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Start Date</label>
            <input type="date" className={INPUT.base} value={form.investigation_start_date || ''} onChange={e => f('investigation_start_date', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Completed Date</label>
            <input type="date" className={INPUT.base} value={form.investigation_completed_date || ''} onChange={e => f('investigation_completed_date', e.target.value)} />
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Investigation Notes</label>
          <textarea className={INPUT.base} rows={3} value={form.investigation_notes || ''} onChange={e => f('investigation_notes', e.target.value)} />
        </div>
        <div>
          <label className={INPUT.label}>Findings</label>
          <textarea className={INPUT.base} rows={3} value={form.investigation_findings || ''} onChange={e => f('investigation_findings', e.target.value)} />
        </div>
        <div>
          <label className={INPUT.label}>Recommendation</label>
          <select className={INPUT.select} value={form.investigation_recommendation || ''} onChange={e => f('investigation_recommendation', e.target.value || null)}>
            <option value="">Select...</option>
            {INVESTIGATION_RECOMMENDATIONS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <RepeatableRowsEditor
          title="Witness"
          description="Capture each witness separately so the case record stays readable and exportable."
          rows={Array.isArray(form.witnesses) ? form.witnesses : []}
          onChange={(rows) => f('witnesses', rows)}
          columns={WITNESS_COLUMNS}
          addLabel="Add witness"
          emptyTitle="No witnesses captured yet"
          emptyDescription="Add each witness with their role and a short statement summary instead of pasting raw JSON."
        />
        <RepeatableRowsEditor
          title="Evidence Item"
          description="Track the documents, recordings, or other material reviewed during the investigation."
          rows={Array.isArray(form.evidence_items) ? form.evidence_items : []}
          onChange={(rows) => f('evidence_items', rows)}
          columns={EVIDENCE_COLUMNS}
          addLabel="Add evidence item"
          emptyTitle="No evidence items listed yet"
          emptyDescription="Add each supporting item so the investigation record is easy to follow for managers and auditors."
        />
        <InvestigationMeetings caseType="disciplinary" caseId={editing?.id} />
        <FileAttachments caseType="disciplinary" caseId={editing?.id} />
      </div>
    );
  }

  function renderSuspensionTab() {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={!!form.suspended} onChange={e => f('suspended', e.target.checked)} />
          <label className="text-sm font-medium text-gray-700">Staff member suspended</label>
        </div>
        {form.suspended && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={INPUT.label}>Suspension Date</label>
                <input type="date" className={INPUT.base} value={form.suspension_date || ''} onChange={e => f('suspension_date', e.target.value)} />
              </div>
              <div>
                <label className={INPUT.label}>Review Date</label>
                <input type="date" className={INPUT.base} value={form.suspension_review_date || ''} onChange={e => f('suspension_review_date', e.target.value)} />
              </div>
            </div>
            <div>
              <label className={INPUT.label}>Suspension Reason</label>
              <textarea className={INPUT.base} rows={2} value={form.suspension_reason || ''} onChange={e => f('suspension_reason', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={INPUT.label}>End Date</label>
                <input type="date" className={INPUT.base} value={form.suspension_end_date || ''} onChange={e => f('suspension_end_date', e.target.value)} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input type="checkbox" checked={form.suspension_on_full_pay !== false} onChange={e => f('suspension_on_full_pay', e.target.checked)} />
                <label className="text-sm text-gray-700">On Full Pay</label>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  function renderHearingTab() {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Hearing Status</label>
            <select className={INPUT.select} value={form.hearing_status || 'not_scheduled'} onChange={e => f('hearing_status', e.target.value)}>
              {HEARING_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Letter Sent Date</label>
            <input type="date" className={INPUT.base} value={form.hearing_letter_sent_date || ''} onChange={e => f('hearing_letter_sent_date', e.target.value)} />
          </div>
        </div>
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
            <label className={INPUT.label}>Location</label>
            <input className={INPUT.base} value={form.hearing_location || ''} onChange={e => f('hearing_location', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Chair</label>
            <input className={INPUT.base} value={form.hearing_chair || ''} onChange={e => f('hearing_chair', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Companion Name</label>
            <input className={INPUT.base} value={form.hearing_companion_name || ''} onChange={e => f('hearing_companion_name', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Companion Role</label>
            <select className={INPUT.select} value={form.hearing_companion_role || ''} onChange={e => f('hearing_companion_role', e.target.value || null)}>
              <option value="">Select...</option>
              {COMPANION_ROLES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Hearing Notes</label>
          <textarea className={INPUT.base} rows={3} value={form.hearing_notes || ''} onChange={e => f('hearing_notes', e.target.value)} />
        </div>
        <div>
          <label className={INPUT.label}>Employee Response</label>
          <textarea className={INPUT.base} rows={3} value={form.hearing_employee_response || ''} onChange={e => f('hearing_employee_response', e.target.value)} />
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
            <select className={INPUT.select} value={form.outcome || ''} onChange={e => f('outcome', e.target.value || null)}>
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
          <label className={INPUT.label}>Outcome Reason</label>
          <textarea className={INPUT.base} rows={3} value={form.outcome_reason || ''} onChange={e => f('outcome_reason', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Letter Sent Date</label>
            <input type="date" className={INPUT.base} value={form.outcome_letter_sent_date || ''} onChange={e => f('outcome_letter_sent_date', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Letter Method</label>
            <select className={INPUT.select} value={form.outcome_letter_method || ''} onChange={e => f('outcome_letter_method', e.target.value || null)}>
              <option value="">Select...</option>
              {OUTCOME_LETTER_METHODS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Warning Expiry Date</label>
          <input type="date" className={INPUT.base} value={form.warning_expiry_date || ''} onChange={e => f('warning_expiry_date', e.target.value)} />
        </div>
        {(form.outcome === 'dismissal') && (
          <div className="border-t border-gray-200 pt-4 space-y-4">
            <h4 className="text-sm font-medium text-gray-700">Dismissal Details</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={INPUT.label}>Notice Period Start</label>
                <input type="date" className={INPUT.base} value={form.notice_period_start || ''} onChange={e => f('notice_period_start', e.target.value)} />
              </div>
              <div>
                <label className={INPUT.label}>Notice Period End</label>
                <input type="date" className={INPUT.base} value={form.notice_period_end || ''} onChange={e => f('notice_period_end', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={INPUT.label}>Dismissal Effective Date</label>
                <input type="date" className={INPUT.base} value={form.dismissal_effective_date || ''} onChange={e => f('dismissal_effective_date', e.target.value)} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input type="checkbox" checked={!!form.pay_in_lieu_of_notice} onChange={e => f('pay_in_lieu_of_notice', e.target.checked)} />
                <label className="text-sm text-gray-700">Pay in Lieu of Notice</label>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderAppealTab() {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Appeal Status</label>
            <select className={INPUT.select} value={form.appeal_status || 'none'} onChange={e => f('appeal_status', e.target.value)}>
              {APPEAL_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Received Date</label>
            <input type="date" className={INPUT.base} value={form.appeal_received_date || ''} onChange={e => f('appeal_received_date', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Appeal Deadline</label>
            <input type="date" className={INPUT.base} value={form.appeal_deadline || ''} onChange={e => f('appeal_deadline', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Appeal Hearing Date</label>
            <input type="date" className={INPUT.base} value={form.appeal_hearing_date || ''} onChange={e => f('appeal_hearing_date', e.target.value)} />
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Appeal Grounds</label>
          <textarea className={INPUT.base} rows={3} value={form.appeal_grounds || ''} onChange={e => f('appeal_grounds', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Appeal Chair</label>
            <input className={INPUT.base} value={form.appeal_hearing_chair || ''} onChange={e => f('appeal_hearing_chair', e.target.value)} />
          </div>
          <div>
            <label className={INPUT.label}>Appeal Companion</label>
            <input className={INPUT.base} value={form.appeal_hearing_companion_name || ''} onChange={e => f('appeal_hearing_companion_name', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={INPUT.label}>Appeal Outcome</label>
            <select className={INPUT.select} value={form.appeal_outcome || ''} onChange={e => f('appeal_outcome', e.target.value || null)}>
              <option value="">Select...</option>
              {APPEAL_OUTCOMES.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Outcome Date</label>
            <input type="date" className={INPUT.base} value={form.appeal_outcome_date || ''} onChange={e => f('appeal_outcome_date', e.target.value)} />
          </div>
        </div>
        <div>
          <label className={INPUT.label}>Outcome Reason</label>
          <textarea className={INPUT.base} rows={2} value={form.appeal_outcome_reason || ''} onChange={e => f('appeal_outcome_reason', e.target.value)} />
        </div>
      </div>
    );
  }

  function renderNotesTab() {
    return (
      <div className="space-y-4">
        <div className="space-y-3 max-h-60 overflow-y-auto">
          {caseNotes.length === 0 && (
            <EmptyState
              title="No case notes yet"
              description="Add investigation updates, manager decisions, and key case history here."
              compact
            />
          )}
          {caseNotes.map(n => (
            <div key={n.id} className="border border-gray-100 rounded-lg p-3">
              <p className="text-sm text-gray-800">{n.content}</p>
              <p className="text-xs text-gray-400 mt-1">
                {n.author || 'System'} - {n.created_at ? new Date(n.created_at).toLocaleString('en-GB') : ''}
              </p>
            </div>
          ))}
        </div>
        <div>
          <label className={INPUT.label}>Add Note</label>
          <textarea className={INPUT.base} rows={2} value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Type a case note..." />
        </div>
        <button className={BTN.primary + ' ' + BTN.sm} onClick={handleAddNote} disabled={!noteText.trim() || saving}>{saving ? 'Adding...' : 'Add Note'}</button>
        <FileAttachments caseType="disciplinary" caseId={editing?.id} />
      </div>
    );
  }
}
