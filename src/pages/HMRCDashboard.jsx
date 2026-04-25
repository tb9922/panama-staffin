import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { getHMRCLiabilities, markHMRCPaid, getCurrentHome } from '../lib/api.js';
import { useData } from '../contexts/DataContext.jsx';
import { useToast } from '../contexts/useToast.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import useTransientNotice from '../hooks/useTransientNotice.js';
import { todayLocalISO } from '../lib/localDates.js';
import { currentTaxYearForDate } from '../lib/hmrcDates.js';
import { loadAllPayrollRuns } from '../lib/payrollRuns.js';

const STATUS_BADGE = {
  unpaid:  BADGE.amber,
  paid:    BADGE.green,
  overdue: BADGE.red,
};

const STATUS_LABEL = {
  unpaid:  'Unpaid',
  paid:    'Paid',
  overdue: 'Overdue',
};

const MONTH_NAMES = [
  'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December', 'January', 'February', 'March',
];

function taxMonthLabel(taxMonth) {
  return MONTH_NAMES[(taxMonth - 1) % 12] || `Month ${taxMonth}`;
}

function fmt(n) {
  if (n == null) return '—';
  const v = parseFloat(n);
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function currentTaxYear() {
  return currentTaxYearForDate();
}

function addDaysIso(isoDate, days) {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function getRunPayDate(run) {
  return run?.pay_date || run?.period_end || null;
}

function buildRtiAlerts(runs, today = todayLocalISO()) {
  const actionable = runs.filter((run) => ['approved', 'locked'].includes(run.status));
  const late = actionable.filter((run) => !run.exported_at && getRunPayDate(run) && getRunPayDate(run) < today);
  const ready = actionable.filter((run) => !run.exported_at);
  const dueSoon = runs.filter((run) => {
    const payDate = getRunPayDate(run);
    return ['approved', 'locked'].includes(run.status) && !run.exported_at && payDate && payDate >= today && payDate <= addDaysIso(today, 2);
  });

  return [
    late.length > 0
      ? {
          key: 'late',
          variant: 'error',
          text: `${late.length} payroll run${late.length !== 1 ? 's are' : ' is'} past payday and still not exported for FPS/accountant filing.`,
        }
      : null,
    late.length === 0 && ready.length > 0
      ? {
          key: 'ready',
          variant: 'warning',
          text: `${ready.length} approved payroll run${ready.length !== 1 ? 's still need' : ' still needs'} FPS/export action on or before payday.`,
        }
      : null,
    dueSoon.length > 0
      ? {
          key: 'due-soon',
          variant: 'info',
          text: `${dueSoon.length} payroll run${dueSoon.length !== 1 ? 's reach' : ' reaches'} payday within 48 hours. Check RTI/FPS readiness now.`,
        }
      : null,
  ].filter(Boolean);
}

export default function HMRCDashboard() {
  const homeSlug = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('payroll');
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const { showToast } = useToast();

  const [liabilities, setLiabilities] = useState([]);
  const [payrollRuns, setPayrollRuns] = useState([]);
  const [payrollRunsDegraded, setPayrollRunsDegraded] = useState(false);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [saving, setSaving]           = useState(false);
  const [taxYear, setTaxYear]         = useState(currentTaxYear());
  const [showPaidModal, setShowPaidModal] = useState(null); // liability object
  const [paidForm, setPaidForm]       = useState({ paid_date: '', paid_reference: '' });
  useDirtyGuard(!!showPaidModal);

  const load = useCallback(async () => {
    if (!homeSlug) return;
    try {
      setLoading(true);
      setError(null);
      setPayrollRunsDegraded(false);
      const [liabilitiesResult, payrollRunsResult] = await Promise.allSettled([
        getHMRCLiabilities(homeSlug, taxYear),
        loadAllPayrollRuns(homeSlug),
      ]);
      if (liabilitiesResult.status !== 'fulfilled') {
        throw liabilitiesResult.reason;
      }
      setLiabilities(liabilitiesResult.value);
      if (payrollRunsResult.status === 'fulfilled') {
        setPayrollRuns(payrollRunsResult.value);
      } else {
        setPayrollRuns([]);
        setPayrollRunsDegraded(true);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug, taxYear]);

  useEffect(() => { load(); }, [load]);

  const overdue  = liabilities.filter(l => l.status === 'overdue');
  const unpaid   = liabilities.filter(l => l.status === 'unpaid');
  const paid     = liabilities.filter(l => l.status === 'paid');

  const totalDue    = liabilities.reduce((s, l) => s + parseFloat(l.total_due || 0), 0);
  const totalOwed   = liabilities
    .filter(l => l.status !== 'paid')
    .reduce((s, l) => s + parseFloat(l.total_due || 0), 0);
  const totalPaid   = liabilities
    .filter(l => l.status === 'paid')
    .reduce((s, l) => s + parseFloat(l.total_due || 0), 0);
  const rtiAlerts = buildRtiAlerts(payrollRuns);

  function openPaid(liability) {
    setPaidForm({ paid_date: todayLocalISO(), paid_reference: '' });
    setShowPaidModal(liability);
  }

  async function handleMarkPaid() {
    if (!showPaidModal || !paidForm.paid_date) return;
    setSaving(true);
    try {
      await markHMRCPaid(homeSlug, showPaidModal.id, paidForm);
      showNotice('HMRC liability marked as paid.');
      showToast({ title: 'HMRC liability updated', message: `Month ${showPaidModal.tax_month}` });
      setShowPaidModal(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const taxYearOptions = [];
  const now = currentTaxYear();
  for (let y = now; y >= now - 4; y--) taxYearOptions.push(y);

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading HMRC liabilities..." /></div>;

  return (
    <div className={PAGE.container}>
      {notice && (
        <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">
          {notice.content}
        </InlineNotice>
      )}
      {/* Header */}
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>HMRC Liabilities</h1>
          <p className="text-sm text-gray-500 mt-1">
            Monthly PAYE and National Insurance liabilities. Payment due by the 19th of the following month.
            Estimated liability — confirm with your accountant after FPS submission.
          </p>
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label htmlFor="hmrc-tax-year" className="text-sm font-medium text-[var(--ink-2)]">Tax year</label>
          <select
            id="hmrc-tax-year"
            className={INPUT.select + ' w-36'}
            value={taxYear}
            onChange={e => setTaxYear(Number(e.target.value))}
          >
            {taxYearOptions.map(y => (
              <option key={y} value={y}>{y}/{String(y + 1).slice(2)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <ErrorState title="HMRC action needs attention" message={error} onRetry={() => void load()} className="mb-4" />
      )}

      {/* Overdue alert */}
      {overdue.length > 0 && (
        <InlineNotice variant="error" className="mb-4">
          <strong>{overdue.length} overdue payment{overdue.length !== 1 ? 's' : ''}.</strong>{' '}
          HMRC penalties may apply. Total overdue: {fmt(overdue.reduce((s, l) => s + parseFloat(l.total_due || 0), 0))}.
        </InlineNotice>
      )}

      {rtiAlerts.map((alert) => (
        <InlineNotice key={alert.key} className="mb-4" variant={alert.variant}>
          {alert.text}
        </InlineNotice>
      ))}
      {payrollRunsDegraded && (
        <InlineNotice className="mb-4" variant="warning">
          RTI/FPS readiness alerts are temporarily unavailable because payroll runs could not be loaded.
        </InlineNotice>
      )}

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Total Due Year', value: fmt(totalDue), badge: null },
          { label: 'Outstanding', value: fmt(totalOwed), badge: totalOwed > 0 ? 'amber' : 'green' },
          { label: 'Paid', value: fmt(totalPaid), badge: 'green' },
          { label: 'Overdue', value: fmt(overdue.reduce((s, l) => s + parseFloat(l.total_due || 0), 0)), badge: overdue.length > 0 ? 'red' : null },
        ].map(({ label, value }) => (
          <div key={label} className={CARD.padded}>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-4)]">{label}</div>
            <div className="mt-2 font-mono text-xl font-semibold text-[var(--ink)]">{value}</div>
          </div>
        ))}
      </div>

      {/* Summary pills */}
      <div className="mb-4 flex gap-3 flex-wrap text-sm">
        <span className={`px-3 py-1 rounded-full ${BADGE.amber}`}>{unpaid.length} unpaid</span>
        <span className={`px-3 py-1 rounded-full ${BADGE.green}`}>{paid.length} paid</span>
        {overdue.length > 0 && (
          <span className={`px-3 py-1 rounded-full ${BADGE.red}`}>{overdue.length} overdue</span>
        )}
      </div>

      {/* Liabilities table */}
      <div className={CARD.flush}>
        <div className="flex flex-col gap-1 border-b border-[var(--line)] bg-[var(--paper)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--ink)]">Liability ledger</h2>
            <p className="text-xs text-[var(--ink-3)]">PAYE, employee NI, employer NI, payment status, and reference tracking by tax month.</p>
          </div>
        </div>
        <div className={TABLE.wrapper} tabIndex={0} aria-label="HMRC liability ledger table">
          <table className={TABLE.table}>
          <thead className={TABLE.thead}>
            <tr>
              <th scope="col" className={TABLE.th}>Tax Month</th>
              <th scope="col" className={TABLE.th}>Period</th>
              <th scope="col" className={TABLE.th}>PAYE</th>
              <th scope="col" className={TABLE.th}>Employee NI</th>
              <th scope="col" className={TABLE.th}>Employer NI</th>
              <th scope="col" className={TABLE.th}>Total Due</th>
              <th scope="col" className={TABLE.th}>Payment Due</th>
              <th scope="col" className={TABLE.th}>Status</th>
              <th scope="col" className={TABLE.th}>Paid Reference</th>
              {canEdit && <th scope="col" className={TABLE.th}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {liabilities.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 10 : 9} className={TABLE.empty}>
                  <EmptyState
                    compact
                    title={`No HMRC liabilities for ${taxYear}/${String(taxYear + 1).slice(2)}`}
                    description="Liabilities are created automatically when payroll runs are approved."
                  />
                </td>
              </tr>
            )}
            {liabilities.map(l => (
              <tr key={l.id} className={TABLE.tr}>
                <td className={TABLE.td}>
                  <span className="font-medium">{taxMonthLabel(l.tax_month)}</span>
                  <div className="text-xs text-gray-400">Month {l.tax_month}</div>
                </td>
                <td className={TABLE.td}>
                  <div className="text-xs text-gray-600">{l.period_start}</div>
                  <div className="text-xs text-gray-600">to {l.period_end}</div>
                </td>
                <td className={`${TABLE.td} font-mono text-sm`}>{fmt(l.total_paye)}</td>
                <td className={`${TABLE.td} font-mono text-sm`}>{fmt(l.total_employee_ni)}</td>
                <td className={`${TABLE.td} font-mono text-sm`}>{fmt(l.total_employer_ni)}</td>
                <td className={`${TABLE.td} font-mono text-sm font-semibold`}>{fmt(l.total_due)}</td>
                <td className={TABLE.td}>
                  <span className={l.status === 'overdue' ? 'text-red-700 font-medium' : ''}>
                    {l.payment_due_date}
                  </span>
                </td>
                <td className={TABLE.td}>
                  <span className={`text-xs px-2 py-0.5 rounded ${STATUS_BADGE[l.status] || BADGE.gray}`}>
                    {l.status === 'overdue' ? 'Overdue' : l.status === 'paid' ? 'Paid' : 'Unpaid'}
                  </span>
                </td>
                <td className={TABLE.td}>
                  {l.paid_date ? (
                    <div>
                      <div className="text-xs text-gray-600">{l.paid_date}</div>
                      {l.paid_reference && (
                        <div className="text-xs text-gray-400 font-mono">{l.paid_reference}</div>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-400 text-xs">—</span>
                  )}
                </td>
                {canEdit && (
                  <td className={TABLE.td}>
                    {l.status !== 'paid' ? (
                      <button
                        type="button"
                        className={BTN.success + ' ' + BTN.xs}
                        onClick={() => openPaid(l)}
                        title={`Mark ${taxMonthLabel(l.tax_month)} as paid`}
                      >
                        Mark Paid
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {liabilities.length > 0 && (
            <tfoot>
              <tr className="bg-gray-50 font-semibold">
                <td className={TABLE.td} colSpan={5}>Totals</td>
                <td className={`${TABLE.td} font-mono`}>{fmt(totalDue)}</td>
                <td className={TABLE.td} colSpan={canEdit ? 4 : 3}></td>
              </tr>
            </tfoot>
          )}
          </table>
        </div>
      </div>

      {/* Notes */}
      <div className="mt-4 text-xs text-gray-400 space-y-1">
        <p>
          <strong>Payment deadline:</strong> PAYE and NI must be paid to HMRC by the 19th of the month
          following the end of the tax month (22nd for electronic payment). Late payment incurs penalties.
        </p>
        <p>
          <strong>Employment Allowance:</strong> If your home claims Employment Allowance (up to £10.5k/year
          from April 2025), this reduces Employer NI due. Contact your accountant to apply this via HMRC Basic
          PAYE Tools or your payroll software.
        </p>
        <p>
          <strong>Liabilities are accumulated:</strong> If a home runs multiple payroll periods in the same
          tax month, the totals are combined into a single row per month.
        </p>
      </div>

      {/* Mark as Paid modal */}
      <Modal isOpen={!!showPaidModal} onClose={() => setShowPaidModal(null)} title="Mark as Paid" size="sm">
        <p className="text-sm text-gray-600 mb-4">
          {showPaidModal && taxMonthLabel(showPaidModal.tax_month)} — Total: {showPaidModal && fmt(showPaidModal.total_due)}
        </p>

        <div className="space-y-4">
          <div>
            <label htmlFor="hmrc-paid-date" className={INPUT.label}>Payment Date</label>
            <input
              id="hmrc-paid-date"
              type="date"
              className={INPUT.base}
              value={paidForm.paid_date}
              onChange={e => setPaidForm(f => ({ ...f, paid_date: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="hmrc-paid-reference" className={INPUT.label}>Payment Reference (optional)</label>
            <input
              id="hmrc-paid-reference"
              className={INPUT.base}
              value={paidForm.paid_reference}
              onChange={e => setPaidForm(f => ({ ...f, paid_reference: e.target.value }))}
              placeholder="e.g. HMRC Ref 12345 or bank ref"
            />
          </div>
        </div>

        <div className={MODAL.footer}>
          <button className={BTN.secondary} onClick={() => setShowPaidModal(null)} disabled={saving}>
            Cancel
          </button>
          <button
            className={BTN.success}
            onClick={handleMarkPaid}
            disabled={saving || !paidForm.paid_date}
          >
            {saving ? 'Saving...' : 'Confirm Paid'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
