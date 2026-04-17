import { useState, useEffect, useCallback, useMemo } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import { getCurrentHome, getReceivablesDetail, getInvoiceChases, createInvoiceChase } from '../lib/api.js';
import { CHASE_METHODS, PAYER_TYPES, getLabel, formatCurrency } from '../lib/finance.js';
import { clickableRowProps } from '../lib/a11y.js';
import { useData } from '../contexts/DataContext.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import { todayLocalISO } from '../lib/localDates.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import useTransientNotice from '../hooks/useTransientNotice.js';

const BUCKETS = [
  { id: 'all', label: 'All', key: null },
  { id: 'current', label: 'Current', key: 'current', min: null, max: 0 },
  { id: '1-30', label: '1-30 days', key: 'days_1_30', min: 1, max: 30 },
  { id: '31-60', label: '31-60 days', key: 'days_31_60', min: 31, max: 60 },
  { id: '61-90', label: '61-90 days', key: 'days_61_90', min: 61, max: 90 },
  { id: '90+', label: '90+ days', key: 'days_90_plus', min: 91, max: Infinity },
];

export default function ReceivablesManager() {
  const { canWrite } = useData();
  const canEdit = canWrite('finance');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterBucket, setFilterBucket] = useState('all');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [chases, setChases] = useState([]);
  const [showChaseModal, setShowChaseModal] = useState(false);
  const [chaseForm, setChaseForm] = useState({});
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState([]);
  const [showBulkChaseModal, setShowBulkChaseModal] = useState(false);
  const [bulkChaseForm, setBulkChaseForm] = useState({});
  const [saving, setSaving] = useState(false);
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const home = getCurrentHome();
  useDirtyGuard(!!showChaseModal);

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      setData(await getReceivablesDetail(home));
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [home]);

  useEffect(() => { load(); }, [load]);

  async function openChaseModal(invoice) {
    setSelectedInvoice(invoice);
    setError(null);
    setChaseForm({ chase_date: todayLocalISO(), method: 'phone' });
    try {
      setChases(await getInvoiceChases(home, invoice.id));
    } catch { setChases([]); }
    setShowChaseModal(true);
  }

  function closeChaseModal() {
    setShowChaseModal(false);
    setSelectedInvoice(null);
    setChases([]);
    setChaseForm({});
  }

  function closeBulkChaseModal() {
    setShowBulkChaseModal(false);
    setBulkChaseForm({});
  }

  async function handleAddChase() {
    if (saving) return;
    setError(null);
    if (!selectedInvoice || !chaseForm.chase_date || !chaseForm.method) {
      setError('Please fill in chase date and method');
      return;
    }
    setSaving(true);
    try {
      await createInvoiceChase(home, selectedInvoice.id, chaseForm);
      setChases(await getInvoiceChases(home, selectedInvoice.id));
      load();
      showNotice('Chase recorded.');
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleBulkChase() {
    if (saving) return;
    setError(null);
    if (selectedInvoiceIds.length === 0 || !bulkChaseForm.chase_date || !bulkChaseForm.method) {
      setError('Please select at least one invoice and enter chase date and method');
      return;
    }
    setSaving(true);
    try {
      for (const invoiceId of selectedInvoiceIds) {
        await createInvoiceChase(home, invoiceId, bulkChaseForm);
      }
      setSelectedInvoiceIds([]);
      closeBulkChaseModal();
      await load();
      showNotice(`Chase logged for ${selectedInvoiceIds.length} invoice${selectedInvoiceIds.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    if (!data?.overdue_items?.length) return;
    const { downloadXLSX } = await import('../lib/excel.js');
    downloadXLSX('receivables_ageing.xlsx', [{
      name: 'Outstanding Invoices',
      headers: ['Invoice #', 'Payer', 'Type', 'Total', 'Paid', 'Outstanding', 'Due Date', 'Days Overdue', 'Last Chase Date', 'Last Chase Method', 'Next Action'],
      rows: data.overdue_items.map(i => [
        i.invoice_number, i.payer_name, i.payer_type,
        i.total_amount, i.amount_paid, i.outstanding, i.due_date, i.days_overdue,
        i.last_chase?.chase_date || '', i.last_chase?.method || '', i.last_chase?.next_action_date || '',
      ]),
    }]);
  }

  const setChaseField = (k, v) => setChaseForm(f => ({ ...f, [k]: v }));
  const setBulkChaseField = (k, v) => setBulkChaseForm(f => ({ ...f, [k]: v }));

  const filteredItems = useMemo(() => (data?.overdue_items?.filter(item => {
    if (filterBucket === 'all') return true;
    const bucket = BUCKETS.find(b => b.id === filterBucket);
    if (!bucket || bucket.min === null) return item.days_overdue <= 0;
    return item.days_overdue >= bucket.min && item.days_overdue <= bucket.max;
  }) || []), [data?.overdue_items, filterBucket]);
  const selectedInvoices = useMemo(
    () => filteredItems.filter(item => selectedInvoiceIds.includes(item.id)),
    [filteredItems, selectedInvoiceIds],
  );

  function toggleInvoiceSelection(invoiceId) {
    setSelectedInvoiceIds(current => (
      current.includes(invoiceId)
        ? current.filter(id => id !== invoiceId)
        : [...current, invoiceId]
    ));
  }

  function toggleSelectAllVisible() {
    const visibleIds = filteredItems.map(item => item.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedInvoiceIds.includes(id));
    setSelectedInvoiceIds(current => {
      if (allVisibleSelected) {
        return current.filter(id => !visibleIds.includes(id));
      }
      return Array.from(new Set([...current, ...visibleIds]));
    });
  }

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading receivables and chase history..." card /></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Receivables</h1>
          <p className={PAGE.subtitle}>Outstanding invoices, ageing and chase management</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
        </div>
      </div>

      {notice && <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">{notice.content}</InlineNotice>}
      {error && <ErrorState title="Unable to load receivables" message={error} onRetry={load} className="mb-4" />}

      {/* Ageing Cards */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {BUCKETS.filter(b => b.key).map(b => (
            <button key={b.id} onClick={() => setFilterBucket(filterBucket === b.id ? 'all' : b.id)}
              className={`${CARD.padded} text-center transition-all cursor-pointer ${filterBucket === b.id ? 'ring-2 ring-blue-500' : ''}`}>
              <p className="text-xs text-gray-500">{b.label}</p>
              <p className={`text-lg font-bold ${b.id === 'current' ? 'text-emerald-600' : b.id === '1-30' ? 'text-amber-600' : b.id === '31-60' ? 'text-orange-600' : 'text-red-600'}`}>
                {formatCurrency(data.buckets?.[b.key] ?? 0)}
              </p>
            </button>
          ))}
          <div className={`${CARD.padded} text-center`}>
            <p className="text-xs text-gray-500">Total Outstanding</p>
            <p className="text-lg font-bold text-gray-900">{formatCurrency(data.total_outstanding ?? 0)}</p>
          </div>
        </div>
      )}

      {/* Chase Follow-ups Banner */}
      {data?.chases_due?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg mb-4 text-sm">
          {data.chases_due.length} chase follow-up{data.chases_due.length > 1 ? 's' : ''} due today or overdue
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-3 mb-4">
        <select value={filterBucket} onChange={e => setFilterBucket(e.target.value)} className={`${INPUT.select} w-auto`}>
          {BUCKETS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
        <span className="text-sm text-gray-500">{filteredItems.length} invoice{filteredItems.length !== 1 ? 's' : ''}</span>
        {canEdit && selectedInvoiceIds.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setBulkChaseForm({ chase_date: todayLocalISO(), method: 'phone' });
              setShowBulkChaseModal(true);
            }}
            className={`${BTN.secondary} ${BTN.sm}`}
          >
            Log chase on {selectedInvoiceIds.length} selected
          </button>
        )}
      </div>

      {/* Outstanding Invoices Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}><tr>
              {canEdit && (
                <th scope="col" className={TABLE.th}>
                  <input
                    type="checkbox"
                    aria-label="Select all visible invoices"
                    checked={filteredItems.length > 0 && filteredItems.every(item => selectedInvoiceIds.includes(item.id))}
                    onChange={toggleSelectAllVisible}
                    className="accent-blue-600"
                  />
                </th>
              )}
              <th scope="col" className={TABLE.th}>Invoice #</th>
              <th scope="col" className={TABLE.th}>Payer</th>
              <th scope="col" className={TABLE.th}>Type</th>
              <th scope="col" className={`${TABLE.th} text-right`}>Total</th>
              <th scope="col" className={`${TABLE.th} text-right`}>Outstanding</th>
              <th scope="col" className={TABLE.th}>Due Date</th>
              <th scope="col" className={`${TABLE.th} text-right`}>Days Overdue</th>
              <th scope="col" className={TABLE.th}>Last Chase</th>
              <th scope="col" className={TABLE.th}>Next Action</th>
            </tr></thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr><td colSpan={canEdit ? 10 : 9} className={TABLE.empty}><EmptyState title="No outstanding invoices" description="Everything in this ageing bucket is settled." compact /></td></tr>
              ) : filteredItems.map(item => {
                const today = todayLocalISO();
                const actionOverdue = item.last_chase?.next_action_date && item.last_chase.next_action_date <= today;
                return (
                  <tr key={item.id} className={`${TABLE.tr} cursor-pointer`} {...clickableRowProps(() => openChaseModal(item))}>
                    {canEdit && (
                      <td className={TABLE.td} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select invoice ${item.invoice_number}`}
                          checked={selectedInvoiceIds.includes(item.id)}
                          onChange={() => toggleInvoiceSelection(item.id)}
                          className="accent-blue-600"
                        />
                      </td>
                    )}
                    <td className={`${TABLE.td} font-medium font-mono`}>{item.invoice_number}</td>
                    <td className={TABLE.td}>{item.payer_name}</td>
                    <td className={TABLE.td}>{getLabel(item.payer_type, PAYER_TYPES)}</td>
                    <td className={`${TABLE.tdMono} text-right`}>{formatCurrency(item.total_amount)}</td>
                    <td className={`${TABLE.tdMono} text-right text-red-600`}>{formatCurrency(item.outstanding)}</td>
                    <td className={TABLE.td}>{item.due_date}</td>
                    <td className={`${TABLE.tdMono} text-right`}>
                      <span className={item.days_overdue > 90 ? 'text-red-600 font-bold' : item.days_overdue > 60 ? 'text-red-600' : item.days_overdue > 30 ? 'text-orange-600' : 'text-amber-600'}>
                        {item.days_overdue}
                      </span>
                    </td>
                    <td className={TABLE.td}>
                      {item.last_chase ? (
                        <span className="text-xs">{item.last_chase.chase_date} <span className={BADGE.gray}>{item.last_chase.method}</span></span>
                      ) : <span className="text-gray-400 text-xs">None</span>}
                    </td>
                    <td className={TABLE.td}>
                      {item.last_chase?.next_action_date ? (
                        <span className={`text-xs ${actionOverdue ? 'text-red-600 font-bold' : ''}`}>{item.last_chase.next_action_date}</span>
                      ) : <span className="text-gray-400 text-xs">&mdash;</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Chase Modal */}
      <Modal isOpen={!!(showChaseModal && selectedInvoice)} onClose={closeChaseModal} title={`Chase Log \u2014 ${selectedInvoice?.invoice_number || ''}`} size="lg">
        <div className="flex items-center gap-4 mb-4 text-sm">
          <span><strong>Payer:</strong> {selectedInvoice?.payer_name}</span>
          <span><strong>Outstanding:</strong> <span className="text-red-600 font-bold">{formatCurrency(selectedInvoice?.outstanding)}</span></span>
          <span><strong>Overdue:</strong> {selectedInvoice?.days_overdue} days</span>
        </div>

        {/* Chase History */}
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Chase History</h3>
        {chases.length === 0 ? (
          <EmptyState title="No chase records yet" description="Record the first reminder or follow-up for this invoice below." compact />
        ) : (
          <div className={`${TABLE.wrapper} mb-4`}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}><tr>
                <th scope="col" className={TABLE.th}>Date</th>
                <th scope="col" className={TABLE.th}>Method</th>
                <th scope="col" className={TABLE.th}>Contact</th>
                <th scope="col" className={TABLE.th}>Outcome</th>
                <th scope="col" className={TABLE.th}>Next Action</th>
              </tr></thead>
              <tbody>
                {chases.map(c => (
                  <tr key={c.id} className={TABLE.tr}>
                    <td className={TABLE.td}>{c.chase_date}</td>
                    <td className={TABLE.td}><span className={BADGE.blue}>{getLabel(c.method, CHASE_METHODS)}</span></td>
                    <td className={TABLE.td}>{c.contact_name || '\u2014'}</td>
                    <td className={`${TABLE.td} max-w-48 truncate`}>{c.outcome || '\u2014'}</td>
                    <td className={TABLE.td}>{c.next_action_date || '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add Chase Form */}
        <h3 className="text-sm font-semibold text-gray-700 mb-2 mt-4">Record Chase</h3>
        <div className="grid grid-cols-2 gap-3">
          <div><label htmlFor="receivables-chase-date" className={INPUT.label}>Date *</label>
            <input id="receivables-chase-date" type="date" value={chaseForm.chase_date || ''} onChange={e => setChaseField('chase_date', e.target.value)} className={INPUT.base} /></div>
          <div><label htmlFor="receivables-chase-method" className={INPUT.label}>Method *</label>
            <select id="receivables-chase-method" value={chaseForm.method || ''} onChange={e => setChaseField('method', e.target.value)} className={INPUT.select}>
              {CHASE_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select></div>
          <div><label className={INPUT.label}>Contact Name</label>
            <input value={chaseForm.contact_name || ''} onChange={e => setChaseField('contact_name', e.target.value)} className={INPUT.base} /></div>
          <div><label className={INPUT.label}>Next Action Date</label>
            <input type="date" value={chaseForm.next_action_date || ''} onChange={e => setChaseField('next_action_date', e.target.value || null)} className={INPUT.base} /></div>
          <div className="col-span-2"><label className={INPUT.label}>Outcome</label>
            <textarea rows={2} value={chaseForm.outcome || ''} onChange={e => setChaseField('outcome', e.target.value)} className={INPUT.base} /></div>
          <div className="col-span-2"><label className={INPUT.label}>Notes</label>
            <textarea rows={2} value={chaseForm.notes || ''} onChange={e => setChaseField('notes', e.target.value)} className={INPUT.base} /></div>
        </div>

        <div className={MODAL.footer}>
          <button onClick={closeChaseModal} className={BTN.secondary}>Close</button>
          {canEdit && <button onClick={handleAddChase} disabled={saving} className={BTN.primary}>{saving ? 'Saving...' : 'Record Chase'}</button>}
        </div>
      </Modal>

      <Modal isOpen={showBulkChaseModal} onClose={closeBulkChaseModal} title={`Log chase on ${selectedInvoiceIds.length} invoice${selectedInvoiceIds.length === 1 ? '' : 's'}`} size="lg">
        <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          {selectedInvoices.length > 0
            ? selectedInvoices.map(invoice => invoice.invoice_number).join(', ')
            : 'Selected invoices will all receive the same chase log entry.'}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="bulk-chase-date" className={INPUT.label}>Date *</label>
            <input id="bulk-chase-date" type="date" value={bulkChaseForm.chase_date || ''} onChange={e => setBulkChaseField('chase_date', e.target.value)} className={INPUT.base} />
          </div>
          <div>
            <label htmlFor="bulk-chase-method" className={INPUT.label}>Method *</label>
            <select id="bulk-chase-method" value={bulkChaseForm.method || ''} onChange={e => setBulkChaseField('method', e.target.value)} className={INPUT.select}>
              {CHASE_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className={INPUT.label}>Contact Name</label>
            <input value={bulkChaseForm.contact_name || ''} onChange={e => setBulkChaseField('contact_name', e.target.value)} className={INPUT.base} />
          </div>
          <div>
            <label className={INPUT.label}>Next Action Date</label>
            <input type="date" value={bulkChaseForm.next_action_date || ''} onChange={e => setBulkChaseField('next_action_date', e.target.value || null)} className={INPUT.base} />
          </div>
          <div className="col-span-2">
            <label className={INPUT.label}>Outcome</label>
            <textarea rows={2} value={bulkChaseForm.outcome || ''} onChange={e => setBulkChaseField('outcome', e.target.value)} className={INPUT.base} />
          </div>
          <div className="col-span-2">
            <label className={INPUT.label}>Notes</label>
            <textarea rows={2} value={bulkChaseForm.notes || ''} onChange={e => setBulkChaseField('notes', e.target.value)} className={INPUT.base} />
          </div>
        </div>
        <div className={MODAL.footer}>
          <button onClick={closeBulkChaseModal} className={BTN.secondary}>Close</button>
          <button onClick={handleBulkChase} disabled={saving || selectedInvoiceIds.length === 0} className={BTN.primary}>
            {saving ? 'Saving...' : `Log chase on ${selectedInvoiceIds.length}`}
          </button>
        </div>
      </Modal>
    </div>
  );
}
