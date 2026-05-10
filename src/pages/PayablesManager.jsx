import { useState, useEffect, useCallback, useId } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import {
  getCurrentHome,
  getPaymentSchedules,
  createPaymentSchedule,
  updatePaymentSchedule,
  processPaymentSchedule,
} from '../lib/api.js';
import { EXPENSE_CATEGORIES, SCHEDULE_FREQUENCIES, formatCurrency, getLabel } from '../lib/finance.js';
import { clickableRowProps } from '../lib/a11y.js';
import { useData } from '../contexts/DataContext.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import { addDaysLocalISO, todayLocalISO } from '../lib/localDates.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import useTransientNotice from '../hooks/useTransientNotice.js';
import { useToast } from '../contexts/useToast.js';

function normalizeErrorMessage(message, fallback) {
  if (!message) return fallback;
  if (/conflict|version|modified by another user/i.test(message)) {
    return 'This payment schedule was modified by another user. Close and reopen it to load the latest version.';
  }
  return message;
}

function cleanOptionalText(value) {
  const trimmed = (value || '').trim();
  return trimmed || null;
}

function normalizeSchedulePayload(form) {
  return {
    supplier: (form.supplier || '').trim(),
    category: form.category || 'other',
    frequency: form.frequency || 'monthly',
    amount: Number(form.amount),
    next_due: form.next_due || '',
    description: cleanOptionalText(form.description),
    auto_approve: Boolean(form.auto_approve),
    on_hold: Boolean(form.on_hold),
    hold_reason: form.on_hold ? cleanOptionalText(form.hold_reason) : null,
    notes: cleanOptionalText(form.notes),
  };
}

function validateSchedulePayload(payload) {
  if (!payload.supplier || !payload.category || !payload.next_due || !payload.frequency) {
    return 'Please fill in all required fields';
  }
  if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
    return 'Amount must be greater than 0';
  }
  return null;
}

export default function PayablesManager() {
  const { canWrite } = useData();
  const canEdit = canWrite('finance');
  const [schedules, setSchedules] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [processing, setProcessing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const { showToast } = useToast();

  const home = getCurrentHome();
  const idPrefix = useId();
  const { confirm, ConfirmDialog } = useConfirm();
  useDirtyGuard(Boolean(showModal));

  const load = useCallback(async () => {
    if (!home) {
      setSchedules([]);
      setTotal(0);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await getPaymentSchedules(home);
      setSchedules(data.rows || []);
      setTotal(data.total || 0);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [home]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = todayLocalISO();
  const in28Days = addDaysLocalISO(today, 28);
  const in7Days = addDaysLocalISO(today, 7);

  const activeSchedules = schedules.filter(schedule => !schedule.on_hold);
  const dueThisWeek = schedules.filter(schedule => !schedule.on_hold && schedule.next_due <= in7Days);
  const onHoldCount = schedules.filter(schedule => schedule.on_hold).length;
  const duePayments = schedules.filter(schedule => !schedule.on_hold && schedule.next_due <= in28Days);

  function openCreate() {
    setEditing(null);
    setFormError(null);
    setForm({
      frequency: 'monthly',
      category: 'other',
      next_due: today,
      auto_approve: false,
      on_hold: false,
    });
    setShowModal(true);
  }

  function openEdit(schedule) {
    setEditing(schedule);
    setFormError(null);
    setForm({ ...schedule });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditing(null);
    setForm({});
    setFormError(null);
  }

  async function handleSave() {
    if (saving) return;
    setFormError(null);
    const payload = normalizeSchedulePayload(form);
    const validation = validateSchedulePayload(payload);
    if (validation) {
      setFormError(validation);
      return;
    }
    setSaving(true);
    try {
      if (editing?.id) {
        await updatePaymentSchedule(home, editing.id, { ...payload, _version: editing.version });
        showNotice(`Schedule updated for ${payload.supplier}.`, { variant: 'success' });
        showToast({ title: 'Schedule updated', message: payload.supplier });
      } else {
        await createPaymentSchedule(home, payload);
        showNotice(`Payment schedule added for ${payload.supplier}.`, { variant: 'success' });
        showToast({ title: 'Schedule added', message: payload.supplier });
      }
      closeModal();
      await load();
    } catch (e) {
      setFormError(normalizeErrorMessage(e.message, 'Unable to save this payment schedule right now.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleProcess(schedule) {
    if (saving || processing) return;
    if (!await confirm(`Process payment for ${schedule.supplier} - ${formatCurrency(schedule.amount)}? This will create an expense and advance the schedule to the next period.`)) {
      return;
    }
    setError(null);
    setProcessing(schedule.id);
    setSaving(true);
    try {
      await processPaymentSchedule(home, schedule.id, schedule.version);
      showNotice(`Payment processed for ${schedule.supplier}.`, { variant: 'success' });
      showToast({ title: 'Payment processed', message: schedule.supplier });
      await load();
    } catch (e) {
      setError(normalizeErrorMessage(e.message, 'Unable to process this payment right now.'));
    } finally {
      setProcessing(null);
      setSaving(false);
    }
  }

  async function handleToggleHold(schedule) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const nextOnHold = !schedule.on_hold;
      await updatePaymentSchedule(home, schedule.id, {
        on_hold: nextOnHold,
        hold_reason: nextOnHold ? 'Manually held' : null,
        _version: schedule.version,
      });
      showNotice(
        nextOnHold ? `${schedule.supplier} is now on hold.` : `${schedule.supplier} is active again.`,
        { variant: 'success' },
      );
      showToast({
        title: nextOnHold ? 'Schedule on hold' : 'Schedule reactivated',
        message: schedule.supplier,
      });
      await load();
    } catch (e) {
      setError(normalizeErrorMessage(e.message, 'Unable to update this payment schedule right now.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    if (!schedules.length || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const { downloadXLSX } = await import('../lib/excel.js');
      downloadXLSX('payment_schedules.xlsx', [{
        name: 'Payment Schedules',
        headers: ['Supplier', 'Category', 'Description', 'Frequency', 'Amount', 'Next Due', 'Auto-approve', 'Status'],
        rows: schedules.map(schedule => [
          schedule.supplier,
          schedule.category,
          schedule.description || '',
          schedule.frequency,
          schedule.amount,
          schedule.next_due,
          schedule.auto_approve ? 'Yes' : 'No',
          schedule.on_hold ? 'On Hold' : 'Active',
        ]),
      }]);
    } catch (e) {
      setError(e.message || 'Unable to export payment schedules.');
    } finally {
      setExporting(false);
    }
  }

  const setField = (key, value) => setForm(current => ({ ...current, [key]: value }));

  if (loading) {
    return <LoadingState message="Loading payment schedules..." className={PAGE.container} card />;
  }

  if (error && schedules.length === 0) {
    return (
      <div className={PAGE.container}>
        <ErrorState title="Unable to load payables" message={error} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Payables</h1>
          <p className={PAGE.subtitle}>Scheduled and recurring payment management</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || schedules.length === 0}
            className={`${BTN.secondary} ${BTN.sm}`}
          >
            {exporting ? 'Exporting...' : 'Export Excel'}
          </button>
          {canEdit && <button type="button" onClick={openCreate} className={BTN.primary}>Add Schedule</button>}
        </div>
      </div>

      {notice && <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">{notice.content}</InlineNotice>}
      {!home && <EmptyState title="No home selected" description="Choose a home before reviewing payables." className="mb-4" />}
      {error && schedules.length > 0 && (
        <ErrorState title="Some payable actions could not be completed" message={error} onRetry={() => void load()} className="mb-4" />
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={CARD.padded}>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Active Schedules</p>
          <p className="mt-1 text-2xl font-bold text-blue-600">{activeSchedules.length}</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Due This Week</p>
          <p className={`mt-1 text-2xl font-bold ${dueThisWeek.length > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{dueThisWeek.length}</p>
        </div>
        <div className={CARD.padded}>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">On Hold</p>
          <p className={`mt-1 text-2xl font-bold ${onHoldCount > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{onHoldCount}</p>
        </div>
      </div>

      <div className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Payments Due (Next 4 Weeks)</h2>
        <div className={CARD.flush}>
          {duePayments.length === 0 ? (
            <EmptyState
              compact
              title="No payments due in the next four weeks"
              description={`${total} schedule${total === 1 ? '' : 's'} tracked. Upcoming items will appear here automatically.`}
            />
          ) : (
            <div className={TABLE.wrapper}>
              <table className={TABLE.table}>
                <thead className={TABLE.thead}>
                  <tr>
                    <th scope="col" className={TABLE.th}>Supplier</th>
                    <th scope="col" className={TABLE.th}>Category</th>
                    <th scope="col" className={`${TABLE.th} text-right`}>Amount</th>
                    <th scope="col" className={TABLE.th}>Next Due</th>
                    <th scope="col" className={TABLE.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {duePayments.map(schedule => {
                    const isPastDue = schedule.next_due <= today;
                    return (
                      <tr key={schedule.id} className={TABLE.tr}>
                        <td className={`${TABLE.td} font-medium ${isPastDue ? 'border-l-4 border-red-500' : schedule.next_due <= in7Days ? 'border-l-4 border-amber-400' : ''}`}>
                          {schedule.supplier}
                        </td>
                        <td className={TABLE.td}>{getLabel(schedule.category, EXPENSE_CATEGORIES)}</td>
                        <td className={`${TABLE.tdMono} text-right`}>{formatCurrency(schedule.amount)}</td>
                        <td className={`${TABLE.td} ${isPastDue ? 'font-bold text-red-600' : ''}`}>{schedule.next_due}</td>
                        <td className={TABLE.td}>
                          {canEdit && (
                            <button type="button" onClick={() => void handleProcess(schedule)} disabled={saving || processing === schedule.id} className={`${BTN.success} ${BTN.xs}`}>
                              {processing === schedule.id ? 'Processing...' : 'Process'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <h2 className="mb-3 text-sm font-semibold text-gray-900">All Schedules</h2>
      <div className={CARD.flush}>
        {schedules.length === 0 ? (
          <EmptyState
            title="No payment schedules yet"
            description="Add recurring utilities, agency, and supplier schedules so nothing slips through."
            actionLabel={canEdit ? 'Add Schedule' : undefined}
            onAction={canEdit ? openCreate : undefined}
          />
        ) : (
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th scope="col" className={TABLE.th}>Supplier</th>
                  <th scope="col" className={TABLE.th}>Category</th>
                  <th scope="col" className={TABLE.th}>Frequency</th>
                  <th scope="col" className={`${TABLE.th} text-right`}>Amount</th>
                  <th scope="col" className={TABLE.th}>Next Due</th>
                  <th scope="col" className={TABLE.th}>Auto-approve</th>
                  <th scope="col" className={TABLE.th}>Status</th>
                  <th scope="col" className={TABLE.th}></th>
                </tr>
              </thead>
              <tbody>
                {schedules.map(schedule => (
                  <tr key={schedule.id} className={`${TABLE.tr} cursor-pointer`} {...clickableRowProps(() => openEdit(schedule))}>
                    <td className={`${TABLE.td} font-medium`}>{schedule.supplier}</td>
                    <td className={TABLE.td}>{getLabel(schedule.category, EXPENSE_CATEGORIES)}</td>
                    <td className={TABLE.td}>{getLabel(schedule.frequency, SCHEDULE_FREQUENCIES)}</td>
                    <td className={`${TABLE.tdMono} text-right`}>{formatCurrency(schedule.amount)}</td>
                    <td className={TABLE.td}>{schedule.next_due}</td>
                    <td className={TABLE.td}>{schedule.auto_approve ? <span className={BADGE.green}>Yes</span> : <span className={BADGE.gray}>No</span>}</td>
                    <td className={TABLE.td}>{schedule.on_hold ? <span className={BADGE.amber}>On Hold</span> : <span className={BADGE.green}>Active</span>}</td>
                    <td className={TABLE.td} onClick={event => event.stopPropagation()}>
                      {canEdit && (
                        <button type="button" onClick={() => void handleToggleHold(schedule)} disabled={saving} className={`${BTN.ghost} ${BTN.xs}`}>
                          {schedule.on_hold ? 'Release' : 'Hold'}
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

      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Payment Schedule' : 'Add Payment Schedule'} size="lg">
        {formError && <InlineNotice variant="error" className="mb-4">{formError}</InlineNotice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor={`${idPrefix}-supplier`} className={INPUT.label}>Supplier *</label>
            <input id={`${idPrefix}-supplier`} value={form.supplier || ''} onChange={event => setField('supplier', event.target.value)} className={INPUT.base} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-category`} className={INPUT.label}>Category *</label>
            <select id={`${idPrefix}-category`} value={form.category || 'other'} onChange={event => setField('category', event.target.value)} className={INPUT.select}>
              {EXPENSE_CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${idPrefix}-frequency`} className={INPUT.label}>Frequency *</label>
            <select id={`${idPrefix}-frequency`} value={form.frequency || 'monthly'} onChange={event => setField('frequency', event.target.value)} className={INPUT.select}>
              {SCHEDULE_FREQUENCIES.map(frequency => <option key={frequency.id} value={frequency.id}>{frequency.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${idPrefix}-amount`} className={INPUT.label}>Amount *</label>
            <input id={`${idPrefix}-amount`} type="number" step="0.01" inputMode="decimal" value={form.amount ?? ''} onChange={event => setField('amount', event.target.value)} className={INPUT.base} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-next-due`} className={INPUT.label}>Next Due *</label>
            <input id={`${idPrefix}-next-due`} type="date" value={form.next_due || ''} onChange={event => setField('next_due', event.target.value)} className={INPUT.base} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${idPrefix}-description`} className={INPUT.label}>Description</label>
            <input id={`${idPrefix}-description`} value={form.description || ''} onChange={event => setField('description', event.target.value)} className={INPUT.base} />
          </div>

          <div className="mt-1 flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:gap-6">
            <div className="flex items-center gap-2 text-sm">
              <input
                id={`${idPrefix}-auto-approve`}
                type="checkbox"
                checked={form.auto_approve || false}
                onChange={event => setField('auto_approve', event.target.checked)}
                className="rounded border-gray-300"
              />
              <label htmlFor={`${idPrefix}-auto-approve`}>Auto-approve when processed</label>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <input
                id={`${idPrefix}-on-hold`}
                type="checkbox"
                checked={form.on_hold || false}
                onChange={event => setField('on_hold', event.target.checked)}
                className="rounded border-gray-300"
              />
              <label htmlFor={`${idPrefix}-on-hold`}>On hold</label>
            </div>
          </div>

          {form.on_hold && (
            <div className="sm:col-span-2">
              <label htmlFor={`${idPrefix}-hold-reason`} className={INPUT.label}>Hold Reason</label>
              <input id={`${idPrefix}-hold-reason`} value={form.hold_reason || ''} onChange={event => setField('hold_reason', event.target.value)} className={INPUT.base} />
            </div>
          )}

          <div className="sm:col-span-2">
            <label htmlFor={`${idPrefix}-notes`} className={INPUT.label}>Notes</label>
            <textarea id={`${idPrefix}-notes`} rows={2} value={form.notes || ''} onChange={event => setField('notes', event.target.value)} className={INPUT.base} />
          </div>
        </div>

        <div className={MODAL.footer}>
          <button type="button" onClick={closeModal} className={BTN.secondary}>Cancel</button>
          {canEdit && (
            <button type="button" onClick={handleSave} disabled={saving} className={BTN.primary}>
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Schedule'}
            </button>
          )}
        </div>
      </Modal>
      {ConfirmDialog}
    </div>
  );
}
