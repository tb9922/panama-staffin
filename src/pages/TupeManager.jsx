import { useState, useEffect, useCallback, useId } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import Modal from '../components/Modal.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import { getCurrentHome, getHrTupe, createHrTupe, updateHrTupe } from '../lib/api.js';
import { TUPE_STATUSES, getStatusBadge } from '../lib/hr.js';
import FileAttachments from '../components/FileAttachments.jsx';
import Pagination from '../components/Pagination.jsx';
import { useData } from '../contexts/DataContext.jsx';
import useTransientNotice from '../hooks/useTransientNotice.js';

const TRANSFER_TYPES = [
  { id: 'incoming', name: 'Incoming' },
  { id: 'outgoing', name: 'Outgoing' },
];

const emptyForm = () => ({
  transfer_type: 'incoming', transfer_date: '', transferor_name: '', transferee_name: '',
  status: 'planned', staff_affected: '', consultation_start: '', consultation_end: '',
  signed_date: '', eli_sent_date: '', measures_letter_date: '', measures_proposed: '',
  employee_reps_consulted: false, rep_names: '', eli_complete: false,
  dd_notes: '', outstanding_claims: '', outstanding_tribunal_claims: '', notes: '',
});

export default function TupeManager() {
  const { notice, showNotice, clearNotice } = useTransientNotice();
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
      showNotice(editing ? 'TUPE transfer updated.' : 'TUPE transfer created.');
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
      headers: ['Transfer Type', 'Transfer Date', 'Transferor', 'Transferee', 'Status', 'Staff Affected', 'Consultation Start', 'Consultation End', 'ELI Sent'],
      rows: items.map(i => [
        TRANSFER_TYPES.find(t => t.id === i.transfer_type)?.name || i.transfer_type,
        i.transfer_date || '', i.transferor_name || '', i.transferee_name || '',
        TUPE_STATUSES.find(s => s.id === i.status)?.name || i.status,
        i.staff_affected ?? '', i.consultation_start || '', i.consultation_end || '',
        i.eli_sent_date || '',
      ]),
    }]);
  }

  const f = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  if (loading) {
    return (
      <div className={PAGE.container}>
        <LoadingState message="Loading TUPE transfers..." card />
      </div>
    );
  }

  return (
    <div className={PAGE.container}>
      {notice && (
        <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">
          {notice.content}
        </InlineNotice>
      )}

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

      {error && <ErrorState title="TUPE action needs attention" message={error} onRetry={() => void load()} className="mb-4" />}

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
                <th scope="col" className={TABLE.th}>Staff Affected</th>
                {canEdit && <th scope="col" className={TABLE.th}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className={TABLE.empty}>
                    <EmptyState
                      compact
                      title="No TUPE transfers"
                      description={canEdit ? 'Create a transfer record to track consultation, due diligence, and employee impact.' : 'No TUPE transfers have been recorded for this home yet.'}
                      actionLabel={canEdit ? 'New Transfer' : undefined}
                      onAction={canEdit ? openNew : undefined}
                    />
                  </td>
                </tr>
              )}
              {items.map(item => (
                <tr key={item.id} className={TABLE.tr}>
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
                  <td className={TABLE.tdMono}>{item.staff_affected ?? '—'}</td>
                  {canEdit && <td className={TABLE.td}>
                    <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => openEdit(item)}>Edit</button>
                  </td>}
                </tr>
              ))}
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
                  <input id={staffAffectedId} type="number" className={INPUT.base} value={form.staff_affected} onChange={e => f('staff_affected', e.target.value)} />
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
              <div>
                <label htmlFor={eliSentDateId} className={INPUT.label}>ELI Sent Date</label>
                <input id={eliSentDateId} type="date" className={INPUT.base} value={form.eli_sent_date} onChange={e => f('eli_sent_date', e.target.value)} />
              </div>
              <div className="border-t pt-3 mt-3 space-y-3">
                <p className={`text-xs font-semibold ${TABLE.th}`}>Consultation & ELI</p>
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
                <p className={`text-xs font-semibold ${TABLE.th}`}>Due Diligence & Claims</p>
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
            {formError && (
              <InlineNotice variant="error" role="alert" className="mt-2">
                {formError}
              </InlineNotice>
            )}
            <div className={MODAL.footer}>
              <button className={BTN.secondary} onClick={closeModal} disabled={saving}>Cancel</button>
              <button className={BTN.primary} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</button>
            </div>
        </Modal>
      )}
    </div>
  );
}
