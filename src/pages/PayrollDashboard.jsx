import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import { getPayrollRuns, createPayrollRun, voidPayrollRun, getCurrentHome } from '../lib/api.js';
import { suggestNextPeriod } from '../lib/payroll.js';
import { useData } from '../contexts/DataContext.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import useTransientNotice from '../hooks/useTransientNotice.js';
import { useToast } from '../contexts/useToast.js';

const STATUS_BADGE = {
  draft: BADGE.gray,
  calculated: BADGE.blue,
  approved: BADGE.green,
  exported: BADGE.purple,
  locked: BADGE.gray,
  voided: BADGE.red,
};

const STATUS_LABEL = {
  draft: 'Draft',
  calculated: 'Calculated',
  approved: 'Approved',
  exported: 'Exported',
  locked: 'Locked',
  voided: 'Voided',
};

const FREQ_LABEL = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
};

function formatMoney(value) {
  if (value == null) return '—';
  return `£${parseFloat(value).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`;
}

export default function PayrollDashboard() {
  const homeSlug = getCurrentHome();
  const { canWrite, homeRole } = useData();
  const canEdit = canWrite('payroll');
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const { showToast } = useToast();
  const isOwnDataPayroll = homeRole === 'staff_member';

  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ period_start: '', period_end: '', pay_frequency: 'monthly', notes: '' });
  const [creating, setCreating] = useState(false);
  useDirtyGuard(showCreate);

  const load = useCallback(async () => {
    if (!homeSlug) return;
    try {
      setLoading(true);
      setError(null);
      const res = await getPayrollRuns(homeSlug);
      const nextRuns = Array.isArray(res) ? res : (res.rows || []);
      setRuns(nextRuns);
      const lastRun = nextRuns.length > 0 ? nextRuns[0] : null;
      const next = suggestNextPeriod(lastRun, lastRun?.pay_frequency || 'monthly');
      setForm(current => ({
        ...current,
        period_start: next.start,
        period_end: next.end,
        pay_frequency: lastRun?.pay_frequency || 'monthly',
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleFreqChange(freq) {
    const lastRun = runs.length > 0 ? runs[0] : null;
    const next = suggestNextPeriod(lastRun, freq);
    setForm(current => ({ ...current, pay_frequency: freq, period_start: next.start, period_end: next.end }));
  }

  async function handleCreate() {
    if (!form.period_start || !form.period_end) return;
    setCreating(true);
    try {
      const run = await createPayrollRun(homeSlug, form);
      setShowCreate(false);
      showNotice('Payroll run created. Continue into the run to calculate, review, and approve it.', { variant: 'success' });
      showToast({ title: 'Payroll run created', message: `${form.period_start} to ${form.period_end}` });
      navigate(`/payroll/${run.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleVoid(run) {
    if (!await confirm({
      title: 'Void payroll run',
      message: `Void payroll run ${run.period_start} to ${run.period_end}${run.total_gross ? ` (£${Number(run.total_gross).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} gross)` : ''}? This cannot be undone.`,
      confirmLabel: 'Void run',
      tone: 'danger',
    })) return;
    try {
      await voidPayrollRun(homeSlug, run.id);
      showNotice(`Payroll run ${run.period_start} to ${run.period_end} was voided.`, { variant: 'success' });
      showToast({
        title: 'Payroll run voided',
        message: `${run.period_start} to ${run.period_end}`,
        tone: 'warning',
      });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  const latest = runs[0];

  if (loading) {
    return (
      <LoadingState
        message={isOwnDataPayroll ? 'Loading your payroll runs...' : 'Loading payroll runs...'}
        className={PAGE.container}
        card
      />
    );
  }

  if (error && runs.length === 0) {
    return (
      <div className={PAGE.container}>
        <ErrorState
          title={isOwnDataPayroll ? 'Unable to load your payroll runs' : 'Unable to load payroll runs'}
          message={error}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  if (isOwnDataPayroll) {
    return (
      <div className={PAGE.container}>
        <div className={PAGE.header}>
          <div>
            <h1 className={PAGE.title}>My Payslips</h1>
            <p className={PAGE.subtitle}>Your payroll runs and payslip access live here.</p>
          </div>
        </div>
        {notice && <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">{notice.content}</InlineNotice>}
        {error && <ErrorState title="Some payroll data could not be loaded" message={error} onRetry={() => void load()} className="mb-4" />}
        <div className={CARD.flush}>
          {runs.length === 0 ? (
            <EmptyState
              title="No payroll runs yet"
              description="Your processed payroll runs will appear here once the next payroll period has been calculated."
            />
          ) : (
            <div className={TABLE.wrapper}>
              <table className={TABLE.table}>
                <thead className={TABLE.thead}>
                  <tr>
                    <th scope="col" className={TABLE.th}>Period</th>
                    <th scope="col" className={TABLE.th}>Frequency</th>
                    <th scope="col" className={TABLE.th}>Status</th>
                    <th scope="col" className={TABLE.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map(run => (
                    <tr key={run.id} className={TABLE.tr}>
                      <td className={TABLE.td}>
                        <p className="font-medium">{run.period_start}</p>
                        <p className="text-xs text-gray-400">to {run.period_end}</p>
                      </td>
                      <td className={TABLE.td + ' text-gray-500'}>{FREQ_LABEL[run.pay_frequency] || run.pay_frequency}</td>
                      <td className={TABLE.td}>
                        <span className={STATUS_BADGE[run.status] || BADGE.gray}>{STATUS_LABEL[run.status] || run.status}</span>
                      </td>
                      <td className={TABLE.td}>
                        <button className={`${BTN.secondary} ${BTN.sm}`} onClick={() => navigate(`/payroll/${run.id}`)}>Open</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {ConfirmDialog}
      </div>
    );
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Payroll Runs</h1>
          <p className={PAGE.subtitle}>Gross pay calculation, approval, and export to Sage/Xero</p>
        </div>
        {canEdit && (
          <button className={BTN.primary} onClick={() => setShowCreate(true)}>+ New Payroll Run</button>
        )}
      </div>

      {notice && <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">{notice.content}</InlineNotice>}
      {error && <ErrorState title="Unable to load payroll data" message={error} onRetry={() => void load()} className="mb-4" />}

      {latest && (
        <div className="grid grid-cols-2 gap-4 mb-6 md:grid-cols-4">
          <div className={CARD.padded}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Latest Period</p>
            <p className="mt-1 text-sm font-semibold text-gray-900">{latest.period_start}</p>
            <p className="text-sm font-semibold text-gray-900">to {latest.period_end}</p>
          </div>
          <div className={CARD.padded}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Total Gross</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{formatMoney(latest.total_gross)}</p>
          </div>
          <div className={CARD.padded}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Enhancements</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{formatMoney(latest.total_enhancements)}</p>
          </div>
          <div className={CARD.padded}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Staff</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{latest.staff_count ?? '—'}</p>
          </div>
        </div>
      )}

      <div className={CARD.flush}>
        {runs.length === 0 ? (
          <EmptyState
            title="No payroll runs yet"
            description="Create your first payroll run to calculate pay, review exceptions, and export it."
            actionLabel={canEdit ? 'Create Payroll Run' : undefined}
            onAction={canEdit ? () => setShowCreate(true) : undefined}
          />
        ) : (
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th scope="col" className={TABLE.th}>Period</th>
                  <th scope="col" className={TABLE.th}>Frequency</th>
                  <th scope="col" className={TABLE.th}>Status</th>
                  <th scope="col" className={TABLE.th}>Staff</th>
                  <th scope="col" className={TABLE.th}>Total Gross</th>
                  <th scope="col" className={TABLE.th}>Enhancements</th>
                  <th scope="col" className={TABLE.th}>Exported</th>
                  <th scope="col" className={TABLE.th}></th>
                </tr>
              </thead>
              <tbody>
                {runs.map(run => (
                  <tr key={run.id} className={TABLE.tr}>
                    <td className={TABLE.td}>
                      <p className="font-medium">{run.period_start}</p>
                      <p className="text-xs text-gray-400">to {run.period_end}</p>
                    </td>
                    <td className={TABLE.td + ' text-gray-500'}>{FREQ_LABEL[run.pay_frequency] || run.pay_frequency}</td>
                    <td className={TABLE.td}>
                      <span className={STATUS_BADGE[run.status] || BADGE.gray}>{STATUS_LABEL[run.status] || run.status}</span>
                    </td>
                    <td className={TABLE.td}>{run.staff_count ?? '—'}</td>
                    <td className={`${TABLE.td} font-mono`}>{formatMoney(run.total_gross)}</td>
                    <td className={`${TABLE.td} font-mono`}>{formatMoney(run.total_enhancements)}</td>
                    <td className={TABLE.td + ' text-xs text-gray-500'}>{run.exported_at ? run.exported_at.slice(0, 10) : '—'}</td>
                    <td className={TABLE.td}>
                      <div className="flex gap-1">
                        <button className={`${BTN.secondary} ${BTN.sm}`} onClick={() => navigate(`/payroll/${run.id}`)}>View</button>
                        {canEdit && ['draft', 'calculated'].includes(run.status) && (
                          <button className={`${BTN.danger} ${BTN.sm}`} onClick={() => void handleVoid(run)}>
                            Void
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Payroll Run" size="lg">
        <div className="space-y-4">
          <div>
            <label className={INPUT.label}>Pay Frequency</label>
            <select className={INPUT.select} value={form.pay_frequency} onChange={e => handleFreqChange(e.target.value)}>
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Fortnightly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Period Start</label>
              <input
                type="date"
                className={INPUT.base}
                value={form.period_start}
                onChange={e => setForm(current => ({ ...current, period_start: e.target.value }))}
              />
            </div>
            <div>
              <label className={INPUT.label}>Period End</label>
              <input
                type="date"
                className={INPUT.base}
                value={form.period_end}
                onChange={e => setForm(current => ({ ...current, period_end: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Notes (optional)</label>
            <input
              className={INPUT.sm}
              value={form.notes}
              onChange={e => setForm(current => ({ ...current, notes: e.target.value }))}
              placeholder="e.g. May 2026 monthly payroll"
            />
          </div>
        </div>
        <div className={MODAL.footer}>
          <button className={BTN.secondary} onClick={() => setShowCreate(false)}>Cancel</button>
          <button className={BTN.primary} onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating...' : 'Create Run'}
          </button>
        </div>
      </Modal>
      {ConfirmDialog}
    </div>
  );
}
