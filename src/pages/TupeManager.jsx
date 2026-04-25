import { useState, useEffect, useCallback, useId } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE, ESC_COLORS } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import Modal from '../components/Modal.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { getCurrentHome, getHrTupe, createHrTupe, updateHrTupe } from '../lib/api.js';
import { TUPE_STATUSES, getStatusBadge } from '../lib/hr.js';
import FileAttachments from '../components/FileAttachments.jsx';
import Pagination from '../components/Pagination.jsx';
import { useData } from '../contexts/DataContext.jsx';
import { addDaysLocalISO, parseLocalDate, todayLocalISO } from '../lib/localDates.js';

const TRANSFER_TYPES = [
  { id: 'incoming', name: 'Incoming' },
  { id: 'outgoing', name: 'Outgoing' },
];

const TUPE_CONSULTATION_MIN_DAYS = 30;
const OPEN_CONSULTATION_STATUSES = new Set(['planned', 'consultation']);
const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntil(dateStr) {
  const date = parseLocalDate(dateStr);
  const today = parseLocalDate(todayLocalISO());
  if (!date || !today) return null;
  return Math.ceil((date.getTime() - today.getTime()) / DAY_MS);
}

function getConsultationDeadline(item) {
  if (!item.consultation_start) return '';
  return addDaysLocalISO(item.consultation_start, TUPE_CONSULTATION_MIN_DAYS);
}

function getConsultationState(item) {
  const deadline = getConsultationDeadline(item);
  if (!deadline) return { deadline: '', level: 'gray', label: 'Not started', detail: '' };

  if (item.consultation_end) {
    if (item.consultation_end >= deadline) {
      return { deadline, level: 'green', label: '30-day window met', detail: `Minimum window ended ${deadline}` };
    }
    return { deadline, level: 'red', label: 'Too short', detail: `Minimum consultation end date is ${deadline}` };
  }

  if (!OPEN_CONSULTATION_STATUSES.has(item.status)) {
    return { deadline, level: 'gray', label: 'No end date', detail: `Minimum consultation end date is ${deadline}` };
  }

  const days = daysUntil(deadline);
  if (days == null) return { deadline, level: 'gray', label: 'Pending', detail: `Minimum consultation end date is ${deadline}` };
  if (days < 0) return { deadline, level: 'red', label: `Overdue by ${Math.abs(days)}d`, detail: 'Consultation end date has not been recorded.' };
  if (days <= 7) return { deadline, level: 'amber', label: days === 0 ? 'Due today' : `Due in ${days}d`, detail: 'Record the consultation outcome or extend the plan.' };
  if (days <= TUPE_CONSULTATION_MIN_DAYS) return { deadline, level: 'yellow', label: `Due in ${days}d`, detail: `Minimum consultation end date is ${deadline}` };
  return { deadline, level: 'gray', label: 'Pending', detail: `Minimum consultation end date is ${deadline}` };
}

const emptyForm = () => ({
  transfer_type: 'incoming', transfer_date: '', transferor_name: '', transferee_name: '',
  status: 'planned', staff_affected: '', consultation_start: '', consultation_end: '',
  signed_date: '', eli_sent_date: '', measures_letter_date: '', measures_proposed: '',
  employee_reps_consulted: false, rep_names: '', eli_complete: false,
  dd_notes: '', outstanding_claims: '', outstanding_tribunal_claims: '', notes: '',
});

export default function TupeManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  const home = getCurrentHome();
  const transferTypeId = useId();
  const transferDateId = useId();
  const transferorNameId = useId();
  const transfereeNameId = useId();
  const tupeStatusId = useId();
  const staffAffectedId = useId();
  const consultationStartId = useId();
  const consultationEndId = useId();
  const signedDateId = useId();
  const eliSentDateId = useId();
  const measuresLetterDateId = useId();
  const measuresProposedId = useId();
  const employeeRepsConsultedId = useId();
  const repNamesId = useId();
  const eliCompleteId = useId();
  const ddNotesId = useId();
  const outstandingClaimsId = useId();
  const outstandingTribunalClaimsId = useId();
  const tupeNotesId = useId();
  const { canWrite } = useData();
  const canEdit = canWrite('hr');
  useDirtyGuard(showModal);

  const LIMIT = 50;

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const res = await getHrTupe(home, { limit: LIMIT, offset });
      setItems(res?.rows || []);
      setTotal(res?.total || 0);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [home, offset]);

  useEffect(() => { load(); }, [load]);

  function closeModal() {
    setShowModal(false);
    setEditing(null);
    setForm(emptyForm());
    setFormError('');
  }

  function openNew() {
    setEditing(null);
    setForm(emptyForm());
    setShowModal(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({
      transfer_type: item.transfer_type || 'incoming',
      transfer_date: item.transfer_date || '',
      transferor_name: item.transferor_name || '',
      transferee_name: item.transferee_name || '',
      status: item.status || 'planned',
      staff_affected: item.staff_affected ?? '',
      consultation_start: item.consultation_start || '',
      consultation_end: item.consultation_end || '',
      signed_date: item.signed_date || '',
      eli_sent_date: item.eli_sent_date || '',
      measures_letter_date: item.measures_letter_date || '',
      measures_proposed: item.measures_proposed || '',
      employee_reps_consulted: item.employee_reps_consulted ?? false,
      rep_names: item.rep_names || '',
      eli_complete: item.eli_complete ?? false,
      dd_notes: item.dd_notes || '',
      outstanding_claims: item.outstanding_claims || '',
      outstanding_tribunal_claims: item.outstanding_tribunal_claims || '',
      notes: item.notes || '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    setFormError('');
    setError(null);
    if (!form.transfer_date) { setFormError('Transfer date is required'); return; }
    if (!form.transferor_name) { setFormError('Transferor name is required'); return; }
    if (!form.transferee_name) { setFormError('Transferee name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        staff_affected: form.staff_affected !== '' ? parseInt(form.staff_affected, 10) : null,
      };
      if (editing) await updateHrTupe(editing.id, { ...payload, _version: editing.version });
      else await createHrTupe(home, payload);
      setShowModal(false); setEditing(null); setForm(emptyForm()); load();
    } catch (e) {
      if (e.message?.includes('modified by another user')) {
        setError('This record was modified by another user. Please close and reopen to get the latest version.');
        load();
      } else { setError(e.message); }
    } finally { setSaving(false); }
  }

  async function handleExport() {
    const { downloadXLSX } = await import('../lib/excel.js');
    downloadXLSX('tupe_transfers', [{
      name: 'TUPE',
      headers: ['Transfer Type', 'Transfer Date', 'Transferor', 'Transferee', 'Status', 'Reg 13 Deadline', 'Staff Affected', 'Consultation Start', 'Consultation End', 'ELI Sent'],
      rows: items.map(i => [
        TRANSFER_TYPES.find(t => t.id === i.transfer_type)?.name || i.transfer_type,
        i.transfer_date || '', i.transferor_name || '', i.transferee_name || '',
        TUPE_STATUSES.find(s => s.id === i.status)?.name || i.status,
        getConsultationDeadline(i), i.staff_affected ?? '', i.consultation_start || '', i.consultation_end || '',
        i.eli_sent_date || '',
      ]),
    }]);
  }

  const f = (key, val) => setForm(prev => ({ ...prev, [key]: val }));
  const tableColumnCount = canEdit ? 8 : 7;
  const formConsultationState = getConsultationState(form);

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading TUPE transfers..." card /></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>TUPE Transfers</h1>
          <p className={PAGE.subtitle}>Transfer of Undertakings (Protection of Employment) management</p>
        </div>
        <div className="flex gap-2">
          <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleExport}>Export Excel</button>
          {canEdit && <button className={BTN.primary + ' ' + BTN.sm} onClick={openNew}>New Transfer</button>}
        </div>
      </div>

      {error && <ErrorState title="Unable to load TUPE transfers" message={error} onRetry={load} className="mb-4" />}

      {/* Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Transfer Type</th>
                <th scope="col" className={TABLE.th}>Transfer Date</th>
                <th scope="col" className={TABLE.th}>Transferor</th>
                <th scope="col" className={TABLE.th}>Transferee</th>
                <th scope="col" className={TABLE.th}>Status</th>
                <th scope="col" className={TABLE.th}>Reg 13 Deadline</th>
                <th scope="col" className={TABLE.th}>Staff Affected</th>
                {canEdit && <th scope="col" className={TABLE.th}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={tableColumnCount} className={TABLE.empty}>
                    <EmptyState
                      title="No TUPE transfers"
                      description={canEdit ? 'Create the first transfer record to track consultation, due diligence, and staff numbers.' : 'TUPE transfers will appear here once they have been recorded.'}
                      actionLabel={canEdit ? 'New Transfer' : undefined}
                      onAction={canEdit ? openNew : undefined}
                      compact
                    />
                  </td>
                </tr>
              )}
              {items.map(item => {
                const consultationState = getConsultationState(item);
                const highlight = consultationState.level !== 'gray' && consultationState.level !== 'green'
                  ? ESC_COLORS[consultationState.level].card
                  : '';
                return (
                  <tr key={item.id} className={`${TABLE.tr} ${highlight}`}>
                    <td className={TABLE.td}>
                      <span className={BADGE[item.transfer_type === 'incoming' ? 'blue' : 'amber']}>
                        {TRANSFER_TYPES.find(t => t.id === item.transfer_type)?.name || item.transfer_type}
                      </span>
                    </td>
                    <td className={TABLE.td}>{item.transfer_date || '—'}</td>
                    <td className={TABLE.td}>{item.transferor_name || '—'}</td>
                    <td className={TABLE.td}>{item.transferee_name || '—'}</td>
                    <td className={TABLE.td}>
                      <span className={BADGE[getStatusBadge(item.status, TUPE_STATUSES)]}>
                        {TUPE_STATUSES.find(s => s.id === item.status)?.name || item.status}
                      </span>
                    </td>
                    <td className={TABLE.td}>
                      {consultationState.deadline ? (
                        <div className="space-y-1">
                          <div className="font-mono text-xs">{consultationState.deadline}</div>
                          <span className={BADGE[consultationState.level === 'yellow' ? 'orange' : consultationState.level]}>
                            {consultationState.label}
                          </span>
                        </div>
                      ) : '—'}
                    </td>
                    <td className={TABLE.tdMono}>{item.staff_affected ?? '—'}</td>
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
        <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit TUPE Transfer' : 'New TUPE Transfer'} size="xl">
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={transferTypeId} className={INPUT.label}>Transfer Type</label>
                  <select id={transferTypeId} className={INPUT.select} value={form.transfer_type} onChange={e => f('transfer_type', e.target.value)}>
                    {TRANSFER_TYPES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={transferDateId} className={INPUT.label}>Transfer Date</label>
                  <input id={transferDateId} type="date" className={INPUT.base} value={form.transfer_date} onChange={e => f('transfer_date', e.target.value)} />
                </div>
              </div>
              <div>
                <label htmlFor={signedDateId} className={INPUT.label}>Signed Date</label>
                <input id={signedDateId} type="date" className={INPUT.base} value={form.signed_date} onChange={e => f('signed_date', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={transferorNameId} className={INPUT.label}>Transferor Name</label>
                  <input id={transferorNameId} className={INPUT.base} value={form.transferor_name} onChange={e => f('transferor_name', e.target.value)} placeholder="Entity transferring staff" />
                </div>
                <div>
                  <label htmlFor={transfereeNameId} className={INPUT.label}>Transferee Name</label>
                  <input id={transfereeNameId} className={INPUT.base} value={form.transferee_name} onChange={e => f('transferee_name', e.target.value)} placeholder="Entity receiving staff" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={tupeStatusId} className={INPUT.label}>Status</label>
                  <select id={tupeStatusId} className={INPUT.select} value={form.status} onChange={e => f('status', e.target.value)}>
                    {TUPE_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={staffAffectedId} className={INPUT.label}>Staff Affected</label>
                  <input id={staffAffectedId} type="number" min="0" inputMode="numeric" className={INPUT.base} value={form.staff_affected} onChange={e => f('staff_affected', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={consultationStartId} className={INPUT.label}>Consultation Start</label>
                  <input id={consultationStartId} type="date" className={INPUT.base} value={form.consultation_start} onChange={e => f('consultation_start', e.target.value)} />
                </div>
                <div>
                  <label htmlFor={consultationEndId} className={INPUT.label}>Consultation End</label>
                  <input id={consultationEndId} type="date" className={INPUT.base} value={form.consultation_end} onChange={e => f('consultation_end', e.target.value)} />
                </div>
              </div>
              {formConsultationState.deadline && (
                <div className={`rounded-lg border px-3 py-2 text-sm ${ESC_COLORS[formConsultationState.level === 'gray' ? 'yellow' : formConsultationState.level].card}`}>
                  <div className={`font-semibold ${ESC_COLORS[formConsultationState.level === 'gray' ? 'yellow' : formConsultationState.level].text}`}>
                    Reg 13 consultation deadline: {formConsultationState.deadline}
                  </div>
                  <p className="mt-1 text-xs text-gray-600">{formConsultationState.detail}</p>
                </div>
              )}
              <div>
                <label htmlFor={eliSentDateId} className={INPUT.label}>ELI Sent Date</label>
                <input id={eliSentDateId} type="date" className={INPUT.base} value={form.eli_sent_date} onChange={e => f('eli_sent_date', e.target.value)} />
              </div>
              <div className="border-t pt-3 mt-3 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Consultation & ELI</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor={measuresLetterDateId} className={INPUT.label}>Measures Letter Date</label>
                    <input id={measuresLetterDateId} type="date" className={INPUT.base} value={form.measures_letter_date} onChange={e => f('measures_letter_date', e.target.value)} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input id={employeeRepsConsultedId} type="checkbox" checked={form.employee_reps_consulted} onChange={e => f('employee_reps_consulted', e.target.checked)} />
                  <label htmlFor={employeeRepsConsultedId} className="text-sm text-gray-700">Employee Representatives Consulted</label>
                </div>
                {form.employee_reps_consulted && (
                  <div>
                    <label htmlFor={repNamesId} className={INPUT.label}>Representative Names</label>
                    <input id={repNamesId} className={INPUT.base} value={form.rep_names} onChange={e => f('rep_names', e.target.value)} />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input id={eliCompleteId} type="checkbox" checked={form.eli_complete} onChange={e => f('eli_complete', e.target.checked)} />
                  <label htmlFor={eliCompleteId} className="text-sm text-gray-700">ELI Complete</label>
                </div>
              </div>
              <div>
                <label htmlFor={measuresProposedId} className={INPUT.label}>Measures Proposed</label>
                <textarea id={measuresProposedId} className={INPUT.base} rows={3} value={form.measures_proposed} onChange={e => f('measures_proposed', e.target.value)} placeholder="Proposed measures affecting transferred staff..." />
              </div>
              <div className="border-t pt-3 mt-3 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Due Diligence & Claims</p>
                <div>
                  <label htmlFor={ddNotesId} className={INPUT.label}>Due Diligence Notes</label>
                  <textarea id={ddNotesId} className={INPUT.base} rows={3} value={form.dd_notes} onChange={e => f('dd_notes', e.target.value)} />
                </div>
                <div>
                  <label htmlFor={outstandingClaimsId} className={INPUT.label}>Outstanding Claims</label>
                  <textarea id={outstandingClaimsId} className={INPUT.base} rows={2} value={form.outstanding_claims} onChange={e => f('outstanding_claims', e.target.value)} />
                </div>
                <div>
                  <label htmlFor={outstandingTribunalClaimsId} className={INPUT.label}>Outstanding Tribunal Claims</label>
                  <textarea id={outstandingTribunalClaimsId} className={INPUT.base} rows={2} value={form.outstanding_tribunal_claims} onChange={e => f('outstanding_tribunal_claims', e.target.value)} />
                </div>
              </div>
              <div>
                <label htmlFor={tupeNotesId} className={INPUT.label}>Notes</label>
                <textarea id={tupeNotesId} className={INPUT.base} rows={2} value={form.notes} onChange={e => f('notes', e.target.value)} />
              </div>
            </div>
            <FileAttachments caseType="tupe" caseId={editing?.id} />
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
