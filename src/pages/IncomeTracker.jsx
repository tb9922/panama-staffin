import { useState, useEffect, useCallback, useMemo } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import TabBar from '../components/TabBar.jsx';
import Modal from '../components/Modal.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import StickyTable from '../components/StickyTable.jsx';
import {
  getCurrentHome, getFinanceResidents, createFinanceResident, updateFinanceResident,
  getFinanceFeeHistory, getFinanceInvoices, createFinanceInvoice, updateFinanceInvoice,
  recordFinancePayment, voidFinanceInvoice, creditFinanceInvoice,
} from '../lib/api.js';
import {
  FUNDING_TYPES, CARE_TYPES, RESIDENT_STATUSES, INVOICE_STATUSES, PAYER_TYPES,
  PAYMENT_METHODS, LINE_TYPES, getStatusBadge, getLabel, formatCurrency,
} from '../lib/finance.js';
import { clickableRowProps } from '../lib/a11y.js';
import { useData } from '../contexts/DataContext.jsx';
import { useToast } from '../contexts/useToast.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import useTransientNotice from '../hooks/useTransientNotice.js';
import { todayLocalISO } from '../lib/localDates.js';
import { useConfirm } from '../hooks/useConfirm.jsx';

const TABS = [
  { id: 'residents', label: 'Residents' },
  { id: 'invoices', label: 'Invoices' },
];

function normalizeFinanceError(message) {
  if (!message) return 'Something went wrong.';
  if (/conflict|version|modified by another user/i.test(message)) {
    return 'This record was modified by another user. Please close and reopen it to get the latest version.';
  }
  return message;
}

export default function IncomeTracker() {
  const { canWrite } = useData();
  const canEdit = canWrite('finance');
  const [tab, setTab] = useState('residents');
  const home = getCurrentHome();

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Income & Billing</h1>
          <p className={PAGE.subtitle}>Resident billing profiles and invoice management</p>
        </div>
      </div>

      <TabBar tabs={TABS} activeTab={tab} onTabChange={setTab} className="mb-6" />

      {tab === 'residents' && <ResidentsTab home={home} canEdit={canEdit} />}
      {tab === 'invoices' && <InvoicesTab home={home} canEdit={canEdit} />}
    </div>
  );
}

// ── Residents Tab ────────────────────────────────────────────────────────────

function ResidentsTab({ home, canEdit }) {
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const { showToast } = useToast();
  const [residents, setResidents] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [modalTab, setModalTab] = useState('profile');
  const [feeHistory, setFeeHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  useDirtyGuard(!!showModal);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFunding, setFilterFunding] = useState('');

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const filters = {};
      if (filterStatus) filters.status = filterStatus;
      if (filterFunding) filters.funding_type = filterFunding;
      const data = await getFinanceResidents(home, filters);
      setResidents(data.rows || []);
      setTotal(data.total || 0);
      setError(null);
    } catch (e) { setError(normalizeFinanceError(e.message)); }
    finally { setLoading(false); }
  }, [home, filterStatus, filterFunding]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setForm({ status: 'active', funding_type: 'self_funded', care_type: 'residential', admission_date: todayLocalISO() });
    setModalTab('profile');
    setFeeHistory([]);
    setShowModal(true);
  }

  async function openEdit(r) {
    setEditing(r);
    setForm({ ...r });
    setModalTab('profile');
    if (r.id) {
      try { setFeeHistory(await getFinanceFeeHistory(home, r.id)); }
      catch { setFeeHistory([]); }
    }
    setShowModal(true);
  }

  function closeModal() { setShowModal(false); setEditing(null); setForm({}); setFeeHistory([]); }

  async function handleSave() {
    if (saving) return;
    setError(null);
    if (!form.resident_name?.trim()) {
      setError('Resident name is required.');
      return;
    }
    setSaving(true);
    try {
      if (editing?.id) {
        await updateFinanceResident(home, editing.id, { ...form, _version: editing.version });
        showNotice('Resident profile updated.');
        showToast({ title: 'Resident updated', message: form.resident_name });
      } else {
        await createFinanceResident(home, form);
        showNotice('Resident profile created.');
        showToast({ title: 'Resident added', message: form.resident_name });
      }
      closeModal();
      await load();
    } catch (e) { setError(normalizeFinanceError(e.message)); }
    finally { setSaving(false); }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleExportResidents() {
    const { downloadXLSX } = await import('../lib/excel.js');
    downloadXLSX('finance_residents.xlsx', [{
      name: 'Residents',
      headers: ['Name', 'Room', 'Care Type', 'Funding', 'Weekly Fee', 'Status', 'Next Fee Review', 'Outstanding', 'Last Paid', 'Last Payment'],
      rows: residents.map(r => [
        r.resident_name, r.room_number || '', r.care_type, r.funding_type,
        r.weekly_fee, r.status, r.next_fee_review || '',
        r.outstanding_balance || 0, r.last_payment_date || '', r.last_payment_amount || '',
      ]),
    }]);
  }

  if (loading) return <LoadingState message="Loading residents..." card />;

  if (error && residents.length === 0) {
    return <ErrorState title="Unable to load resident billing profiles" message={error} onRetry={() => void load()} />;
  }

  return (
    <>
      {notice && (
        <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">
          {notice.content}
        </InlineNotice>
      )}

      {error && <ErrorState title="Some resident billing actions need attention" message={error} onRetry={() => void load()} className="mb-4" />}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="">All Statuses</option>
          {RESIDENT_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={filterFunding} onChange={e => setFilterFunding(e.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="">All Funding</option>
          {FUNDING_TYPES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <span className="text-sm text-gray-500">{total} resident{total !== 1 ? 's' : ''}</span>
        <div className="flex-1" />
        <button onClick={handleExportResidents} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
        {canEdit && <button onClick={openCreate} className={BTN.primary}>Add Resident</button>}
      </div>

      <StickyTable className={CARD.flush}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}><tr>
              <th scope="col" className={TABLE.th}>Name</th>
              <th scope="col" className={TABLE.th}>Room</th>
              <th scope="col" className={TABLE.th}>Care Type</th>
              <th scope="col" className={TABLE.th}>Funding</th>
              <th scope="col" className={`${TABLE.th} text-right`}>Weekly Fee</th>
              <th scope="col" className={TABLE.th}>Status</th>
              <th scope="col" className={TABLE.th}>Fee Review</th>
              <th scope="col" className={`${TABLE.th} text-right`}>Balance</th>
              <th scope="col" className={TABLE.th}>Last Paid</th>
            </tr></thead>
            <tbody>
              {residents.length === 0 ? (
                <tr>
                  <td colSpan={9} className={TABLE.empty}>
                    <EmptyState
                      compact
                      title="No billing residents found"
                      description={canEdit ? 'Add the first resident billing profile to start tracking fees and balances.' : 'No resident billing profiles match the current filters.'}
                      actionLabel={canEdit ? 'Add Resident' : undefined}
                      onAction={canEdit ? openCreate : undefined}
                    />
                  </td>
                </tr>
              ) : residents.map(r => (
                <tr key={r.id} className={`${TABLE.tr} cursor-pointer`} {...clickableRowProps(() => openEdit(r))}>
                  <td className={`${TABLE.td} font-medium`}>{r.resident_name}</td>
                  <td className={TABLE.td}>{r.room_number || '—'}</td>
                  <td className={TABLE.td}>{getLabel(r.care_type, CARE_TYPES)}</td>
                  <td className={TABLE.td}>{getLabel(r.funding_type, FUNDING_TYPES)}</td>
                  <td className={`${TABLE.tdMono} text-right`}>{formatCurrency(r.weekly_fee)}</td>
                  <td className={TABLE.td}><span className={BADGE[getStatusBadge(r.status, RESIDENT_STATUSES)]}>{getLabel(r.status, RESIDENT_STATUSES)}</span></td>
                  <td className={TABLE.td}>{r.next_fee_review || '—'}</td>
                  <td className={`${TABLE.tdMono} text-right`}>
                    {r.outstanding_balance > 0
                      ? <span className="text-amber-600 font-medium">{formatCurrency(r.outstanding_balance)}</span>
                      : <span className="text-green-600">{formatCurrency(0)}</span>}
                  </td>
                  <td className={TABLE.td}>{r.last_payment_date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
      </StickyTable>

      {/* Resident Modal */}
      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Resident' : 'Add Resident'} size="xl">
            <div className="flex gap-1 mb-4 border-b border-gray-200 overflow-x-auto">
              {[{ id: 'profile', label: 'Profile' }, { id: 'fees', label: 'Fees' }, { id: 'history', label: 'Fee History' }, { id: 'notes', label: 'Notes' }].map(t => (
                <button key={t.id} onClick={() => setModalTab(t.id)}
                  className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                    modalTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}>{t.label}</button>
              ))}
            </div>

            {modalTab === 'profile' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className={INPUT.label}>Resident Name *</label>
                  <input value={form.resident_name || ''} onChange={e => set('resident_name', e.target.value)} className={INPUT.base} /></div>
                <div><label className={INPUT.label}>Room Number</label>
                  <input value={form.room_number || ''} onChange={e => set('room_number', e.target.value)} className={INPUT.base} /></div>
                <div><label className={INPUT.label}>Status</label>
                  <select value={form.status || 'active'} onChange={e => set('status', e.target.value)} className={INPUT.select}>
                    {RESIDENT_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select></div>
                <div><label className={INPUT.label}>Care Type</label>
                  <select value={form.care_type || ''} onChange={e => set('care_type', e.target.value)} className={INPUT.select}>
                    <option value="">Select...</option>
                    {CARE_TYPES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select></div>
                <div><label className={INPUT.label}>Funding Type</label>
                  <select value={form.funding_type || ''} onChange={e => set('funding_type', e.target.value)} className={INPUT.select}>
                    {FUNDING_TYPES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select></div>
                <div><label className={INPUT.label}>Admission Date</label>
                  <input type="date" value={form.admission_date || ''} onChange={e => set('admission_date', e.target.value)} className={INPUT.base} /></div>
                <div><label className={INPUT.label}>Discharge Date</label>
                  <input type="date" value={form.discharge_date || ''} onChange={e => set('discharge_date', e.target.value || null)} className={INPUT.base} /></div>
                <div><label className={INPUT.label}>Funding Authority</label>
                  <input value={form.funding_authority || ''} onChange={e => set('funding_authority', e.target.value)} className={INPUT.base} /></div>
                <div><label className={INPUT.label}>Funding Reference</label>
                  <input value={form.funding_reference || ''} onChange={e => set('funding_reference', e.target.value)} className={INPUT.base} /></div>
              </div>
            )}

            {modalTab === 'fees' && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className={INPUT.label}>Weekly Fee</label>
                  <input type="number" step="0.01" inputMode="decimal" value={form.weekly_fee ?? ''} onChange={e => set('weekly_fee', e.target.value)} className={INPUT.base} /></div>
                {editing && Number(form.weekly_fee ?? editing.weekly_fee ?? 0) > Number(editing.weekly_fee ?? 0) && (
                  <div className="col-span-2">
                    <InlineNotice variant="warning">
                      Fee increases need at least 28 days&apos; notice. Immediate in-app increases are blocked until scheduled fee changes are implemented.
                    </InlineNotice>
                  </div>
                )}
                <div><label className={INPUT.label}>LA Contribution</label>
                  <input type="number" step="0.01" inputMode="decimal" value={form.la_contribution ?? ''} onChange={e => set('la_contribution', e.target.value)} className={INPUT.base} /></div>
                <div><label className={INPUT.label}>CHC Contribution</label>
                  <input type="number" step="0.01" inputMode="decimal" value={form.chc_contribution ?? ''} onChange={e => set('chc_contribution', e.target.value)} className={INPUT.base} /></div>
                <div><label className={INPUT.label}>FNC Amount</label>
                  <input type="number" step="0.01" inputMode="decimal" value={form.fnc_amount ?? ''} onChange={e => set('fnc_amount', e.target.value)} className={INPUT.base} /></div>
                <div className="col-span-2 grid grid-cols-2 gap-4 text-xs text-gray-500">
                  <p>CHC = NHS Continuing Healthcare funding for residents with a primary health need.</p>
                  <p>FNC = Funded Nursing Care contribution paid by the NHS towards registered nursing input.</p>
                </div>
                <div><label className={INPUT.label}>Top-Up Amount</label>
                  <input type="number" step="0.01" inputMode="decimal" value={form.top_up_amount ?? ''} onChange={e => set('top_up_amount', e.target.value)} className={INPUT.base} /></div>
                <div><label className={INPUT.label}>Top-Up Payer</label>
                  <input value={form.top_up_payer || ''} onChange={e => set('top_up_payer', e.target.value)} className={INPUT.base} /></div>
                <div><label className={INPUT.label}>Top-Up Contact</label>
                  <input value={form.top_up_contact || ''} onChange={e => set('top_up_contact', e.target.value)} className={INPUT.base} /></div>
                <div><label className={INPUT.label}>Last Fee Review</label>
                  <input type="date" value={form.last_fee_review || ''} onChange={e => set('last_fee_review', e.target.value || null)} className={INPUT.base} /></div>
                <div><label className={INPUT.label}>Next Fee Review</label>
                  <input type="date" value={form.next_fee_review || ''} onChange={e => set('next_fee_review', e.target.value || null)} className={INPUT.base} /></div>
                {editing && (
                  <div className="col-span-2"><label className={INPUT.label}>Fee Change Reason</label>
                    <input value={form._fee_change_reason || ''} onChange={e => set('_fee_change_reason', e.target.value)} className={INPUT.base} placeholder="Reason for fee change (recorded in history)" /></div>
                )}
                {editing?.last_payment_date && (
                  <div className="col-span-2 mt-1 p-3 bg-gray-50 rounded border border-gray-200 text-sm">
                    <span className="text-gray-500">Last payment:</span>{' '}
                    <span className="font-medium">{formatCurrency(editing.last_payment_amount)}</span>
                    <span className="text-gray-400 ml-1">on {editing.last_payment_date}</span>
                  </div>
                )}
                {editing && editing.outstanding_balance > 0 && (
                  <div className="col-span-2 p-3 bg-amber-50 rounded border border-amber-200 text-sm">
                    <span className="text-amber-700 font-medium">Outstanding: {formatCurrency(editing.outstanding_balance)}</span>
                  </div>
                )}
              </div>
            )}

            {modalTab === 'history' && (
              <div>
                {feeHistory.length === 0 ? (
                  <EmptyState compact title="No fee changes recorded yet" description="Fee review history will appear here once a resident fee is amended and saved." />
                ) : (
                  <div className={TABLE.wrapper}>
                    <table className={TABLE.table}>
                      <thead className={TABLE.thead}><tr>
                        <th scope="col" className={TABLE.th}>Date</th>
                        <th scope="col" className={`${TABLE.th} text-right`}>Previous</th>
                        <th scope="col" className={`${TABLE.th} text-right`}>New</th>
                        <th scope="col" className={TABLE.th}>Reason</th>
                        <th scope="col" className={TABLE.th}>By</th>
                      </tr></thead>
                      <tbody>
                        {feeHistory.map(f => (
                          <tr key={f.id} className={TABLE.tr}>
                            <td className={TABLE.td}>{f.effective_date}</td>
                            <td className={`${TABLE.tdMono} text-right`}>{formatCurrency(f.previous_weekly)}</td>
                            <td className={`${TABLE.tdMono} text-right`}>{formatCurrency(f.new_weekly)}</td>
                            <td className={TABLE.td}>{f.reason || '—'}</td>
                            <td className={TABLE.td}>{f.created_by || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {modalTab === 'notes' && (
              <div>
                <label className={INPUT.label}>Notes</label>
                <textarea rows={5} value={form.notes || ''} onChange={e => set('notes', e.target.value)} className={INPUT.base} />
              </div>
            )}

            <div className={MODAL.footer}>
              <button onClick={closeModal} className={BTN.secondary}>Cancel</button>
              {canEdit && <button onClick={handleSave} disabled={saving} className={BTN.primary}>{saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Resident'}</button>}
            </div>
      </Modal>
    </>
  );
}

// ── Invoices Tab ─────────────────────────────────────────────────────────────

function InvoicesTab({ home, canEdit }) {
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [invoices, setInvoices] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [lines, setLines] = useState([]);
  const [modalTab, setModalTab] = useState('details');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPayer, setFilterPayer] = useState('');
  const [residents, setResidents] = useState([]);
  const [saving, setSaving] = useState(false);
  useDirtyGuard(!!showModal);

  // Payment sub-form
  const [payForm, setPayForm] = useState({ amount: '', payment_method: 'bacs', payment_reference: '' });

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const filters = {};
      if (filterStatus) filters.status = filterStatus;
      if (filterPayer) filters.payer_type = filterPayer;
      const [invData, resData] = await Promise.all([
        getFinanceInvoices(home, filters),
        getFinanceResidents(home, { status: 'active', limit: 500 }),
      ]);
      setInvoices(invData.rows || []);
      setTotal(invData.total || 0);
      setResidents(resData.rows || []);
      setError(null);
    } catch (e) { setError(normalizeFinanceError(e.message)); }
    finally { setLoading(false); }
  }, [home, filterStatus, filterPayer]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setForm({ payer_type: 'resident', payer_name: '', status: 'draft', issue_date: todayLocalISO() });
    setLines([{ description: '', quantity: 1, unit_price: '', amount: '', line_type: 'fee' }]);
    setModalTab('details');
    setPayForm({ amount: '', payment_method: 'bacs', payment_reference: '' });
    setShowModal(true);
  }

  async function openEdit(inv) {
    setEditing(inv);
    setForm({ ...inv });
    // Fetch full invoice with lines
    try {
      const { getFinanceInvoice } = await import('../lib/api.js');
      const full = await getFinanceInvoice(home, inv.id);
      setForm({ ...full });
      setLines(full.lines?.length ? full.lines : []);
    } catch {
      setLines([]);
    }
    setModalTab('details');
    setPayForm({ amount: '', payment_method: 'bacs', payment_reference: '' });
    setShowModal(true);
  }

  function closeModal() { setShowModal(false); setEditing(null); setForm({}); setLines([]); }

  async function handleSave() {
    if (saving) return;
    setError(null);
    if (!form.payer_name?.trim() || !form.payer_type) {
      setError('Payer type and payer name are required.');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, lines: lines.map(l => ({ ...l, amount: parseFloat(l.amount) || (parseFloat(l.quantity) * parseFloat(l.unit_price)) || 0 })) };
      if (editing?.id) {
        await updateFinanceInvoice(home, editing.id, { ...payload, _version: editing.version });
        showNotice('Invoice updated.');
        showToast({ title: 'Invoice updated', message: form.payer_name });
      } else {
        await createFinanceInvoice(home, payload);
        showNotice('Invoice created.');
        showToast({ title: 'Invoice created', message: form.payer_name });
      }
      closeModal();
      await load();
    } catch (e) { setError(normalizeFinanceError(e.message)); }
    finally { setSaving(false); }
  }

  async function handlePayment() {
    if (saving) return;
    if (!editing?.id || !payForm.amount) return;
    setSaving(true);
    setError(null);
    try {
      await recordFinancePayment(home, editing.id, payForm);
      showNotice('Payment recorded against invoice.');
      showToast({ title: 'Payment recorded', message: editing.invoice_number || editing.payer_name });
      closeModal();
      await load();
    } catch (e) { setError(normalizeFinanceError(e.message)); }
    finally { setSaving(false); }
  }

  async function handleVoidInvoice() {
    if (!editing?.id || saving) return;
    if (!await confirm(`Void invoice ${editing.invoice_number || editing.id}?`)) return;
    setSaving(true);
    setError(null);
    try {
      await voidFinanceInvoice(home, editing.id);
      showNotice('Invoice voided.');
      showToast({ title: 'Invoice voided', message: editing.invoice_number || editing.payer_name });
      closeModal();
      await load();
    } catch (e) {
      setError(normalizeFinanceError(e.message));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreditInvoice() {
    if (!editing?.id || saving) return;
    if (!await confirm(`Issue a credit note for invoice ${editing.invoice_number || editing.id}?`)) return;
    setSaving(true);
    setError(null);
    try {
      await creditFinanceInvoice(home, editing.id);
      showNotice('Credit note issued.');
      showToast({ title: 'Credit note created', message: editing.invoice_number || editing.payer_name });
      closeModal();
      await load();
    } catch (e) {
      setError(normalizeFinanceError(e.message));
    } finally {
      setSaving(false);
    }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const selectedResident = useMemo(
    () => residents.find(r => r.id === form.resident_id) || null,
    [form.resident_id, residents],
  );

  function updateLine(idx, field, value) {
    setLines(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      if (field === 'quantity' || field === 'unit_price') {
        updated[idx].amount = ((parseFloat(updated[idx].quantity) || 0) * (parseFloat(updated[idx].unit_price) || 0)).toFixed(2);
      }
      return updated;
    });
  }

  function addLine() {
    setLines(prev => [...prev, { description: '', quantity: 1, unit_price: '', amount: '', line_type: 'fee' }]);
  }

  function removeLine(idx) {
    setLines(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleExportInvoices() {
    const { downloadXLSX } = await import('../lib/excel.js');
    downloadXLSX('finance_invoices.xlsx', [{
      name: 'Invoices',
      headers: ['Invoice #', 'Payer', 'Type', 'Period Start', 'Period End', 'Total', 'Paid', 'Balance', 'Status', 'Due Date'],
      rows: invoices.map(inv => [
        inv.invoice_number, inv.payer_name, inv.payer_type,
        inv.period_start || '', inv.period_end || '',
        inv.total_amount, inv.amount_paid, inv.balance_due, inv.status, inv.due_date || '',
      ]),
    }]);
  }

  if (loading) return <LoadingState message="Loading invoices..." card />;

  if (error && invoices.length === 0) {
    return <ErrorState title="Unable to load invoices" message={error} onRetry={() => void load()} />;
  }

  return (
    <>
      {ConfirmDialog}
      {notice && (
        <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">
          {notice.content}
        </InlineNotice>
      )}

      {error && <ErrorState title="Some invoice actions need attention" message={error} onRetry={() => void load()} className="mb-4" />}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="">All Statuses</option>
          {INVOICE_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={filterPayer} onChange={e => setFilterPayer(e.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="">All Payers</option>
          {PAYER_TYPES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <span className="text-sm text-gray-500">{total} invoice{total !== 1 ? 's' : ''}</span>
        <div className="flex-1" />
        <button onClick={handleExportInvoices} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
        {canEdit && <button onClick={openCreate} className={BTN.primary}>New Invoice</button>}
      </div>

      <StickyTable className={CARD.flush}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}><tr>
              <th scope="col" className={TABLE.th}>Invoice #</th>
              <th scope="col" className={TABLE.th}>Payer</th>
              <th scope="col" className={TABLE.th}>Type</th>
              <th scope="col" className={TABLE.th}>Period</th>
              <th scope="col" className={`${TABLE.th} text-right`}>Total</th>
              <th scope="col" className={`${TABLE.th} text-right`}>Balance</th>
              <th scope="col" className={TABLE.th}>Status</th>
              <th scope="col" className={TABLE.th}>Due</th>
            </tr></thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className={TABLE.empty}>
                    <EmptyState
                      compact
                      title="No invoices found"
                      description={canEdit ? 'Create the first invoice for this home to start tracking payments and balances.' : 'No invoices match the current filters.'}
                      actionLabel={canEdit ? 'New Invoice' : undefined}
                      onAction={canEdit ? openCreate : undefined}
                    />
                  </td>
                </tr>
              ) : invoices.map(inv => (
                <tr key={inv.id} className={`${TABLE.tr} cursor-pointer`} {...clickableRowProps(() => openEdit(inv))}>
                  <td className={`${TABLE.td} font-medium font-mono`}>{inv.invoice_number}</td>
                  <td className={TABLE.td}>{inv.payer_name}</td>
                  <td className={TABLE.td}>{getLabel(inv.payer_type, PAYER_TYPES)}</td>
                  <td className={TABLE.td}>{inv.period_start ? `${inv.period_start} — ${inv.period_end || ''}` : '—'}</td>
                  <td className={`${TABLE.tdMono} text-right`}>{formatCurrency(inv.total_amount)}</td>
                  <td className={`${TABLE.tdMono} text-right ${inv.balance_due > 0 ? 'text-red-600' : ''}`}>{formatCurrency(inv.balance_due)}</td>
                  <td className={TABLE.td}><span className={BADGE[getStatusBadge(inv.status, INVOICE_STATUSES)]}>{getLabel(inv.status, INVOICE_STATUSES)}</span></td>
                  <td className={TABLE.td}>{inv.due_date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
      </StickyTable>

      {/* Invoice Modal */}
      <Modal isOpen={showModal} onClose={closeModal} title={editing ? `Invoice ${editing.invoice_number || ''}` : 'New Invoice'} size="wide">
            <div className="flex gap-1 mb-4 border-b border-gray-200 overflow-x-auto">
              {[{ id: 'details', label: 'Details' }, { id: 'lines', label: 'Lines' }, ...(editing ? [{ id: 'payment', label: 'Payment' }] : [])].map(t => (
                <button key={t.id} onClick={() => setModalTab(t.id)}
                  className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                    modalTab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}>{t.label}</button>
              ))}
            </div>

            {modalTab === 'details' && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className={INPUT.label}>Payer Type *</label>
                  <select value={form.payer_type || ''} onChange={e => set('payer_type', e.target.value)} className={INPUT.select}>
                    {PAYER_TYPES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select></div>
                <div><label className={INPUT.label}>Payer Name *</label>
                  <input value={form.payer_name || ''} onChange={e => set('payer_name', e.target.value)} className={INPUT.base} /></div>
                <div><label className={INPUT.label}>Resident</label>
                  <select value={form.resident_id || ''} onChange={e => set('resident_id', e.target.value ? parseInt(e.target.value) : null)} className={INPUT.select}>
                    <option value="">None</option>
                    {residents.map(r => <option key={r.id} value={r.id}>{r.resident_name} (Room {r.room_number || '?'})</option>)}
                  </select></div>
                {selectedResident?.outstanding_balance > 0 && (
                  <div className="col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    This resident has {formatCurrency(selectedResident.outstanding_balance)} outstanding from prior invoices.
                  </div>
                )}
                <div><label className={INPUT.label}>Payer Reference</label>
                  <input value={form.payer_reference || ''} onChange={e => set('payer_reference', e.target.value)} className={INPUT.base} /></div>
                <div><label className={INPUT.label}>Period Start</label>
                  <input type="date" value={form.period_start || ''} onChange={e => set('period_start', e.target.value)} className={INPUT.base} /></div>
                <div><label className={INPUT.label}>Period End</label>
                  <input type="date" value={form.period_end || ''} onChange={e => set('period_end', e.target.value)} className={INPUT.base} /></div>
                <div><label className={INPUT.label}>Issue Date</label>
                  <input type="date" value={form.issue_date || ''} onChange={e => set('issue_date', e.target.value)} className={INPUT.base} /></div>
                <div><label className={INPUT.label}>Due Date</label>
                  <input type="date" value={form.due_date || ''} onChange={e => set('due_date', e.target.value)} className={INPUT.base} /></div>
                <div><label className={INPUT.label}>Status</label>
                  <select value={form.status || 'draft'} onChange={e => set('status', e.target.value)} className={INPUT.select}>
                    {INVOICE_STATUSES.filter(s => ['draft', 'sent'].includes(s.id)).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select></div>
                <div><label className={INPUT.label}>Adjustments</label>
                  <input type="number" step="0.01" inputMode="decimal" value={form.adjustments ?? ''} onChange={e => set('adjustments', e.target.value)} className={INPUT.base} /></div>
                <div className="col-span-2"><label className={INPUT.label}>Notes</label>
                  <textarea rows={2} value={form.notes || ''} onChange={e => set('notes', e.target.value)} className={INPUT.base} /></div>
              </div>
            )}

            {modalTab === 'lines' && (
              <div>
                <div className="space-y-3">
                  {lines.map((line, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-4"><label className={INPUT.label}>Description</label>
                        <input value={line.description || ''} onChange={e => updateLine(idx, 'description', e.target.value)} className={INPUT.sm} /></div>
                      <div className="col-span-2"><label className={INPUT.label}>Type</label>
                        <select value={line.line_type || 'fee'} onChange={e => updateLine(idx, 'line_type', e.target.value)} className={INPUT.sm}>
                          {LINE_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select></div>
                      <div className="col-span-1"><label className={INPUT.label}>Qty</label>
                        <input type="number" step="0.01" inputMode="decimal" value={line.quantity ?? 1} onChange={e => updateLine(idx, 'quantity', e.target.value)} className={INPUT.sm} /></div>
                      <div className="col-span-2"><label className={INPUT.label}>Unit Price</label>
                        <input type="number" step="0.01" inputMode="decimal" value={line.unit_price ?? ''} onChange={e => updateLine(idx, 'unit_price', e.target.value)} className={INPUT.sm} /></div>
                      <div className="col-span-2"><label className={INPUT.label}>Amount</label>
                        <input type="number" step="0.01" inputMode="decimal" value={line.amount ?? ''} onChange={e => updateLine(idx, 'amount', e.target.value)} className={`${INPUT.sm} bg-gray-50`} readOnly /></div>
                      <div className="col-span-1">
                        <button onClick={() => removeLine(idx)} className={`${BTN.ghost} ${BTN.xs} text-red-500`}>x</button>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={addLine} className={`${BTN.secondary} ${BTN.sm} mt-3`}>+ Add Line</button>
                <div className="mt-3 text-right text-sm font-medium text-gray-700">
                  Subtotal: {formatCurrency(lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0))}
                </div>
              </div>
            )}

            {modalTab === 'payment' && editing && (
              <div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className={CARD.padded}>
                    <p className="text-xs text-gray-500">Total Amount</p>
                    <p className="text-lg font-bold">{formatCurrency(editing.total_amount)}</p>
                  </div>
                  <div className={CARD.padded}>
                    <p className="text-xs text-gray-500">Balance Due</p>
                    <p className={`text-lg font-bold ${editing.balance_due > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatCurrency(editing.balance_due)}</p>
                  </div>
                </div>
                {editing.balance_due > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className={INPUT.label}>Payment Amount *</label>
                      <input type="number" step="0.01" inputMode="decimal" value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))} className={INPUT.base} placeholder={`Max: ${editing.balance_due}`} /></div>
                    <div><label className={INPUT.label}>Method</label>
                      <select value={payForm.payment_method} onChange={e => setPayForm(p => ({ ...p, payment_method: e.target.value }))} className={INPUT.select}>
                        {PAYMENT_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select></div>
                    <div className="col-span-2"><label className={INPUT.label}>Reference</label>
                      <input value={payForm.payment_reference} onChange={e => setPayForm(p => ({ ...p, payment_reference: e.target.value }))} className={INPUT.base} placeholder="Payment reference" /></div>
                    {canEdit && <div className="col-span-2">
                      <button onClick={handlePayment} disabled={saving} className={BTN.success}>{saving ? 'Recording...' : 'Record Payment'}</button>
                    </div>}
                  </div>
                )}
                {canEdit && editing.amount_paid <= 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {['draft', 'sent', 'overdue'].includes(editing.status) && (
                      <button onClick={handleVoidInvoice} disabled={saving} className={BTN.secondary}>
                        {saving ? 'Working...' : 'Void Invoice'}
                      </button>
                    )}
                    {['sent', 'overdue'].includes(editing.status) && (
                      <button onClick={handleCreditInvoice} disabled={saving} className={BTN.secondary}>
                        {saving ? 'Working...' : 'Issue Credit Note'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className={MODAL.footer}>
              <button onClick={closeModal} className={BTN.secondary}>Cancel</button>
              {canEdit && modalTab !== 'payment' && <button onClick={handleSave} disabled={saving} className={BTN.primary}>{saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Invoice'}</button>}
            </div>
      </Modal>
    </>
  );
}
