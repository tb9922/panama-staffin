import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, PAGE, INPUT } from '../lib/design.js';
import { getCurrentHome, getFinanceDashboard, getFinanceAlerts } from '../lib/api.js';
import { formatCurrency, getLabel, EXPENSE_CATEGORIES } from '../lib/finance.js';
import { startOfLocalMonthISO, todayLocalISO } from '../lib/localDates.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';

const ALERT_STYLES = {
  error: 'bg-[var(--alert-soft)] border-[var(--alert)] text-[var(--alert)]',
  warning: 'bg-[var(--caution-soft)] border-[var(--caution)] text-[var(--caution)]',
  info: 'bg-[var(--info-soft)] border-[var(--info)] text-[var(--info)]',
};

const DEGRADED_METRIC_LABELS = {
  staff_costs: 'staff costs',
  agency_costs: 'agency costs',
  registered_beds: 'registered bed count',
};

function formatPercent(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(digits)}%`;
}

export default function FinanceDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [period, setPeriod] = useState(() => ({
    from: startOfLocalMonthISO(),
    to: todayLocalISO(),
  }));
  const home = getCurrentHome();

  const datesReversed = period.from > period.to;

  const load = useCallback(async (signal) => {
    if (!home || datesReversed) return;
    setLoading(true);
    try {
      const [nextDashboard, nextAlerts] = await Promise.all([
        getFinanceDashboard(home, period.from, period.to),
        getFinanceAlerts(home),
      ]);
      if (signal?.cancelled) return;
      setDashboard(nextDashboard);
      setAlerts(Array.isArray(nextAlerts) ? nextAlerts : []);
      setError(null);
    } catch (e) {
      if (!signal?.cancelled) setError(e.message);
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }, [datesReversed, home, period.from, period.to]);

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  async function handleExport() {
    if (!dashboard) return;
    const { downloadXLSX } = await import('../lib/excel.js');
    const sheets = [];
    const trendRows = buildTrendRows(dashboard.income_trend, dashboard.expense_trend);
    if (trendRows.length) {
      sheets.push({
        name: 'Monthly Summary',
        headers: ['Month', 'Income', 'Expenses', 'Net'],
        rows: trendRows.map(row => [row.month, row.income, row.expenses, row.net]),
      });
    }
    if (dashboard.expenses_by_category?.length) {
      sheets.push({
        name: 'Expenses by Category',
        headers: ['Category', 'Total', 'Count'],
        rows: dashboard.expenses_by_category.map(category => [
          getLabel(category.category, EXPENSE_CATEGORIES),
          category.total,
          category.count,
        ]),
      });
    }
    if (dashboard.ageing?.overdue_items?.length) {
      sheets.push({
        name: 'Overdue Receivables',
        headers: ['Invoice #', 'Payer', 'Type', 'Total', 'Paid', 'Outstanding', 'Due Date', 'Days Overdue'],
        rows: dashboard.ageing.overdue_items.map(item => [
          item.invoice_number,
          item.payer_name,
          item.payer_type,
          item.total_amount,
          item.amount_paid,
          item.outstanding,
          item.due_date,
          item.days_overdue,
        ]),
      });
    }
    if (sheets.length) {
      downloadXLSX(`finance_dashboard_${period.from}_to_${period.to}.xlsx`, sheets);
    }
  }

  if (loading) {
    return <LoadingState message="Loading finance data..." className={PAGE.container} card />;
  }

  if (error && !dashboard && !datesReversed) {
    return (
      <div className={PAGE.container}>
        <ErrorState title="Unable to load finance dashboard" message={error} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Finance Dashboard</h1>
          <p className={PAGE.subtitle}>Income, expenses and financial position</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
          <input
            type="date"
            value={period.from}
            onChange={event => setPeriod(current => ({ ...current, from: event.target.value }))}
            className={`${INPUT.sm} min-w-0 flex-[1_1_8.5rem] sm:w-auto sm:flex-none`}
          />
          <span className="shrink-0 text-sm text-[var(--ink-4)]">to</span>
          <input
            type="date"
            value={period.to}
            onChange={event => setPeriod(current => ({ ...current, to: event.target.value }))}
            className={`${INPUT.sm} min-w-0 flex-[1_1_8.5rem] sm:w-auto sm:flex-none`}
          />
          <button onClick={() => void load()} className={`${BTN.secondary} ${BTN.sm} flex-1 whitespace-nowrap sm:flex-none`}>Refresh</button>
          <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm} flex-1 whitespace-nowrap sm:flex-none`}>Export Excel</button>
        </div>
      </div>

      {datesReversed && (
        <div className="mb-4 rounded-lg border border-[var(--caution)] bg-[var(--caution-soft)] px-4 py-3 text-sm text-[var(--caution)]">
          "From" date is after "To" date. Adjust the range to load data.
        </div>
      )}
      {error && dashboard && (
        <ErrorState title="Some finance data could not be refreshed" message={error} onRetry={() => void load()} className="mb-4" />
      )}
      {dashboard?.degraded && (
        <div className="mb-4 rounded-lg border border-[var(--caution)] bg-[var(--caution-soft)] px-4 py-3 text-sm text-[var(--caution)]">
          Some finance inputs are unavailable right now:
          {' '}
          {(dashboard.degraded_metrics || [])
            .map((metric) => DEGRADED_METRIC_LABELS[metric] || metric)
            .join(', ')}
          .
          Displayed totals may be incomplete until those sources recover.
        </div>
      )}

      {!dashboard ? (
        <div className={CARD.flush}>
          <EmptyState
            title="No finance dashboard data for this range"
            description="Try a broader date range or refresh once finance records have been added."
          />
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KPICard
              label="Income (Invoiced)"
              value={formatCurrency(dashboard.income?.total_invoiced)}
              sub={`${dashboard.income?.invoice_count ?? 0} invoices`}
              color="emerald"
            />
            <KPICard
              label="Total Expenses"
              value={formatCurrency(dashboard.expenses?.total_all)}
              sub={`Staff: ${formatCurrency(dashboard.expenses?.staff_costs)} | Agency: ${formatCurrency(dashboard.expenses?.agency_costs)}`}
              color="red"
            />
            <KPICard
              label="Net Position"
              value={formatCurrency(dashboard.net_position)}
              sub={`Margin: ${formatPercent(dashboard.margin)}`}
              color={dashboard.net_position == null ? 'blue' : dashboard.net_position >= 0 ? 'emerald' : 'red'}
            />
            <KPICard
              label="Occupancy"
              value={formatPercent(dashboard.occupancy?.rate, 0)}
              sub={dashboard.occupancy?.registered_beds == null
                ? `${dashboard.occupancy?.active ?? 0} beds occupied | registered beds unavailable`
                : `${dashboard.occupancy?.active ?? 0} of ${dashboard.occupancy?.registered_beds} beds`}
              color="blue"
            />
          </div>

          {alerts.length > 0 && (
            <div className={`${CARD.padded} mb-6`}>
              <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">Alerts</h2>
              <div className="space-y-2">
                {alerts.map((alert, index) => (
                  <div key={index} className={`rounded-lg border px-3 py-2 text-sm ${ALERT_STYLES[alert.type] || ALERT_STYLES.info}`}>
                    {alert.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {dashboard.ageing && (
            <div className={`${CARD.padded} mb-6`}>
              <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">Receivables Ageing</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <AgeingCard label="Current" value={dashboard.ageing.buckets?.current} color="emerald" />
                <AgeingCard label="1-30 days" value={dashboard.ageing.buckets?.days_1_30} color="amber" />
                <AgeingCard label="31-60 days" value={dashboard.ageing.buckets?.days_31_60} color="orange" />
                <AgeingCard label="61-90 days" value={dashboard.ageing.buckets?.days_61_90} color="red" />
                <AgeingCard label="90+ days" value={dashboard.ageing.buckets?.days_90_plus} color="red" />
              </div>
              <p className="mt-2 text-xs text-[var(--ink-3)]">Total outstanding: {formatCurrency(dashboard.ageing.total_outstanding)}</p>
            </div>
          )}

          {dashboard.expenses_by_category?.length > 0 && (
            <div className={`${CARD.padded} mb-6`}>
              <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">Expenses by Category</h2>
              <div className={TABLE.wrapper}>
                <table className={TABLE.table}>
                  <thead className={TABLE.thead}>
                    <tr>
                      <th scope="col" className={TABLE.th}>Category</th>
                      <th scope="col" className={`${TABLE.th} text-right`}>Total</th>
                      <th scope="col" className={`${TABLE.th} text-right`}>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.expenses_by_category.map(category => (
                      <tr key={category.category} className={TABLE.tr}>
                        <td className={TABLE.td}>{getLabel(category.category, EXPENSE_CATEGORIES)}</td>
                        <td className={`${TABLE.td} text-right font-mono`}>{formatCurrency(category.total)}</td>
                        <td className={`${TABLE.td} text-right`}>{category.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(dashboard.income_trend?.length > 0 || dashboard.expense_trend?.length > 0) && (
            <div className={`${CARD.padded} mb-6`}>
              <h2 className="mb-3 text-sm font-semibold text-[var(--ink)]">Monthly Summary (Last 6 Months)</h2>
              <div className={TABLE.wrapper}>
                <table className={TABLE.table}>
                  <thead className={TABLE.thead}>
                    <tr>
                      <th scope="col" className={TABLE.th}>Month</th>
                      <th scope="col" className={`${TABLE.th} text-right`}>Income</th>
                      <th scope="col" className={`${TABLE.th} text-right`}>Expenses</th>
                      <th scope="col" className={`${TABLE.th} text-right`}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buildTrendRows(dashboard.income_trend, dashboard.expense_trend).map(row => (
                      <tr key={row.month} className={TABLE.tr}>
                        <td className={TABLE.td}>{row.month}</td>
                        <td className={`${TABLE.td} text-right font-mono`}>{formatCurrency(row.income)}</td>
                        <td className={`${TABLE.td} text-right font-mono`}>{formatCurrency(row.expenses)}</td>
                        <td className={`${TABLE.td} text-right font-mono ${row.net >= 0 ? 'text-[var(--ok)]' : 'text-[var(--alert)]'}`}>
                          {formatCurrency(row.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const KPI_COLORS = {
  emerald: 'text-[var(--ok)]',
  red: 'text-[var(--alert)]',
  blue: 'text-[var(--info)]',
  amber: 'text-[var(--caution)]',
  orange: 'text-[var(--warn)]',
};

function KPICard({ label, value, sub, color }) {
  return (
    <div className={CARD.padded}>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-3)]">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${KPI_COLORS[color] || 'text-[var(--ink)]'}`}>{value}</p>
      <p className="mt-1 text-xs text-[var(--ink-3)]">{sub}</p>
    </div>
  );
}

function AgeingCard({ label, value, color }) {
  return (
    <div className="text-center">
      <p className="text-xs text-[var(--ink-3)]">{label}</p>
      <p className={`text-lg font-bold ${KPI_COLORS[color] || 'text-[var(--ink)]'}`}>{formatCurrency(value ?? 0)}</p>
    </div>
  );
}

function buildTrendRows(incomeTrend = [], expenseTrend = []) {
  const months = new Map();
  for (const row of incomeTrend) months.set(row.month, { month: row.month, income: row.invoiced ?? row.total ?? 0, expenses: 0 });
  for (const row of expenseTrend) {
    const current = months.get(row.month) || { month: row.month, income: 0, expenses: 0 };
    current.expenses = row.total ?? 0;
    months.set(row.month, current);
  }
  return [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(row => ({ ...row, net: row.income - row.expenses }));
}
