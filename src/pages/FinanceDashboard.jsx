import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, PAGE, INPUT } from '../lib/design.js';
import { getCurrentHome, getFinanceDashboard, getFinanceAlerts } from '../lib/api.js';
import { formatCurrency, getLabel, EXPENSE_CATEGORIES } from '../lib/finance.js';
import { startOfLocalMonthISO, todayLocalISO } from '../lib/localDates.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import { useToast } from '../contexts/ToastContext.jsx';

const ALERT_STYLES = {
  error: 'bg-red-50 border-red-200 text-red-700',
  warning: 'bg-amber-50 border-amber-200 text-amber-700',
  info: 'bg-blue-50 border-blue-200 text-blue-700',
};

export default function FinanceDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const { showToast } = useToast();
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
      const [dashboardData, alertData] = await Promise.all([
        getFinanceDashboard(home, period.from, period.to),
        getFinanceAlerts(home),
      ]);
      if (signal?.cancelled) return;
      setDashboard(dashboardData);
      setAlerts(Array.isArray(alertData) ? alertData : []);
      setError(null);
    } catch (e) {
      if (!signal?.cancelled) setError(e.message);
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }, [home, period.from, period.to, datesReversed]);

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => { signal.cancelled = true; };
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
        rows: trendRows.map((row) => [row.month, row.income, row.expenses, row.net]),
      });
    }
    if (dashboard.expenses_by_category?.length) {
      sheets.push({
        name: 'Expenses by Category',
        headers: ['Category', 'Total', 'Count'],
        rows: dashboard.expenses_by_category.map((category) => [
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
        rows: dashboard.ageing.overdue_items.map((item) => [
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
      showToast({ title: 'Finance dashboard exported', message: `Workbook downloaded for ${period.from} to ${period.to}` });
    }
  }

  if (loading) {
    return (
      <div className={PAGE.container}>
        <LoadingState message="Loading finance data..." card />
      </div>
    );
  }

  if (error && !dashboard) {
    return (
      <div className={PAGE.container}>
        <ErrorState
          title="Finance dashboard needs attention"
          message={error}
          onRetry={() => void load()}
        />
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
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={period.from}
            onChange={(e) => setPeriod((value) => ({ ...value, from: e.target.value }))}
            className={`${INPUT.sm} w-auto`}
          />
          <span className="text-gray-400">to</span>
          <input
            type="date"
            value={period.to}
            onChange={(e) => setPeriod((value) => ({ ...value, to: e.target.value }))}
            className={`${INPUT.sm} w-auto`}
          />
          <button onClick={() => void load()} className={`${BTN.secondary} ${BTN.sm}`}>Refresh</button>
          <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
        </div>
      </div>

      {datesReversed && (
        <InlineNotice variant="warning" className="mb-4">
          "From" date is after "To" date - adjust the date range to load data.
        </InlineNotice>
      )}
      {error && <ErrorState title="Finance data needs attention" message={error} onRetry={() => void load()} className="mb-4" />}

      {!dashboard && !error && !datesReversed ? (
        <div className={CARD.padded}>
          <EmptyState
            title="No finance data available yet"
            description="Refresh the dashboard after income, expenses, or receivables have been recorded for this period."
            compact
          />
        </div>
      ) : null}

      {dashboard ? (
        <>
          <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
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
              sub={`Margin: ${(dashboard.margin ?? 0).toFixed(1)}%`}
              color={dashboard.net_position >= 0 ? 'emerald' : 'red'}
            />
            <KPICard
              label="Occupancy"
              value={`${(dashboard.occupancy?.rate ?? 0).toFixed(0)}%`}
              sub={`${dashboard.occupancy?.active ?? 0} of ${dashboard.occupancy?.registered_beds ?? 0} beds`}
              color="blue"
            />
          </div>

          {alerts.length > 0 && (
            <div className={`${CARD.padded} mb-6`}>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Alerts</h2>
              <div className="space-y-2">
                {alerts.map((alert, index) => (
                  <div key={`${alert.message}-${index}`} className={`px-3 py-2 rounded-lg border text-sm ${ALERT_STYLES[alert.type] || ALERT_STYLES.info}`}>
                    {alert.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {dashboard.ageing && (
            <div className={`${CARD.padded} mb-6`}>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Receivables Ageing</h2>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <AgeingCard label="Current" value={dashboard.ageing.buckets?.current} color="emerald" />
                <AgeingCard label="1-30 days" value={dashboard.ageing.buckets?.days_1_30} color="amber" />
                <AgeingCard label="31-60 days" value={dashboard.ageing.buckets?.days_31_60} color="orange" />
                <AgeingCard label="61-90 days" value={dashboard.ageing.buckets?.days_61_90} color="red" />
                <AgeingCard label="90+ days" value={dashboard.ageing.buckets?.days_90_plus} color="red" />
              </div>
              <p className="text-xs text-gray-500 mt-2">Total outstanding: {formatCurrency(dashboard.ageing.total_outstanding)}</p>
            </div>
          )}

          {dashboard.expenses_by_category?.length > 0 && (
            <div className={`${CARD.padded} mb-6`}>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Expenses by Category</h2>
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
                    {dashboard.expenses_by_category.map((category) => (
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
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Monthly Summary (Last 6 Months)</h2>
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
                    {buildTrendRows(dashboard.income_trend, dashboard.expense_trend).map((row) => (
                      <tr key={row.month} className={TABLE.tr}>
                        <td className={TABLE.td}>{row.month}</td>
                        <td className={`${TABLE.td} text-right font-mono`}>{formatCurrency(row.income)}</td>
                        <td className={`${TABLE.td} text-right font-mono`}>{formatCurrency(row.expenses)}</td>
                        <td className={`${TABLE.td} text-right font-mono ${row.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(row.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

const KPI_COLORS = {
  emerald: 'text-emerald-600',
  red: 'text-red-600',
  blue: 'text-blue-600',
  amber: 'text-amber-600',
  orange: 'text-orange-600',
};

function KPICard({ label, value, sub, color }) {
  return (
    <div className={CARD.padded}>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${KPI_COLORS[color] || 'text-gray-900'}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{sub}</p>
    </div>
  );
}

function AgeingCard({ label, value, color }) {
  return (
    <div className="text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold ${KPI_COLORS[color] || 'text-gray-900'}`}>{formatCurrency(value ?? 0)}</p>
    </div>
  );
}

function buildTrendRows(incomeTrend = [], expenseTrend = []) {
  const months = new Map();
  for (const row of incomeTrend) months.set(row.month, { month: row.month, income: row.invoiced ?? row.total ?? 0, expenses: 0 });
  for (const row of expenseTrend) {
    const existing = months.get(row.month) || { month: row.month, income: 0, expenses: 0 };
    existing.expenses = row.total ?? 0;
    months.set(row.month, existing);
  }
  return [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => ({ ...row, net: row.income - row.expenses }));
}
