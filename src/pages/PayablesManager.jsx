import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import { getCurrentHome, getLoggedInUser, getPaymentSchedules, createPaymentSchedule, updatePaymentSchedule, processPaymentSchedule } from '../lib/api.js';
import { EXPENSE_CATEGORIES, SCHEDULE_FREQUENCIES, formatCurrency, getLabel } from '../lib/finance.js';

export default function PayablesManager() {
  const isAdmin = getLoggedInUser()?.role === 'admin';
  const [schedules, setSchedules] = useState([]);
  const [_total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [processing, setProcessing] = useState(null);
  const home = getCurrentHome();

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const data = await getPaymentSchedules(home);
      setSchedules(data.rows || []);
      setTotal(data.total || 0);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [home]);

  useEffect(() => { load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const in28Days = (() => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 28))
      .toISOString().slice(0, 10);
  })();
  const in7Days = (() => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 7))
      .toISOString().slice(0, 10);
  })();

  // KPI calculations
  const activeSchedules = schedules.filter(s => !s.on_hold);
  const dueThisWeek = schedules.filter(s => !s.on_hold && s.next_due <= in7Days);
  const onHoldCount = schedules.filter(s => s.on_hold).length;
  const duePayments = schedules.filter(s => !s.on_hold && s.next_due <= in28Days);

  function openCreate() {
    setEditing(null);
    setError(null);
    setForm({
      frequency: 'monthly',
      category: 'other',
      next_due: today,
      auto_approve: false,
      on_hold: false,
    });
    setShowModal(true);
  }

  function openEdit(sched) {
    setEditing(sched);
    setError(null);
    setForm({ ...sched });
    setShowModal(true);
  }

  function closeModal() { setShowModal(false); setEditing(null); setForm({}); }

  async function handleSave() {
    setError(null);
    if (!form.supplier || !form.category || !form.amount || !form.next_due || !form.frequency) {
      setError('Please fill in all required fields');
      return;
    }
    try {
      if (editing?.id) {
        await updatePaymentSchedule(home, editing.id, form);
      } else {
        await createPaymentSchedule(home, form);
      }
      closeModal();
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleProcess(sched) {
    if (processing) return;
    if (!confirm(`Process payment for ${sched.supplier} — ${formatCurrency(sched.amount)}?\n\nThis will create an expense and advance the schedule to the next period.`)) return;
    setError(null);
    setProcessing(sched.id);
    try {
      await processPaymentSchedule(home, sched.id);
      load();
    } catch (e) { setError(e.message); }
    finally { setProcessing(null); }
  }

  async function handleToggleHold(sched) {
    setError(null);
    try {
      await updatePaymentSchedule(home, sched.id, {
        on_hold: !sched.on_hold,
        hold_reason: !sched.on_hold ? 'Manually held' : null,
      });
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleExport() {
    if (!schedules.length) return;
    const { downloadXLSX } = await import('../lib/excel.js');
    downloadXLSX('payment_schedules.xlsx', [{
      name: 'Payment Schedules',
      headers: ['Supplier', 'Category', 'Description', 'Frequency', 'Amount', 'Next Due', 'Auto-approve', 'Status'],
      rows: schedules.map(s => [
        s.supplier, s.category, s.description || '', s.frequency,
        s.amount, s.next_due, s.auto_approve ? 'Yes' : 'No', s.on_hold ? 'On Hold' : 'Active',
      ]),
    }]);
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  if (loading) return <div className={PAGE.container} role="status"><div className={CARD.padded}><p className="text-center py-10 text-gray-500">Loading payment schedules...</p></div></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Payables</h1>
          <p className={PAGE.subtitle}>Scheduled and recurring payment management</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
          {isAdmin && <button onClick={openCreate} className={BTN.primary}>Add Schedule</button>}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className={CARD.padded}>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Active Schedules</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{activeSchedules.length}</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Due This Week</p>
          <p className={`text-2xl font-bold mt-1 ${dueThisWeek.length > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{dueThisWeek.length}</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">On Hold</p>
          <p className={`text-2xl font-bold mt-1 ${onHoldCount > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{onHoldCount}</p>
        </div>
      </div>

      {/* Payments Due (next 28 days) */}
      {duePayments.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Payments Due (Next 4 Weeks)</h2>
          <div className={CARD.flush}>
            <div className={TABLE.wrapper}>
              <table className={TABLE.table}>
                <thead className={TABLE.thead}><tr>
                  <th scope="col" className={TABLE.th}>Supplier</th>
                  <th scope="col" className={TABLE.th}>Category</th>
                  <th scope="col" className={`${TABLE.th} text-right`}>Amount</th>
                  <th scope="col" className={TABLE.th}>Next Due</th>
                  <th scope="col" className={TABLE.th}></th>
                </tr></thead>
                <tbody>
                  {duePayments.map(s => {
                    const isPastDue = s.next_due <= today;
                    return (
                      <tr key={s.id} className={TABLE.tr}>
                        <td className={`${TABLE.td} font-medium ${isPastDue ? 'border-l-4 border-red-500' : s.next_due <= in7Days ? 'border-l-4 border-amber-400' : ''}`}>
                          {s.supplier}
                        </td>
                        <td className={TABLE.td}>{getLabel(s.category, EXPENSE_CATEGORIES)}</td>
                        <td className={`${TABLE.tdMono} text-right`}>{formatCurrency(s.amount)}</td>
                        <td className={`${TABLE.td} ${isPastDue ? 'text-red-600 font-bold' : ''}`}>{s.next_due}</td>
                        <td className={TABLE.td}>
                          {isAdmin && <button onClick={() => handleProcess(s)} disabled={processing === s.id} className={`${BTN.success} ${BTN.xs}`}>{processing === s.id ? 'Processing...' : 'Process'}</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* All Schedules */}
      <h2 className="text-sm font-semibold text-gray-900 mb-3">All Schedules</h2>
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}><tr>
              <th scope="col" className={TABLE.th}>Supplier</th>
              <th scope="col" className={TABLE.th}>Category</th>
              <th scope="col" className={TABLE.th}>Frequency</th>
              <th scope="col" className={`${TABLE.th} text-right`}>Amount</th>
              <th scope="col" className={TABLE.th}>Next Due</th>
              <th scope="col" className={TABLE.th}>Auto-approve</th>
              <th scope="col" className={TABLE.th}>Status</th>
              <th scope="col" className={TABLE.th}></th>
            </tr></thead>
            <tbody>
              {schedules.length === 0 ? (
                <tr><td colSpan={8} className={TABLE.empty}>No payment schedules</td></tr>
              ) : schedules.map(s => (
                <tr key={s.id} className={`${TABLE.tr} cursor-pointer`} onClick={() => openEdit(s)}>
                  <td className={`${TABLE.td} font-medium`}>{s.supplier}</td>
                  <td className={TABLE.td}>{getLabel(s.category, EXPENSE_CATEGORIES)}</td>
                  <td className={TABLE.td}>{getLabel(s.frequency, SCHEDULE_FREQUENCIES)}</td>
                  <td className={`${TABLE.tdMono} text-right`}>{formatCurrency(s.amount)}</td>
                  <td className={TABLE.td}>{s.next_due}</td>
                  <td className={TABLE.td}>{s.auto_approve ? <span className={BADGE.green}>Yes</span> : <span className={BADGE.gray}>No</span>}</td>
                  <td className={TABLE.td}>{s.on_hold ? <span className={BADGE.amber}>On Hold</span> : <span className={BADGE.green}>Active</span>}</td>
                  <td className={TABLE.td} onClick={e => e.stopPropagation()}>
                    {isAdmin && <button onClick={() => handleToggleHold(s)} className={`${BTN.ghost} ${BTN.xs}`}>
                      {s.on_hold ? 'Release' : 'Hold'}
                    </button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Schedule Modal */}
      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Payment Schedule' : 'Add Payment Schedule'} size="lg">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className={INPUT.label}>Supplier *</label>
            <input value={form.supplier || ''} onChange={e => set('supplier', e.target.value)} className={INPUT.base} /></div>
          <div><label className={INPUT.label}>Category *</label>
            <select value={form.category || 'other'} onChange={e => set('category', e.target.value)} className={INPUT.select}>
              {EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select></div>
          <div><label className={INPUT.label}>Frequency *</label>
            <select value={form.frequency || 'monthly'} onChange={e => set('frequency', e.target.value)} className={INPUT.select}>
              {SCHEDULE_FREQUENCIES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select></div>
          <div><label className={INPUT.label}>Amount *</label>
            <input type="number" step="0.01" value={form.amount ?? ''} onChange={e => set('amount', e.target.value)} className={INPUT.base} /></div>
          <div><label className={INPUT.label}>Next Due *</label>
            <input type="date" value={form.next_due || ''} onChange={e => set('next_due', e.target.value)} className={INPUT.base} /></div>
          <div className="col-span-2"><label className={INPUT.label}>Description</label>
            <input value={form.description || ''} onChange={e => set('description', e.target.value)} className={INPUT.base} /></div>

          <div className="col-span-2 flex items-center gap-6 mt-1">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.auto_approve || false} onChange={e => set('auto_approve', e.target.checked)}
                className="rounded border-gray-300" />
              Auto-approve when processed
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.on_hold || false} onChange={e => set('on_hold', e.target.checked)}
                className="rounded border-gray-300" />
              On hold
            </label>
          </div>

          {form.on_hold && (
            <div className="col-span-2"><label className={INPUT.label}>Hold Reason</label>
              <input value={form.hold_reason || ''} onChange={e => set('hold_reason', e.target.value)} className={INPUT.base} /></div>
          )}

          <div className="col-span-2"><label className={INPUT.label}>Notes</label>
            <textarea rows={2} value={form.notes || ''} onChange={e => set('notes', e.target.value)} className={INPUT.base} /></div>
        </div>

        <div className={MODAL.footer}>
          <button onClick={closeModal} className={BTN.secondary}>Cancel</button>
          {isAdmin && <button onClick={handleSave} className={BTN.primary}>{editing ? 'Save Changes' : 'Add Schedule'}</button>}
        </div>
      </Modal>
    </div>
  );
}
