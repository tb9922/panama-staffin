import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import { getCurrentHome, getReceivablesDetail, getInvoiceChases, createInvoiceChase } from '../lib/api.js';
import { CHASE_METHODS, PAYER_TYPES, getLabel, formatCurrency } from '../lib/finance.js';

const BUCKETS = [
  { id: 'all', label: 'All', key: null },
  { id: 'current', label: 'Current', key: 'current', min: null, max: 0 },
  { id: '1-30', label: '1-30 days', key: 'days_1_30', min: 1, max: 30 },
  { id: '31-60', label: '31-60 days', key: 'days_31_60', min: 31, max: 60 },
  { id: '61-90', label: '61-90 days', key: 'days_61_90', min: 61, max: 90 },
  { id: '90+', label: '90+ days', key: 'days_90_plus', min: 91, max: Infinity },
];

export default function ReceivablesManager({ user }) {
  const isAdmin = user?.role === 'admin';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterBucket, setFilterBucket] = useState('all');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [chases, setChases] = useState([]);
  const [showChaseModal, setShowChaseModal] = useState(false);
  const [chaseForm, setChaseForm] = useState({});
  const home = getCurrentHome();

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

  useEffect(() => {
    if (!showChaseModal) return;
    const handler = e => { if (e.key === 'Escape') closeChaseModal(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showChaseModal]);

  async function openChaseModal(invoice) {
    setSelectedInvoice(invoice);
    setError(null);
    setChaseForm({ chase_date: new Date().toISOString().slice(0, 10), method: 'phone' });
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

  async function handleAddChase() {
    setError(null);
    if (!selectedInvoice || !chaseForm.chase_date || !chaseForm.method) {
      setError('Please fill in chase date and method');
      return;
    }
    try {
      await createInvoiceChase(home, selectedInvoice.id, chaseForm);
      setChases(await getInvoiceChases(home, selectedInvoice.id));
      load();
    } catch (e) { setError(e.message); }
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

  const filteredItems = data?.overdue_items?.filter(item => {
    if (filterBucket === 'all') return true;
    const bucket = BUCKETS.find(b => b.id === filterBucket);
    if (!bucket || bucket.min === null) return item.days_overdue <= 0;
    return item.days_overdue >= bucket.min && item.days_overdue <= bucket.max;
  }) || [];

  if (loading) return <div className={PAGE.container}><div className={CARD.padded}><p className="text-center py-10 text-gray-500">Loading receivables...</p></div></div>;

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

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>}

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
      </div>

      {/* Outstanding Invoices Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}><tr>
              <th className={TABLE.th}>Invoice #</th>
              <th className={TABLE.th}>Payer</th>
              <th className={TABLE.th}>Type</th>
              <th className={`${TABLE.th} text-right`}>Total</th>
              <th className={`${TABLE.th} text-right`}>Outstanding</th>
              <th className={TABLE.th}>Due Date</th>
              <th className={`${TABLE.th} text-right`}>Days Overdue</th>
              <th className={TABLE.th}>Last Chase</th>
              <th className={TABLE.th}>Next Action</th>
            </tr></thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr><td colSpan={9} className={TABLE.empty}>No outstanding invoices</td></tr>
              ) : filteredItems.map(item => {
                const today = new Date().toISOString().slice(0, 10);
                const actionOverdue = item.last_chase?.next_action_date && item.last_chase.next_action_date <= today;
                return (
                  <tr key={item.id} className={`${TABLE.tr} cursor-pointer`} onClick={() => openChaseModal(item)}>
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
      {showChaseModal && selectedInvoice && (
        <div className={MODAL.overlay} onClick={e => { if (e.target === e.currentTarget) closeChaseModal(); }}>
          <div className={MODAL.panelLg} role="dialog" aria-modal="true" aria-labelledby="chase-modal-title" onClick={e => e.stopPropagation()}>
            <h2 id="chase-modal-title" className={MODAL.title}>Chase Log &mdash; {selectedInvoice.invoice_number}</h2>
            <div className="flex items-center gap-4 mb-4 text-sm">
              <span><strong>Payer:</strong> {selectedInvoice.payer_name}</span>
              <span><strong>Outstanding:</strong> <span className="text-red-600 font-bold">{formatCurrency(selectedInvoice.outstanding)}</span></span>
              <span><strong>Overdue:</strong> {selectedInvoice.days_overdue} days</span>
            </div>

            {/* Chase History */}
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Chase History</h3>
            {chases.length === 0 ? (
              <p className="text-gray-400 text-sm py-3 text-center">No chase records yet</p>
            ) : (
              <div className={`${TABLE.wrapper} mb-4`}>
                <table className={TABLE.table}>
                  <thead className={TABLE.thead}><tr>
                    <th className={TABLE.th}>Date</th>
                    <th className={TABLE.th}>Method</th>
                    <th className={TABLE.th}>Contact</th>
                    <th className={TABLE.th}>Outcome</th>
                    <th className={TABLE.th}>Next Action</th>
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
              <div><label className={INPUT.label}>Date *</label>
                <input type="date" value={chaseForm.chase_date || ''} onChange={e => setChaseField('chase_date', e.target.value)} className={INPUT.base} /></div>
              <div><label className={INPUT.label}>Method *</label>
                <select value={chaseForm.method || ''} onChange={e => setChaseField('method', e.target.value)} className={INPUT.select}>
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
              {isAdmin && <button onClick={handleAddChase} className={BTN.primary}>Record Chase</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
