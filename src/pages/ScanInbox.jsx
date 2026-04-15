import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PAGE, CARD, TABLE, BTN, INPUT, BADGE } from '../lib/design.js';
import {
  getCurrentHome,
  listScanIntake,
  getScanIntakeItem,
  createScanIntake,
  confirmScanIntake,
  rejectScanIntake,
  retryScanIntake,
  getMaintenance,
  getFinanceExpenses,
  getPaymentSchedules,
  getOnboardingData,
  getCqcEvidence,
  getSuppliers,
} from '../lib/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import { SCAN_INTAKE_TARGETS, SCAN_INTAKE_STATUS_LABELS } from '../../shared/scanIntake.js';
import { describeScanLaunchContext, parseScanLaunchParams } from '../lib/scanRouting.js';

const ONBOARDING_SECTIONS = [
  'dbs_check', 'right_to_work', 'references', 'identity_check', 'health_declaration',
  'qualifications', 'contract', 'employment_history', 'day1_induction', 'policy_acknowledgement',
];

function targetLabel(id) {
  return SCAN_INTAKE_TARGETS.find((target) => target.id === id)?.label || id || 'Unclassified';
}

function confidenceBadge(confidence) {
  if (confidence == null) return BADGE.gray;
  if (confidence >= 0.9) return BADGE.green;
  if (confidence >= 0.7) return BADGE.amber;
  return BADGE.red;
}

function pickField(fields, ...keys) {
  for (const key of keys) {
    if (fields?.[key] != null && String(fields[key]).trim() !== '') return fields[key];
  }
  return '';
}

export default function ScanInbox() {
  const home = getCurrentHome();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [file, setFile] = useState(null);
  const [target, setTarget] = useState('finance_ap');
  const [maintenanceChecks, setMaintenanceChecks] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [onboardingData, setOnboardingData] = useState({ onboarding: {}, staff: [] });
  const [cqcEvidence, setCqcEvidence] = useState([]);
  const [recordAttachmentForm, setRecordAttachmentForm] = useState({ module: '', record_id: '', description: '' });
  const [maintenanceForm, setMaintenanceForm] = useState({ record_id: '', description: '' });
  const [financeForm, setFinanceForm] = useState({
    target_type: 'create_expense',
    record_id: '',
    description: '',
    expense: {
      expense_date: '',
      category: 'other',
      description: '',
      supplier: '',
      supplier_id: '',
      invoice_ref: '',
      net_amount: '',
      vat_amount: '0',
      gross_amount: '',
      notes: '',
    },
  });
  const [hrForm, setHrForm] = useState({ case_type: '', case_id: '', description: '' });
  const [onboardingForm, setOnboardingForm] = useState({ staff_id: '', section: 'dbs_check', description: '' });
  const [trainingForm, setTrainingForm] = useState({ staff_id: '', type_id: '', description: '' });
  const [cqcForm, setCqcForm] = useState({
    evidence_id: '',
    description: '',
    create_evidence: {
      quality_statement: '',
      type: 'qualitative',
      title: '',
      description: '',
      evidence_category: '',
      evidence_owner: '',
      review_due: '',
    },
  });
  const launchContext = useMemo(() => parseScanLaunchParams(searchParams), [searchParams]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listScanIntake(home, { limit: 100 });
      setList(result.rows || []);
      if (!selectedId && result.rows?.length) {
        setSelectedId(result.rows[0].id);
      }
    } catch (err) {
      setError(err.message || 'Failed to load scan inbox');
    } finally {
      setLoading(false);
    }
  }, [home, selectedId]);

  const loadSelected = useCallback(async () => {
    if (!selectedId) return;
    try {
      const item = await getScanIntakeItem(home, selectedId);
      setSelected(item);
      const defaultTarget = launchContext?.target || item.classification_target || 'finance_ap';
      setTarget(defaultTarget);
      const fields = item.summary_fields?.fields || {};
      if (launchContext?.target === 'record_attachment') {
        setRecordAttachmentForm((current) => ({
          ...current,
          module: launchContext.moduleId || current.module,
          record_id: launchContext.recordId || current.record_id,
        }));
      }
      if (launchContext?.target === 'hr_attachment') {
        setHrForm((current) => ({
          ...current,
          case_type: launchContext.caseType || current.case_type,
          case_id: launchContext.caseId || current.case_id,
        }));
      }
      if (launchContext?.target === 'training') {
        setTrainingForm((current) => ({
          ...current,
          staff_id: launchContext.staffId || current.staff_id,
          type_id: launchContext.typeId || current.type_id,
        }));
      }
      if (launchContext?.target === 'onboarding') {
        setOnboardingForm((current) => ({
          ...current,
          staff_id: launchContext.staffId || current.staff_id,
          section: launchContext.section || current.section,
        }));
      }
      if (launchContext?.target === 'cqc') {
        setCqcForm((current) => ({
          ...current,
          evidence_id: launchContext.evidenceId || current.evidence_id,
        }));
      }
      setFinanceForm((current) => ({
        ...current,
        expense: {
          ...current.expense,
          expense_date: pickField(fields, 'invoice_date', 'date', 'expense_date'),
          category: pickField(fields, 'category') || current.expense.category,
          description: pickField(fields, 'description', 'supplier') || current.expense.description,
          supplier: pickField(fields, 'supplier'),
          supplier_id: '',
          invoice_ref: pickField(fields, 'invoice_ref', 'reference'),
          net_amount: pickField(fields, 'net_amount', 'net'),
          vat_amount: pickField(fields, 'vat_amount', 'vat') || '0',
          gross_amount: pickField(fields, 'gross_amount', 'gross', 'total'),
          notes: current.expense.notes,
        },
      }));
      setCqcForm((current) => ({
        ...current,
        create_evidence: {
          ...current.create_evidence,
          title: current.create_evidence.title || item.original_name,
        },
      }));
    } catch (err) {
      setError(err.message || 'Failed to load scan item');
    }
  }, [home, launchContext, selectedId]);

  const loadReferenceData = useCallback(async () => {
    try {
      const [maintenance, expenseData, scheduleData, supplierData, onboarding, cqc] = await Promise.all([
        getMaintenance(home),
        getFinanceExpenses(home, { limit: 200 }),
        getPaymentSchedules(home, { limit: 200 }),
        getSuppliers(home, { activeOnly: true }),
        getOnboardingData(home),
        getCqcEvidence(home, { limit: 200 }),
      ]);
      setMaintenanceChecks(maintenance.checks || []);
      setExpenses(expenseData.rows || []);
      setSchedules(scheduleData.rows || []);
      setSuppliers(supplierData || []);
      setOnboardingData(onboarding || { onboarding: {}, staff: [] });
      setCqcEvidence(cqc.evidence || cqc.rows || []);
    } catch {
      // keep page usable even if some reference data fails
    }
  }, [home]);

  useEffect(() => { loadList(); loadReferenceData(); }, [loadList, loadReferenceData]);
  useEffect(() => { loadSelected(); }, [loadSelected]);

  const availableTargets = useMemo(() => (
    SCAN_INTAKE_TARGETS.filter((entry) =>
      !entry.contextualOnly ||
      launchContext?.target === entry.id ||
      selected?.classification_target === entry.id
    )
  ), [launchContext, selected]);

  const selectedFields = selected?.summary_fields?.fields || {};
  const selectedConfidences = selected?.summary_fields?.confidences || {};
  const selectedClassification = selected?.summary_fields?.classification || {};

  const canConfirm = useMemo(() => {
    if (!selected) return false;
    if (target === 'record_attachment') return Boolean(recordAttachmentForm.module && recordAttachmentForm.record_id);
    if (target === 'maintenance') return Boolean(maintenanceForm.record_id);
    if (target === 'finance_ap') {
      if (financeForm.target_type === 'create_expense') {
        return Boolean(financeForm.expense.expense_date && financeForm.expense.category && financeForm.expense.description && financeForm.expense.gross_amount);
      }
      return Boolean(financeForm.record_id);
    }
    if (target === 'hr_attachment') return Boolean(hrForm.case_type && hrForm.case_id);
    if (target === 'onboarding') return Boolean(onboardingForm.staff_id && onboardingForm.section);
    if (target === 'training') return Boolean(trainingForm.staff_id && trainingForm.type_id);
    if (target === 'cqc') return Boolean(cqcForm.evidence_id || (cqcForm.create_evidence.quality_statement && cqcForm.create_evidence.title));
    return false;
  }, [selected, target, recordAttachmentForm, maintenanceForm, financeForm, hrForm, onboardingForm, trainingForm, cqcForm]);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const created = await createScanIntake(home, file);
      showToast({ title: 'Document scanned', message: created.original_name });
      setFile(null);
      await loadList();
      setSelectedId(created.id);
    } catch (err) {
      setError(err.message || 'Failed to scan document');
    } finally {
      setUploading(false);
    }
  }

  async function handleConfirm() {
    if (!selected) return;
    setConfirming(true);
    setError(null);
    try {
      const payload = { target };
      if (target === 'record_attachment') payload.record_attachment = { ...recordAttachmentForm };
      if (target === 'maintenance') payload.maintenance = { ...maintenanceForm };
      if (target === 'finance_ap') {
        payload.finance_ap = {
          ...financeForm,
          record_id: financeForm.record_id ? Number(financeForm.record_id) : undefined,
          expense: {
            ...financeForm.expense,
            supplier_id: financeForm.expense.supplier_id ? Number(financeForm.expense.supplier_id) : null,
            net_amount: Number(financeForm.expense.net_amount || 0),
            vat_amount: Number(financeForm.expense.vat_amount || 0),
            gross_amount: Number(financeForm.expense.gross_amount || 0),
          },
        };
      }
      if (target === 'hr_attachment') {
        payload.hr_attachment = {
          ...hrForm,
          case_id: Number(hrForm.case_id),
        };
      }
      if (target === 'onboarding') payload.onboarding = { ...onboardingForm };
      if (target === 'training') payload.training = { ...trainingForm };
      if (target === 'cqc') payload.cqc = {
        ...cqcForm,
        evidence_id: cqcForm.evidence_id || undefined,
        create_evidence: cqcForm.evidence_id ? undefined : { ...cqcForm.create_evidence },
      };
      await confirmScanIntake(home, selected.id, payload);
      showToast({ title: 'Document filed', message: selected.original_name });
      await loadList();
      await loadSelected();
    } catch (err) {
      setError(err.message || 'Failed to file document');
    } finally {
      setConfirming(false);
    }
  }

  async function handleReject() {
    if (!selected) return;
    try {
      await rejectScanIntake(home, selected.id);
      showToast({ title: 'Scan rejected' });
      await loadList();
      await loadSelected();
    } catch (err) {
      setError(err.message || 'Failed to reject scan');
    }
  }

  async function handleRetry() {
    if (!selected) return;
    try {
      await retryScanIntake(home, selected.id);
      showToast({ title: 'OCR retried' });
      await loadList();
      await loadSelected();
    } catch (err) {
      setError(err.message || 'Failed to retry OCR');
    }
  }

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading scan inbox..." card /></div>;
  if (error && !list.length) return <div className={PAGE.container}><ErrorState title="Scan inbox needs attention" message={error} onRetry={loadList} /></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Scan Inbox</h1>
          <p className={PAGE.subtitle}>Scan once, review OCR, and file the confirmed document back to the right module record.</p>
        </div>
        {launchContext?.returnTo && (
          <Link to={launchContext.returnTo} className={`${BTN.secondary} ${BTN.sm}`}>
            Back to previous page
          </Link>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {launchContext?.target && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Scans from this session will default to <span className="font-semibold">{describeScanLaunchContext(launchContext)}</span>.
        </div>
      )}

      <div className={`${CARD.padded} flex flex-wrap items-end gap-3`}>
        <div className="min-w-64 flex-1">
          <label className={INPUT.label}>Upload scanned document</label>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" className={INPUT.base} onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <p className="mt-1 text-xs text-gray-500">Single-page PDF, JPG, or PNG up to 10MB.</p>
        </div>
        <button onClick={handleUpload} disabled={!file || uploading} className={BTN.primary}>{uploading ? 'Scanning…' : 'Scan Document'}</button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1.4fr]">
        <div className={CARD.flush}>
          <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">Inbox</div>
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}><tr><th className={TABLE.th}>Document</th><th className={TABLE.th}>Suggested Target</th><th className={TABLE.th}>Status</th></tr></thead>
              <tbody>
                {list.map((item) => (
                  <tr key={item.id} className={`${TABLE.tr} cursor-pointer ${selectedId === item.id ? 'bg-blue-50' : ''}`} onClick={() => setSelectedId(item.id)}>
                    <td className={TABLE.td}>
                      <div className="font-medium">{item.original_name}</div>
                      <div className="text-xs text-gray-500">{new Date(item.created_at).toLocaleString('en-GB')}</div>
                    </td>
                    <td className={TABLE.td}>
                      <div className="flex items-center gap-2">
                        <span>{targetLabel(item.classification_target)}</span>
                        <span className={confidenceBadge(item.classification_confidence)}>{item.classification_confidence ? `${Math.round(item.classification_confidence * 100)}%` : '—'}</span>
                      </div>
                    </td>
                    <td className={TABLE.td}><span className={BADGE[item.status === 'confirmed' ? 'green' : item.status === 'failed' ? 'red' : item.status === 'rejected' ? 'gray' : 'amber']}>{SCAN_INTAKE_STATUS_LABELS[item.status] || item.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={CARD.padded}>
          {!selected ? (
            <div className="py-12 text-center text-sm text-gray-500">Select a scan to review.</div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{selected.original_name}</h2>
                  <p className="text-sm text-gray-500">Status: {SCAN_INTAKE_STATUS_LABELS[selected.status] || selected.status}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.status !== 'confirmed' && <button onClick={handleReject} className={`${BTN.secondary} ${BTN.sm}`}>Reject</button>}
                  {(selected.status === 'failed' || selected.status === 'rejected') && <button onClick={handleRetry} className={`${BTN.secondary} ${BTN.sm}`}>Retry OCR</button>}
                  {selected.status !== 'confirmed' && <button onClick={handleConfirm} disabled={!canConfirm || confirming} className={`${BTN.primary} ${BTN.sm}`}>{confirming ? 'Filing…' : 'Confirm & File'}</button>}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="mb-2 text-sm font-semibold text-gray-900">OCR summary</div>
                  <div className="space-y-2 text-sm">
                    {Object.keys(selectedFields).length === 0 && <div className="text-gray-500">No fields extracted.</div>}
                    {Object.entries(selectedFields).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between gap-3">
                        <span className="text-gray-600">{key}</span>
                        <div className="flex items-center gap-2">
                          <span className="truncate text-right text-gray-900">{String(value)}</span>
                          <span className={confidenceBadge(selectedConfidences[key])}>{selectedConfidences[key] != null ? `${Math.round(selectedConfidences[key] * 100)}%` : '—'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {selected.summary_fields?.rawText && (
                    <details className="mt-3 text-sm text-gray-600">
                      <summary className="cursor-pointer font-medium text-gray-700">Raw OCR text</summary>
                      <pre className="mt-2 whitespace-pre-wrap rounded bg-white p-3 text-xs">{selected.summary_fields.rawText}</pre>
                    </details>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <label className={INPUT.label} htmlFor="scan-intake-target">Destination</label>
                    <select id="scan-intake-target" value={target} onChange={(e) => setTarget(e.target.value)} className={INPUT.select}>
                      {availableTargets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                    <p className="mt-1 text-xs text-gray-500">Suggested: {targetLabel(selectedClassification.target)} ({selectedClassification.confidence ? `${Math.round(selectedClassification.confidence * 100)}%` : '—'})</p>
                  </div>

                  {target === 'record_attachment' && (
                    <div className="space-y-3">
                      {launchContext?.target === 'record_attachment' ? (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                          <div className="font-medium text-gray-900">{describeScanLaunchContext(launchContext)}</div>
                          <div className="mt-1 text-xs text-gray-500">This scan will file into the current record attachments.</div>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                          Open Scan Inbox from a record-level scan button to file directly into an existing record.
                        </div>
                      )}
                      <div>
                        <label className={INPUT.label}>Description</label>
                        <input className={INPUT.base} value={recordAttachmentForm.description} onChange={(e) => setRecordAttachmentForm((current) => ({ ...current, description: e.target.value }))} />
                      </div>
                    </div>
                  )}

                  {target === 'maintenance' && (
                    <div className="space-y-3">
                      <div><label className={INPUT.label}>Maintenance check</label><select className={INPUT.select} value={maintenanceForm.record_id} onChange={(e) => setMaintenanceForm((current) => ({ ...current, record_id: e.target.value }))}><option value="">Select check</option>{maintenanceChecks.map((check) => <option key={check.id} value={check.id}>{check.category_name || check.category} — {check.description || 'No description'}</option>)}</select></div>
                      <div><label className={INPUT.label}>Description</label><input className={INPUT.base} value={maintenanceForm.description} onChange={(e) => setMaintenanceForm((current) => ({ ...current, description: e.target.value }))} /></div>
                    </div>
                  )}

                  {target === 'finance_ap' && (
                    <div className="space-y-3">
                      <div><label className={INPUT.label}>Finance action</label><select className={INPUT.select} value={financeForm.target_type} onChange={(e) => setFinanceForm((current) => ({ ...current, target_type: e.target.value, record_id: '' }))}><option value="create_expense">Create pending expense</option><option value="expense">Attach to existing expense</option><option value="payment_schedule">Attach to payment schedule</option></select></div>
                      {financeForm.target_type === 'expense' && <div><label className={INPUT.label}>Expense</label><select className={INPUT.select} value={financeForm.record_id} onChange={(e) => setFinanceForm((current) => ({ ...current, record_id: e.target.value }))}><option value="">Select expense</option>{expenses.map((expense) => <option key={expense.id} value={expense.id}>{expense.expense_date} — {expense.description}</option>)}</select></div>}
                      {financeForm.target_type === 'payment_schedule' && <div><label className={INPUT.label}>Payment schedule</label><select className={INPUT.select} value={financeForm.record_id} onChange={(e) => setFinanceForm((current) => ({ ...current, record_id: e.target.value }))}><option value="">Select schedule</option>{schedules.map((schedule) => <option key={schedule.id} value={schedule.id}>{schedule.supplier} — {schedule.frequency}</option>)}</select></div>}
                      {financeForm.target_type === 'create_expense' && (
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div><label className={INPUT.label}>Expense date</label><input type="date" className={INPUT.base} value={financeForm.expense.expense_date} onChange={(e) => setFinanceForm((current) => ({ ...current, expense: { ...current.expense, expense_date: e.target.value } }))} /></div>
                          <div><label className={INPUT.label}>Category</label><input className={INPUT.base} value={financeForm.expense.category} onChange={(e) => setFinanceForm((current) => ({ ...current, expense: { ...current.expense, category: e.target.value } }))} /></div>
                          <div className="md:col-span-2"><label className={INPUT.label}>Description</label><input className={INPUT.base} value={financeForm.expense.description} onChange={(e) => setFinanceForm((current) => ({ ...current, expense: { ...current.expense, description: e.target.value } }))} /></div>
                          <div><label className={INPUT.label}>Supplier</label><input className={INPUT.base} value={financeForm.expense.supplier} onChange={(e) => setFinanceForm((current) => ({ ...current, expense: { ...current.expense, supplier: e.target.value, supplier_id: '' } }))} /></div>
                          <div><label className={INPUT.label}>Match supplier</label><select className={INPUT.select} value={financeForm.expense.supplier_id} onChange={(e) => { const match = suppliers.find((supplier) => String(supplier.id) === e.target.value); setFinanceForm((current) => ({ ...current, expense: { ...current.expense, supplier_id: e.target.value, supplier: match?.name || current.expense.supplier } })); }}><option value="">No match</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></div>
                          <div><label className={INPUT.label}>Invoice ref</label><input className={INPUT.base} value={financeForm.expense.invoice_ref} onChange={(e) => setFinanceForm((current) => ({ ...current, expense: { ...current.expense, invoice_ref: e.target.value } }))} /></div>
                          <div><label className={INPUT.label}>Net</label><input type="number" step="0.01" className={INPUT.base} value={financeForm.expense.net_amount} onChange={(e) => setFinanceForm((current) => ({ ...current, expense: { ...current.expense, net_amount: e.target.value } }))} /></div>
                          <div><label className={INPUT.label}>VAT</label><input type="number" step="0.01" className={INPUT.base} value={financeForm.expense.vat_amount} onChange={(e) => setFinanceForm((current) => ({ ...current, expense: { ...current.expense, vat_amount: e.target.value } }))} /></div>
                          <div><label className={INPUT.label}>Gross</label><input type="number" step="0.01" className={INPUT.base} value={financeForm.expense.gross_amount} onChange={(e) => setFinanceForm((current) => ({ ...current, expense: { ...current.expense, gross_amount: e.target.value } }))} /></div>
                        </div>
                      )}
                    </div>
                  )}

                  {target === 'hr_attachment' && (
                    <div className="space-y-3">
                      {launchContext?.target === 'hr_attachment' ? (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                          <div className="font-medium text-gray-900">{describeScanLaunchContext(launchContext)}</div>
                          <div className="mt-1 text-xs text-gray-500">This scan will file into the current HR case attachments.</div>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                          Open Scan Inbox from a case-level scan button to file directly into an HR case.
                        </div>
                      )}
                      <div>
                        <label className={INPUT.label}>Description</label>
                        <input className={INPUT.base} value={hrForm.description} onChange={(e) => setHrForm((current) => ({ ...current, description: e.target.value }))} />
                      </div>
                    </div>
                  )}

                  {target === 'onboarding' && (
                    <div className="space-y-3">
                      <div><label className={INPUT.label}>Staff member</label><select className={INPUT.select} value={onboardingForm.staff_id} onChange={(e) => setOnboardingForm((current) => ({ ...current, staff_id: e.target.value }))}><option value="">Select staff</option>{(onboardingData.staff || []).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></div>
                      <div><label className={INPUT.label}>Section</label><select className={INPUT.select} value={onboardingForm.section} onChange={(e) => setOnboardingForm((current) => ({ ...current, section: e.target.value }))}>{ONBOARDING_SECTIONS.map((section) => <option key={section} value={section}>{section}</option>)}</select></div>
                      <div><label className={INPUT.label}>Description</label><input className={INPUT.base} value={onboardingForm.description} onChange={(e) => setOnboardingForm((current) => ({ ...current, description: e.target.value }))} /></div>
                    </div>
                  )}

                  {target === 'training' && (
                    <div className="space-y-3">
                      {launchContext?.target === 'training' ? (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                          <div className="font-medium text-gray-900">{describeScanLaunchContext(launchContext)}</div>
                          <div className="mt-1 text-xs text-gray-500">This scan will file into the selected training record.</div>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                          Open Scan Inbox from a training record to file directly into that record.
                        </div>
                      )}
                      <div>
                        <label className={INPUT.label}>Description</label>
                        <input className={INPUT.base} value={trainingForm.description} onChange={(e) => setTrainingForm((current) => ({ ...current, description: e.target.value }))} />
                      </div>
                    </div>
                  )}

                  {target === 'cqc' && (
                    <div className="space-y-3">
                      <div><label className={INPUT.label}>Existing evidence</label><select className={INPUT.select} value={cqcForm.evidence_id} onChange={(e) => setCqcForm((current) => ({ ...current, evidence_id: e.target.value }))}><option value="">Create new evidence item</option>{cqcEvidence.map((item) => <option key={item.id} value={item.id}>{item.quality_statement} — {item.title}</option>)}</select></div>
                      {!cqcForm.evidence_id && (
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div><label className={INPUT.label}>Statement</label><input className={INPUT.base} value={cqcForm.create_evidence.quality_statement} onChange={(e) => setCqcForm((current) => ({ ...current, create_evidence: { ...current.create_evidence, quality_statement: e.target.value } }))} /></div>
                          <div><label className={INPUT.label}>Type</label><select className={INPUT.select} value={cqcForm.create_evidence.type} onChange={(e) => setCqcForm((current) => ({ ...current, create_evidence: { ...current.create_evidence, type: e.target.value } }))}><option value="qualitative">Qualitative</option><option value="quantitative">Quantitative</option></select></div>
                          <div className="md:col-span-2"><label className={INPUT.label}>Title</label><input className={INPUT.base} value={cqcForm.create_evidence.title} onChange={(e) => setCqcForm((current) => ({ ...current, create_evidence: { ...current.create_evidence, title: e.target.value } }))} /></div>
                          <div><label className={INPUT.label}>Evidence category</label><input className={INPUT.base} value={cqcForm.create_evidence.evidence_category} onChange={(e) => setCqcForm((current) => ({ ...current, create_evidence: { ...current.create_evidence, evidence_category: e.target.value } }))} /></div>
                          <div><label className={INPUT.label}>Owner</label><input className={INPUT.base} value={cqcForm.create_evidence.evidence_owner} onChange={(e) => setCqcForm((current) => ({ ...current, create_evidence: { ...current.create_evidence, evidence_owner: e.target.value } }))} /></div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
