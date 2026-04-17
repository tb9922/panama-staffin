import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import {
  getCurrentHome,
  getLoggedInUser,
  getFinanceExpenses,
  createFinanceExpense,
  updateFinanceExpense,
  approveFinanceExpense,
} from '../lib/api.js';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  PAYMENT_METHODS,
  SCHEDULE_FREQUENCIES,
  getStatusBadge,
  getLabel,
  formatCurrency,
} from '../lib/finance.js';
import { clickableRowProps } from '../lib/a11y.js';
import { useData } from '../contexts/DataContext.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import { todayLocalISO } from '../lib/localDates.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import useTransientNotice from '../hooks/useTransientNotice.js';
import { useToast } from '../contexts/useToast.js';

function normalizeErrorMessage(message, fallback) {
  if (!message) return fallback;
  if (/conflict|version|modified by another user/i.test(message)) {
    return 'This expense was modified by another user. Close and reopen it to load the latest version.';
  }
  return message;
}

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
  const [saving, setSaving] = useState(false);
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const { showToast } = useToast();

  const home = getCurrentHome();
  const user = getLoggedInUser();
  const { canWrite } = useData();
  const canEdit = canWrite('finance');
  useDirtyGuard(Boolean(showModal));

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
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filterCategory, filterStatus, home]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setReadOnly(false);
    setError(null);
    setForm({
      expense_date: todayLocalISO(),
      category: 'other',
      status: 'pending',
      net_amount: '',
      vat_amount: '0',
      gross_amount: '',
      recurring: false,
    });
    setShowModal(true);
  }

  function openEdit(expense) {
    setEditing(expense);
    setReadOnly(expense.status === 'approved' || expense.status === 'paid');
    setError(null);
    setForm({ ...expense });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditing(null);
    setForm({});
    setReadOnly(false);
  }

  async function handleSave() {
    if (readOnly || saving) return;
    setError(null);
    if (!form.description || !form.category || !form.net_amount) {
      setError('Please fill in all required fields');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        gross_amount: form.gross_amount || (parseFloat(form.net_amount || 0) + parseFloat(form.vat_amount || 0)),
      };
      if (editing?.id) {
        await updateFinanceExpense(home, editing.id, { ...payload, _version: editing.version });
        showNotice(`Expense updated for ${form.description}.`, { variant: 'success' });
        showToast({ title: 'Expense updated', message: form.description });
      } else {
        await createFinanceExpense(home, payload);
        showNotice(`Expense added for ${form.description}.`, { variant: 'success' });
        showToast({ title: 'Expense added', message: form.description });
      }
      closeModal();
      await load();
    } catch (e) {
      setError(normalizeErrorMessage(e.message, 'Unable to save this expense right now.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove(expense) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await approveFinanceExpense(home, expense.id);
      showNotice(`Expense approved: ${expense.description}.`, { variant: 'success' });
      showToast({ title: 'Expense approved', message: expense.description });
      await load();
    } catch (e) {
      setError(normalizeErrorMessage(e.message, 'Unable to approve this expense right now.'));
    } finally {
      setSaving(false);
    }
  }

  const setField = (key, value) => setForm(current => ({ ...current, [key]: value }));

  async function handleExport() {
    const { downloadXLSX } = await import('../lib/excel.js');
    downloadXLSX('finance_expenses.xlsx', [{
      name: 'Expenses',
      headers: ['Date', 'Category', 'Description', 'Supplier', 'Net', 'VAT', 'Gross', 'Status', 'Approved By'],
      rows: expenses.map(expense => [
        expense.expense_date,
        expense.category,
        expense.description,
        expense.supplier || '',
        expense.net_amount,
        expense.vat_amount,
        expense.gross_amount,
        expense.status,
        expense.approved_by || '',
      ]),
    }]);
  }

  function setAmount(field, value) {
    setForm(current => {
      const updated = { ...current, [field]: value };
      const net = parseFloat(field === 'net_amount' ? value : updated.net_amount) || 0;
      const vat = parseFloat(field === 'vat_amount' ? value : updated.vat_amount) || 0;
      updated.gross_amount = (net + vat).toFixed(2);
      return updated;
    });
  }

  if (loading) {
    return <LoadingState message="Loading expenses..." className={PAGE.container} card />;
  }

  if (error && expenses.length === 0) {
    return (
      <div className={PAGE.container}>
        <ErrorState title="Unable to load expenses" message={error} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Expenses</h1>
          <p className={PAGE.subtitle}>Expense logging, approval and payment tracking</p>
        </div>
      </div>

      {notice && <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">{notice.content}</InlineNotice>}
      {error && expenses.length > 0 && (
        <ErrorState title="Some expense actions could not be completed" message={error} onRetry={() => void load()} className="mb-4" />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select value={filterCategory} onChange={event => setFilterCategory(event.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="">All Categories</option>
          {EXPENSE_CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
        </select>
        <select value={filterStatus} onChange={event => setFilterStatus(event.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="">All Statuses</option>
          {EXPENSE_STATUSES.map(status => <option key={status.id} value={status.id}>{status.label}</option>)}
        </select>
        <span className="text-sm text-gray-500">{total} expense{total !== 1 ? 's' : ''}</span>
        <div className="flex-1" />
        <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
        {canEdit && <button onClick={openCreate} className={BTN.primary}>Add Expense</button>}
      </div>

      <div className={CARD.flush}>
        {expenses.length === 0 ? (
          <EmptyState
            title="No expenses found"
            description="Add the first expense to start tracking approvals, suppliers, and payment status."
            actionLabel={canEdit ? 'Add Expense' : undefined}
            onAction={canEdit ? openCreate : undefined}
          />
        ) : (
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th scope="col" className={TABLE.th}>Date</th>
                  <th scope="col" className={TABLE.th}>Category</th>
                  <th scope="col" className={TABLE.th}>Description</th>
                  <th scope="col" className={TABLE.th}>Supplier</th>
                  <th scope="col" className={`${TABLE.th} text-right`}>Net</th>
                  <th scope="col" className={`${TABLE.th} text-right`}>VAT</th>
                  <th scope="col" className={`${TABLE.th} text-right`}>Gross</th>
                  <th scope="col" className={TABLE.th}>Status</th>
                  <th scope="col" className={TABLE.th}></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(expense => (
                  <tr key={expense.id} className={`${TABLE.tr} cursor-pointer`} {...clickableRowProps(() => openEdit(expense))}>
                    <td className={TABLE.td}>{expense.expense_date}</td>
                    <td className={TABLE.td}>{getLabel(expense.category, EXPENSE_CATEGORIES)}</td>
                    <td className={`${TABLE.td} max-w-48 truncate`}>{expense.description}</td>
                    <td className={TABLE.td}>{expense.supplier || '—'}</td>
                    <td className={`${TABLE.tdMono} text-right`}>{formatCurrency(expense.net_amount)}</td>
                    <td className={`${TABLE.tdMono} text-right`}>{formatCurrency(expense.vat_amount)}</td>
                    <td className={`${TABLE.tdMono} text-right`}>{formatCurrency(expense.gross_amount)}</td>
                    <td className={TABLE.td}>
                      <span className={BADGE[getStatusBadge(expense.status, EXPENSE_STATUSES)]}>{getLabel(expense.status, EXPENSE_STATUSES)}</span>
                    </td>
                    <td className={TABLE.td} onClick={event => event.stopPropagation()}>
                      {canEdit && expense.status === 'pending' && expense.created_by !== user?.username && (
                        <button onClick={() => void handleApprove(expense)} disabled={saving} className={`${BTN.success} ${BTN.xs}`}>
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Expense' : 'Add Expense'} size="lg">
        {readOnly && (
          <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
            Approved or paid expenses cannot be edited.
          </div>
        )}

        <fieldset disabled={readOnly} className={readOnly ? 'opacity-60' : ''}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={INPUT.label}>Date *</label>
              <input type="date" value={form.expense_date || ''} onChange={event => setField('expense_date', event.target.value)} className={INPUT.base} />
            </div>
            <div>
              <label className={INPUT.label}>Category *</label>
              <select value={form.category || 'other'} onChange={event => setField('category', event.target.value)} className={INPUT.select}>
                {EXPENSE_CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={INPUT.label}>Description *</label>
              <input value={form.description || ''} onChange={event => setField('description', event.target.value)} className={INPUT.base} />
            </div>
            <div>
              <label className={INPUT.label}>Supplier</label>
              <input value={form.supplier || ''} onChange={event => setField('supplier', event.target.value)} className={INPUT.base} />
            </div>
            <div>
              <label className={INPUT.label}>Invoice Reference</label>
              <input value={form.invoice_ref || ''} onChange={event => setField('invoice_ref', event.target.value)} className={INPUT.base} />
            </div>

            <div>
              <label className={INPUT.label}>Net Amount *</label>
              <input type="number" step="0.01" value={form.net_amount ?? ''} onChange={event => setAmount('net_amount', event.target.value)} className={INPUT.base} />
            </div>
            <div>
              <label className={INPUT.label}>VAT</label>
              <input type="number" step="0.01" value={form.vat_amount ?? ''} onChange={event => setAmount('vat_amount', event.target.value)} className={INPUT.base} />
            </div>
            <div>
              <label className={INPUT.label}>Gross Amount</label>
              <input type="number" step="0.01" value={form.gross_amount ?? ''} className={`${INPUT.base} bg-gray-50`} readOnly />
            </div>
            <div>
              <label className={INPUT.label}>Subcategory</label>
              <input value={form.subcategory || ''} onChange={event => setField('subcategory', event.target.value)} className={INPUT.base} />
            </div>

            <div>
              <label className={INPUT.label}>Payment Method</label>
              <select value={form.payment_method || ''} onChange={event => setField('payment_method', event.target.value || null)} className={INPUT.select}>
                <option value="">Not paid</option>
                {PAYMENT_METHODS.map(method => <option key={method.id} value={method.id}>{method.label}</option>)}
              </select>
            </div>
            <div>
              <label className={INPUT.label}>Payment Reference</label>
              <input value={form.payment_reference || ''} onChange={event => setField('payment_reference', event.target.value)} className={INPUT.base} />
            </div>

            <div className="col-span-2 mt-1 flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.recurring || false}
                  onChange={event => setField('recurring', event.target.checked)}
                  className="rounded border-gray-300"
                />
                Recurring expense
              </label>
              {form.recurring && (
                <select value={form.recurrence_frequency || 'monthly'} onChange={event => setField('recurrence_frequency', event.target.value)} className={`${INPUT.select} w-auto`}>
                  {SCHEDULE_FREQUENCIES.map(frequency => <option key={frequency.id} value={frequency.id}>{frequency.label}</option>)}
                </select>
              )}
            </div>

            <div className="col-span-2">
              <label className={INPUT.label}>Notes</label>
              <textarea rows={2} value={form.notes || ''} onChange={event => setField('notes', event.target.value)} className={INPUT.base} />
            </div>

            {editing && (
              <div className="col-span-2 rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500">
                  Status: <span className={BADGE[getStatusBadge(form.status, EXPENSE_STATUSES)]}>{getLabel(form.status, EXPENSE_STATUSES)}</span>
                </p>
                {form.approved_by && <p className="mt-1 text-xs text-gray-500">Approved by {form.approved_by} on {form.approved_date}</p>}
                <p className="mt-1 text-xs text-gray-500">Created by {form.created_by}</p>
              </div>
            )}
          </div>
        </fieldset>

        <div className={MODAL.footer}>
          <button onClick={closeModal} className={BTN.secondary}>Cancel</button>
          {canEdit && !readOnly && (
            <button onClick={handleSave} disabled={saving} className={BTN.primary}>
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Expense'}
            </button>
          )}
        </div>
      </Modal>
    </div>
  );
}
