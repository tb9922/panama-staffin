import { useState, useEffect, useCallback, useId } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import Modal from '../components/Modal.jsx';
import { getCurrentHome, getHrFlexWorking, createHrFlexWorking, updateHrFlexWorking } from '../lib/api.js';
import { FLEX_WORKING_STATUSES, FLEX_REFUSAL_REASONS, getStatusBadge } from '../lib/hr.js';
import StaffPicker from '../components/StaffPicker.jsx';
import FileAttachments from '../components/FileAttachments.jsx';
import Pagination from '../components/Pagination.jsx';
import { useData } from '../contexts/DataContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import LoadingState from '../components/LoadingState.jsx';
import useTransientNotice from '../hooks/useTransientNotice.js';
import { todayLocalISO, parseLocalDate } from '../lib/localDates.js';

const DECISION_OPTIONS = [
  { id: '', name: '— Not decided —' },
  { id: 'approved', name: 'Approved' },
  { id: 'approved_modified', name: 'Approved (Modified)' },
  { id: 'refused', name: 'Refused' },
  { id: 'withdrawn', name: 'Withdrawn' },
];

function statusName(id) {
  return FLEX_WORKING_STATUSES.find(s => s.id === id)?.name || id;
}

function isOverdue(item) {
  if (!item.decision_deadline) return false;
  if (item.status !== 'pending' && item.status !== 'meeting_scheduled') return false;
  return item.decision_deadline < todayLocalISO();
}

const blankForm = () => ({
  staff_id: '', request_date: todayLocalISO(),
  requested_change: '', decision_deadline: '', status: 'pending',
  reason: '', current_pattern: '', effective_date_requested: '',
  employee_assessment_of_impact: '', meeting_date: '', meeting_notes: '',
  decision: '', decision_date: '', decision_by: '',
  refusal_reason: '', refusal_explanation: '',
  approved_pattern: '', approved_effective_date: '',
  trial_period: false, trial_period_end: '',
  appeal_date: '', appeal_grounds: '', appeal_outcome: '', appeal_outcome_date: '',
  notes: '',
});

export default function FlexWorkingTracker() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  // Filters
  const [filterStaff, setFilterStaff] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const home = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('hr');
  const requestDateId = useId();
  const requestedChangeId = useId();
  const requestReasonId = useId();
  const currentPatternId = useId();
  const effectiveDateRequestedId = useId();
  const employeeImpactId = useId();
  const decisionDeadlineId = useId();
  const requestStatusId = useId();
  const meetingDateId = useId();
  const decisionById = useId();
  const meetingNotesId = useId();
  const decisionId = useId();
  const decisionDateId = useId();
  const refusalReasonId = useId();
  const refusalExplanationId = useId();
  const approvedPatternId = useId();
  const approvedEffectiveDateId = useId();
  const trialPeriodId = useId();
  const trialPeriodEndId = useId();
  const appealDateId = useId();
  const appealGroundsId = useId();
  const appealOutcomeId = useId();
  const appealOutcomeDateId = useId();
  const flexNotesId = useId();
  const { notice, showNotice, clearNotice } = useTransientNotice();
  useDirtyGuard(showModal);

  const LIMIT = 50;

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const filters = { limit: LIMIT, offset };
      if (filterStaff) filters.staffId = filterStaff;
      if (filterStatus) filters.status = filterStatus;
      const res = await getHrFlexWorking(home, filters);
      setItems(res?.rows || []);
      setTotal(res?.total || 0);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [home, filterStaff, filterStatus, offset]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setOffset(0); }, [filterStaff, filterStatus]);

  function closeModal() {
    setShowModal(false);
    setEditing(null);
    setForm(blankForm());
    setFormError('');
  }

  function openNew() {
    setEditing(null);
    const today = todayLocalISO();
    // ERA 2025: employer must decide within 2 months
    // Clamp day to avoid month overflow (e.g. Dec 31 + 2 months → Feb 28, not Mar 3)
    const deadline = parseLocalDate(today);
    const requestDay = deadline.getDate();
    deadline.setDate(1);
    deadline.setMonth(deadline.getMonth() + 2);
    const lastDay = new Date(deadline.getFullYear(), deadline.getMonth() + 1, 0).getDate();
    deadline.setDate(Math.min(requestDay, lastDay));
    setForm({ ...blankForm(), request_date: today, decision_deadline: todayLocalISO(deadline) });
    setShowModal(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({
      staff_id: item.staff_id || '',
      request_date: item.request_date || '',
      requested_change: item.requested_change || '',
      decision_deadline: item.decision_deadline || '',
      status: item.status || 'pending',
      reason: item.reason || '',
      current_pattern: item.current_pattern || '',
      effective_date_requested: item.effective_date_requested || '',
      employee_assessment_of_impact: item.employee_assessment_of_impact || '',
      meeting_date: item.meeting_date || '',
      meeting_notes: item.meeting_notes || '',
      decision: item.decision || '',
      decision_date: item.decision_date || '',
      decision_by: item.decision_by || '',
      refusal_reason: item.refusal_reason || '',
      refusal_explanation: item.refusal_explanation || '',
      approved_pattern: item.approved_pattern || '',
      approved_effective_date: item.approved_effective_date || '',
      trial_period: item.trial_period ?? false,
      trial_period_end: item.trial_period_end || '',
      appeal_date: item.appeal_date || '',
      appeal_grounds: item.appeal_grounds || '',
      appeal_outcome: item.appeal_outcome || '',
      appeal_outcome_date: item.appeal_outcome_date || '',
      notes: item.notes || '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    setFormError('');
    setError(null);
    if (!form.staff_id) { setFormError('Staff member is required'); return; }
    if (!form.request_date) { setFormError('Request date is required'); return; }
    if (!form.requested_change) { setFormError('Requested change is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        trial_period: !!form.trial_period,
      };
      if (payload.decision === 'withdrawn' || payload.status === 'withdrawn') {
        payload.decision = 'withdrawn';
        payload.status = 'withdrawn';
      }
      if (editing) {
        await updateHrFlexWorking(editing.id, { ...payload, _version: editing.version });
      } else {
        await createHrFlexWorking(home, payload);
      }
      showNotice(editing ? `Request ${editing.id} updated.` : 'Flexible working request created.');
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
    downloadXLSX('flexible_working', [{
      name: 'Flexible Working',
      headers: ['Staff ID', 'Request Date', 'Requested Change', 'Decision Deadline', 'Status', 'Decision', 'Decision Date', 'Notes'],
      rows: items.map(i => [
        i.staff_id, i.request_date || '', i.requested_change || '', i.decision_deadline || '',
        statusName(i.status), i.decision || '', i.decision_date || '', i.notes || '',
      ]),
    }]);
    showNotice(`Exported ${items.length} flexible working request${items.length === 1 ? '' : 's'}.`);
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading flexible working data..." card /></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Flexible Working Requests</h1>
          <p className={PAGE.subtitle}>ERA 2025 day-one right — employer must decide within 2 months of request</p>
        </div>
        <div className="flex gap-2">
          <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleExport}>Export Excel</button>
          {canEdit && <button className={BTN.primary + ' ' + BTN.sm} onClick={openNew}>New Request</button>}
        </div>
      </div>

      {notice && (
        <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">
          {notice.content}
        </InlineNotice>
      )}

      {error && <ErrorState title="Unable to load flexible working requests" message={error} onRetry={load} className="mb-4" />}

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <StaffPicker value={filterStaff} onChange={setFilterStaff} showAll showInactive small />
        <select className={INPUT.select + ' max-w-[200px]'} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {FLEX_WORKING_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Staff ID</th>
                <th scope="col" className={TABLE.th}>Request Date</th>
                <th scope="col" className={TABLE.th}>Requested Change</th>
                <th scope="col" className={TABLE.th}>Decision Deadline</th>
                <th scope="col" className={TABLE.th}>Status</th>
                <th scope="col" className={TABLE.th}>Decision</th>
                {canEdit && <th scope="col" className={TABLE.th}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className={TABLE.empty}>
                    <EmptyState
                      title="No flexible working requests"
                      description={canEdit ? 'Create the first request to track meetings, decisions, and appeals.' : 'Requests will appear here once they have been logged.'}
                      actionLabel={canEdit ? 'New Request' : undefined}
                      onAction={canEdit ? openNew : undefined}
                      compact
                    />
                  </td>
                </tr>
              )}
              {items.map(item => {
                const overdue = isOverdue(item);
                return (
                  <tr key={item.id} className={`${TABLE.tr} ${overdue ? 'bg-red-50' : ''}`}>
                    <td className={TABLE.td}>{item.staff_id}</td>
                    <td className={TABLE.td}>{item.request_date || '—'}</td>
                    <td className={TABLE.td}><span className="line-clamp-2 text-sm">{item.requested_change || '—'}</span></td>
                    <td className={TABLE.td}>
                      <span className={overdue ? 'text-red-600 font-semibold' : ''}>
                        {item.decision_deadline || '—'}
                        {overdue && ' (overdue)'}
                      </span>
                    </td>
                    <td className={TABLE.td}><span className={BADGE[getStatusBadge(item.status, FLEX_WORKING_STATUSES)]}>{statusName(item.status)}</span></td>
                    <td className={TABLE.td}>{DECISION_OPTIONS.find(d => d.id === item.decision)?.name || item.decision || '—'}</td>
                    {canEdit && <td className={TABLE.td}>
                      <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => openEdit(item)}>Edit</button>
                    </td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination total={total} limit={LIMIT} offset={offset} onChange={setOffset} />

      {/* Modal */}
      {showModal && (
        <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Flexible Working Request' : 'New Flexible Working Request'} size="xl">
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-4">
                <StaffPicker value={form.staff_id || ''} onChange={val => set('staff_id', val)} label="Staff Member" required />
                <div>
                  <label htmlFor={requestDateId} className={INPUT.label}>Request Date *</label>
                  <input id={requestDateId} type="date" className={INPUT.base} value={form.request_date} onChange={e => set('request_date', e.target.value)} />
                </div>
              </div>
              <div>
                <label htmlFor={requestedChangeId} className={INPUT.label}>Requested Change *</label>
                <textarea id={requestedChangeId} className={INPUT.base} rows={3} value={form.requested_change} onChange={e => set('requested_change', e.target.value)} placeholder="Describe the flexible working arrangement requested" />
              </div>
              <div>
                <label htmlFor={requestReasonId} className={INPUT.label}>Reason for Request</label>
                <textarea id={requestReasonId} className={INPUT.base} rows={2} value={form.reason} onChange={e => set('reason', e.target.value)} />
              </div>
              <div>
                <label htmlFor={currentPatternId} className={INPUT.label}>Current Pattern</label>
                <input id={currentPatternId} className={INPUT.base} value={form.current_pattern} onChange={e => set('current_pattern', e.target.value)} placeholder="e.g. Mon-Fri 9-5" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={effectiveDateRequestedId} className={INPUT.label}>Effective Date Requested</label>
                  <input id={effectiveDateRequestedId} type="date" className={INPUT.base} value={form.effective_date_requested} onChange={e => set('effective_date_requested', e.target.value)} />
                </div>
                <div>
                  <label htmlFor={decisionDeadlineId} className={INPUT.label}>Decision Deadline</label>
                  <input id={decisionDeadlineId} type="date" className={INPUT.base} value={form.decision_deadline} onChange={e => set('decision_deadline', e.target.value)} />
                </div>
              </div>
              <div>
                <label htmlFor={employeeImpactId} className={INPUT.label}>Employee Assessment of Impact</label>
                <textarea id={employeeImpactId} className={INPUT.base} rows={2} value={form.employee_assessment_of_impact} onChange={e => set('employee_assessment_of_impact', e.target.value)} placeholder="Employee's view on how the change would affect the service" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={requestStatusId} className={INPUT.label}>Status</label>
                  <select id={requestStatusId} className={INPUT.select} value={form.status} onChange={e => set('status', e.target.value)}>
                    {FLEX_WORKING_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              <hr className="border-gray-100" />
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Meeting</p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={meetingDateId} className={INPUT.label}>Meeting Date</label>
                  <input id={meetingDateId} type="date" className={INPUT.base} value={form.meeting_date} onChange={e => set('meeting_date', e.target.value)} />
                </div>
                <div>
                  <label htmlFor={decisionById} className={INPUT.label}>Decision By</label>
                  <input id={decisionById} className={INPUT.base} value={form.decision_by} onChange={e => set('decision_by', e.target.value)} />
                </div>
              </div>
              <div>
                <label htmlFor={meetingNotesId} className={INPUT.label}>Meeting Notes</label>
                <textarea id={meetingNotesId} className={INPUT.base} rows={3} value={form.meeting_notes} onChange={e => set('meeting_notes', e.target.value)} />
              </div>

              <hr className="border-gray-100" />
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Decision</p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={decisionId} className={INPUT.label}>Decision</label>
                  <select id={decisionId} className={INPUT.select} value={form.decision} onChange={e => set('decision', e.target.value)}>
                    {DECISION_OPTIONS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={decisionDateId} className={INPUT.label}>Decision Date</label>
                  <input id={decisionDateId} type="date" className={INPUT.base} value={form.decision_date} onChange={e => set('decision_date', e.target.value)} />
                </div>
              </div>

              {form.decision === 'refused' && (
                <>
                  <div>
                    <label htmlFor={refusalReasonId} className={INPUT.label}>Refusal Reason (statutory)</label>
                    <select id={refusalReasonId} className={INPUT.select} value={form.refusal_reason} onChange={e => set('refusal_reason', e.target.value)}>
                      <option value="">— Select reason —</option>
                      {FLEX_REFUSAL_REASONS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={refusalExplanationId} className={INPUT.label}>Refusal Explanation</label>
                    <textarea id={refusalExplanationId} className={INPUT.base} rows={3} value={form.refusal_explanation} onChange={e => set('refusal_explanation', e.target.value)} />
                  </div>
                </>
              )}

              {(form.decision === 'approved' || form.decision === 'approved_modified') && (
                <>
                  <div>
                    <label htmlFor={approvedPatternId} className={INPUT.label}>Approved Pattern</label>
                    <input id={approvedPatternId} className={INPUT.base} value={form.approved_pattern} onChange={e => set('approved_pattern', e.target.value)} placeholder="e.g. Mon-Wed 7am-3pm, Thu-Fri WFH" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor={approvedEffectiveDateId} className={INPUT.label}>Approved Effective Date</label>
                      <input id={approvedEffectiveDateId} type="date" className={INPUT.base} value={form.approved_effective_date} onChange={e => set('approved_effective_date', e.target.value)} />
                    </div>
                    <div className="flex items-center gap-2 pt-7">
                      <input id={trialPeriodId} type="checkbox" checked={form.trial_period} onChange={e => set('trial_period', e.target.checked)} />
                      <label htmlFor={trialPeriodId} className="text-sm text-gray-700">Trial Period Agreed</label>
                    </div>
                  </div>
                </>
              )}

              {(form.decision && form.decision !== 'refused') && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor={trialPeriodEndId} className={INPUT.label}>Trial Period End</label>
                    <input id={trialPeriodEndId} type="date" className={INPUT.base} value={form.trial_period_end} onChange={e => set('trial_period_end', e.target.value)} />
                  </div>
                </div>
              )}

              <hr className="border-gray-100" />
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Appeal</p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={appealDateId} className={INPUT.label}>Appeal Date</label>
                  <input id={appealDateId} type="date" className={INPUT.base} value={form.appeal_date} onChange={e => set('appeal_date', e.target.value)} />
                </div>
                <div>
                  <label htmlFor={appealOutcomeDateId} className={INPUT.label}>Appeal Outcome Date</label>
                  <input id={appealOutcomeDateId} type="date" className={INPUT.base} value={form.appeal_outcome_date} onChange={e => set('appeal_outcome_date', e.target.value)} />
                </div>
              </div>
              {form.appeal_date && (
                <>
                  <div>
                    <label htmlFor={appealGroundsId} className={INPUT.label}>Appeal Grounds</label>
                    <textarea id={appealGroundsId} className={INPUT.base} rows={2} value={form.appeal_grounds} onChange={e => set('appeal_grounds', e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor={appealOutcomeId} className={INPUT.label}>Appeal Outcome</label>
                    <input id={appealOutcomeId} className={INPUT.base} value={form.appeal_outcome} onChange={e => set('appeal_outcome', e.target.value)} />
                  </div>
                </>
              )}

              <div>
                <label htmlFor={flexNotesId} className={INPUT.label}>Notes</label>
                <textarea id={flexNotesId} className={INPUT.base} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
              </div>
            </div>
            <FileAttachments caseType="flexible_working" caseId={editing?.id} />
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
