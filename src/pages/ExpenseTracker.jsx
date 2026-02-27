import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import {
  getCurrentHome, getLoggedInUser, getFinanceExpenses, createFinanceExpense,
  updateFinanceExpense, approveFinanceExpense,
} from '../lib/api.js';
import {
  EXPENSE_CATEGORIES, EXPENSE_STATUSES, PAYMENT_METHODS, SCHEDULE_FREQUENCIES,
  getStatusBadge, getLabel, formatCurrency,
} from '../lib/finance.js';

export default function ExpenseTracker() {
  const [expenses, setExpenses] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [readOnly, setReadOnly] = useState(false);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const home = getCurrentHome();
  const user = getLoggedInUser();

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const filters = {};
      if (filterCategory) filters.category = filterCategory;
      if (filterStatus) filters.status = filterStatus;
      const data = await getFinanceExpenses(home, filters);
      setExpenses(data.rows || []);
      setTotal(data.total || 0);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [home, filterCategory, filterStatus]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!showModal) return;
    const handler = e => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showModal]);

  function openCreate() {
    setEditing(null);
    setReadOnly(false);
    setError(null);
    setForm({
      expense_date: new Date().toISOString().slice(0, 10),
      category: 'other',
      status: 'pending',
      net_amount: '',
      vat_amount: '0',
      gross_amount: '',
      recurring: false,
    });
    setShowModal(true);
  }

  function openEdit(exp) {
    setEditing(exp);
    setReadOnly(exp.status === 'approved' || exp.status === 'paid');
    setError(null);
    setForm({ ...exp });
    setShowModal(true);
  }

  function closeModal() { setShowModal(false); setEditing(null); setForm({}); setReadOnly(false); }

  async function handleSave() {
    if (readOnly) return;
    setError(null);
    if (!form.description || !form.category || !form.net_amount) {
      setError('Please fill in all required fields');
      return;
    }
    try {
      const payload = {
        ...form,
        gross_amount: form.gross_amount || (parseFloat(form.net_amount || 0) + parseFloat(form.vat_amount || 0)),
      };
      if (editing?.id) {
        await updateFinanceExpense(home, editing.id, payload);
      } else {
        await createFinanceExpense(home, payload);
      }
      closeModal();
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleApprove(exp) {
    setError(null);
    try {
      await approveFinanceExpense(home, exp.id);
      load();
    } catch (e) { setError(e.message); }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleExport() {
    const { downloadXLSX } = await import('../lib/excel.js');
    downloadXLSX('finance_expenses.xlsx', [{
      name: 'Expenses',
      headers: ['Date', 'Category', 'Description', 'Supplier', 'Net', 'VAT', 'Gross', 'Status', 'Approved By'],
      rows: expenses.map(e => [
        e.expense_date, e.category, e.description, e.supplier || '',
        e.net_amount, e.vat_amount, e.gross_amount, e.status, e.approved_by || '',
      ]),
    }]);
  }

  // Auto-calc gross when net or vat changes
  function setAmount(field, value) {
    setForm(f => {
      const updated = { ...f, [field]: value };
      const net = parseFloat(field === 'net_amount' ? value : updated.net_amount) || 0;
      const vat = parseFloat(field === 'vat_amount' ? value : updated.vat_amount) || 0;
      updated.gross_amount = (net + vat).toFixed(2);
      return updated;
    });
  }

  if (loading) return <div className={PAGE.container}><div className={CARD.padded}><p className="text-center py-10 text-gray-500">Loading expenses...</p></div></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Expenses</h1>
          <p className={PAGE.subtitle}>Expense logging, approval and payment tracking</p>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="">All Categories</option>
          {EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="">All Statuses</option>
          {EXPENSE_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <span className="text-sm text-gray-500">{total} expense{total !== 1 ? 's' : ''}</span>
        <div className="flex-1" />
        <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
        <button onClick={openCreate} className={BTN.primary}>Add Expense</button>
      </div>

      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}><tr>
              <th className={TABLE.th}>Date</th>
              <th className={TABLE.th}>Category</th>
              <th className={TABLE.th}>Description</th>
              <th className={TABLE.th}>Supplier</th>
              <th className={`${TABLE.th} text-right`}>Net</th>
              <th className={`${TABLE.th} text-right`}>VAT</th>
              <th className={`${TABLE.th} text-right`}>Gross</th>
              <th className={TABLE.th}>Status</th>
              <th className={TABLE.th}></th>
            </tr></thead>
            <tbody>
              {expenses.length === 0 ? (
                <tr><td colSpan={9} className={TABLE.empty}>No expenses found</td></tr>
              ) : expenses.map(exp => (
                <tr key={exp.id} className={`${TABLE.tr} cursor-pointer`} onClick={() => openEdit(exp)}>
                  <td className={TABLE.td}>{exp.expense_date}</td>
                  <td className={TABLE.td}>{getLabel(exp.category, EXPENSE_CATEGORIES)}</td>
                  <td className={`${TABLE.td} max-w-48 truncate`}>{exp.description}</td>
                  <td className={TABLE.td}>{exp.supplier || '—'}</td>
                  <td className={`${TABLE.tdMono} text-right`}>{formatCurrency(exp.net_amount)}</td>
                  <td className={`${TABLE.tdMono} text-right`}>{formatCurrency(exp.vat_amount)}</td>
                  <td className={`${TABLE.tdMono} text-right`}>{formatCurrency(exp.gross_amount)}</td>
                  <td className={TABLE.td}><span className={BADGE[getStatusBadge(exp.status, EXPENSE_STATUSES)]}>{getLabel(exp.status, EXPENSE_STATUSES)}</span></td>
                  <td className={TABLE.td} onClick={e => e.stopPropagation()}>
                    {exp.status === 'pending' && exp.created_by !== user?.username && (
                      <button onClick={() => handleApprove(exp)} className={`${BTN.success} ${BTN.xs}`}>Approve</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Expense Modal */}
      {showModal && (
        <div className={MODAL.overlay} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className={MODAL.panelLg} role="dialog" aria-modal="true" aria-labelledby="expense-modal-title" onClick={e => e.stopPropagation()}>
            <h2 id="expense-modal-title" className={MODAL.title}>{editing ? 'Edit Expense' : 'Add Expense'}</h2>

            {readOnly && (
              <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2 rounded-lg mb-3 text-sm">
                Approved/paid expenses cannot be edited.
              </div>
            )}

            <fieldset disabled={readOnly} className={readOnly ? 'opacity-60' : ''}>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={INPUT.label}>Date *</label>
                <input type="date" value={form.expense_date || ''} onChange={e => set('expense_date', e.target.value)} className={INPUT.base} /></div>
              <div><label className={INPUT.label}>Category *</label>
                <select value={form.category || 'other'} onChange={e => set('category', e.target.value)} className={INPUT.select}>
                  {EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select></div>
              <div className="col-span-2"><label className={INPUT.label}>Description *</label>
                <input value={form.description || ''} onChange={e => set('description', e.target.value)} className={INPUT.base} /></div>
              <div><label className={INPUT.label}>Supplier</label>
                <input value={form.supplier || ''} onChange={e => set('supplier', e.target.value)} className={INPUT.base} /></div>
              <div><label className={INPUT.label}>Invoice Reference</label>
                <input value={form.invoice_ref || ''} onChange={e => set('invoice_ref', e.target.value)} className={INPUT.base} /></div>

              <div><label className={INPUT.label}>Net Amount *</label>
                <input type="number" step="0.01" value={form.net_amount ?? ''} onChange={e => setAmount('net_amount', e.target.value)} className={INPUT.base} /></div>
              <div><label className={INPUT.label}>VAT</label>
                <input type="number" step="0.01" value={form.vat_amount ?? ''} onChange={e => setAmount('vat_amount', e.target.value)} className={INPUT.base} /></div>
              <div><label className={INPUT.label}>Gross Amount</label>
                <input type="number" step="0.01" value={form.gross_amount ?? ''} className={`${INPUT.base} bg-gray-50`} readOnly /></div>
              <div><label className={INPUT.label}>Subcategory</label>
                <input value={form.subcategory || ''} onChange={e => set('subcategory', e.target.value)} className={INPUT.base} /></div>

              <div><label className={INPUT.label}>Payment Method</label>
                <select value={form.payment_method || ''} onChange={e => set('payment_method', e.target.value || null)} className={INPUT.select}>
                  <option value="">Not paid</option>
                  {PAYMENT_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select></div>
              <div><label className={INPUT.label}>Payment Reference</label>
                <input value={form.payment_reference || ''} onChange={e => set('payment_reference', e.target.value)} className={INPUT.base} /></div>

              <div className="col-span-2 flex items-center gap-3 mt-1">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.recurring || false} onChange={e => set('recurring', e.target.checked)}
                    className="rounded border-gray-300" />
                  Recurring expense
                </label>
                {form.recurring && (
                  <select value={form.recurrence_frequency || 'monthly'} onChange={e => set('recurrence_frequency', e.target.value)} className={`${INPUT.select} w-auto`}>
                    {SCHEDULE_FREQUENCIES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                )}
              </div>

              <div className="col-span-2"><label className={INPUT.label}>Notes</label>
                <textarea rows={2} value={form.notes || ''} onChange={e => set('notes', e.target.value)} className={INPUT.base} /></div>

              {editing && (
                <div className="col-span-2 bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Status: <span className={BADGE[getStatusBadge(form.status, EXPENSE_STATUSES)]}>{getLabel(form.status, EXPENSE_STATUSES)}</span></p>
                  {form.approved_by && <p className="text-xs text-gray-500 mt-1">Approved by {form.approved_by} on {form.approved_date}</p>}
                  <p className="text-xs text-gray-500 mt-1">Created by {form.created_by}</p>
                </div>
              )}
            </div>
            </fieldset>

            <div className={MODAL.footer}>
              <button onClick={closeModal} className={BTN.secondary}>Cancel</button>
              {!readOnly && <button onClick={handleSave} className={BTN.primary}>{editing ? 'Save Changes' : 'Add Expense'}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
