import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, BADGE, PAGE, INPUT } from '../lib/design.js';
import { getCurrentHome, getLoggedInUser, getFinanceDashboard, getFinanceAlerts } from '../lib/api.js';
import { formatCurrency, getLabel, EXPENSE_CATEGORIES } from '../lib/finance.js';

const ALERT_STYLES = {
  error: 'bg-red-50 border-red-200 text-red-700',
  warning: 'bg-amber-50 border-amber-200 text-amber-700',
  info: 'bg-blue-50 border-blue-200 text-blue-700',
};

export default function FinanceDashboard() {
  const _isAdmin = getLoggedInUser()?.role === 'admin';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    return {
      from: `${y}-${String(m + 1).padStart(2, '0')}-01`,
      to: now.toISOString().slice(0, 10),
    };
  });
  const home = getCurrentHome();

  const datesReversed = period.from > period.to;

  const load = useCallback(async () => {
    if (!home || datesReversed) return;
    setLoading(true);
    try {
      const [d, a] = await Promise.all([
        getFinanceDashboard(home, period.from, period.to),
        getFinanceAlerts(home),
      ]);
      setDashboard(d);
      setAlerts(Array.isArray(a) ? a : []);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [home, period.from, period.to, datesReversed]);

  useEffect(() => { load(); }, [load]);

  async function handleExport() {
    if (!dashboard) return;
    const { downloadXLSX } = await import('../lib/excel.js');
    const sheets = [];
    const trendRows = buildTrendRows(dashboard.income_trend, dashboard.expense_trend);
    if (trendRows.length) {
      sheets.push({
        name: 'Monthly Summary',
        headers: ['Month', 'Income', 'Expenses', 'Net'],
        rows: trendRows.map(r => [r.month, r.income, r.expenses, r.net]),
      });
    }
    if (dashboard.expenses_by_category?.length) {
      sheets.push({
        name: 'Expenses by Category',
        headers: ['Category', 'Total', 'Count'],
        rows: dashboard.expenses_by_category.map(c => [getLabel(c.category, EXPENSE_CATEGORIES), c.total, c.count]),
      });
    }
    if (dashboard.ageing?.overdue_items?.length) {
      sheets.push({
        name: 'Overdue Receivables',
        headers: ['Invoice #', 'Payer', 'Type', 'Total', 'Paid', 'Outstanding', 'Due Date', 'Days Overdue'],
        rows: dashboard.ageing.overdue_items.map(i => [
          i.invoice_number, i.payer_name, i.payer_type,
          i.total_amount, i.amount_paid, i.outstanding, i.due_date, i.days_overdue,
        ]),
      });
    }
    if (sheets.length) downloadXLSX(`finance_dashboard_${period.from}_to_${period.to}.xlsx`, sheets);
  }

  if (loading) return <div className={PAGE.container} role="status"><div className={CARD.padded}><p className="text-center py-10 text-gray-500">Loading finance data...</p></div></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Finance Dashboard</h1>
          <p className={PAGE.subtitle}>Income, expenses and financial position</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={period.from} onChange={e => setPeriod(p => ({ ...p, from: e.target.value }))}
            className={`${INPUT.sm} w-auto`} />
          <span className="text-gray-400">to</span>
          <input type="date" value={period.to} onChange={e => setPeriod(p => ({ ...p, to: e.target.value }))}
            className={`${INPUT.sm} w-auto`} />
          <button onClick={load} className={`${BTN.secondary} ${BTN.sm}`}>Refresh</button>
          <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
        </div>
      </div>

      {datesReversed && <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg mb-4 text-sm">"From" date is after "To" date — adjust the date range to load data.</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4" role="alert">{error}</div>}

      {/* KPI Cards */}
      {dashboard && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KPICard label="Income (Invoiced)" value={formatCurrency(dashboard.income?.total_invoiced)} sub={`${dashboard.income?.invoice_count ?? 0} invoices`} color="emerald" />
            <KPICard label="Total Expenses" value={formatCurrency(dashboard.expenses?.total_all)} sub={`Staff: ${formatCurrency(dashboard.expenses?.staff_costs)} | Agency: ${formatCurrency(dashboard.expenses?.agency_costs)}`} color="red" />
            <KPICard label="Net Position" value={formatCurrency(dashboard.net_position)} sub={`Margin: ${(dashboard.margin ?? 0).toFixed(1)}%`} color={dashboard.net_position >= 0 ? 'emerald' : 'red'} />
            <KPICard label="Occupancy" value={`${(dashboard.occupancy?.rate ?? 0).toFixed(0)}%`} sub={`${dashboard.occupancy?.active ?? 0} of ${dashboard.occupancy?.registered_beds ?? 0} beds`} color="blue" />
          </div>

          {/* Alerts */}
          {alerts.length > 0 && (
            <div className={`${CARD.padded} mb-6`}>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Alerts</h2>
              <div className="space-y-2">
                {alerts.map((a, i) => (
                  <div key={i} className={`px-3 py-2 rounded-lg border text-sm ${ALERT_STYLES[a.type] || ALERT_STYLES.info}`}>
                    {a.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Receivables Ageing */}
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

          {/* Expenses by Category */}
          {dashboard.expenses_by_category?.length > 0 && (
            <div className={`${CARD.padded} mb-6`}>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Expenses by Category</h2>
              <div className={TABLE.wrapper}>
                <table className={TABLE.table}>
                  <thead className={TABLE.thead}><tr>
                    <th scope="col" className={TABLE.th}>Category</th>
                    <th scope="col" className={`${TABLE.th} text-right`}>Total</th>
                    <th scope="col" className={`${TABLE.th} text-right`}>Count</th>
                  </tr></thead>
                  <tbody>
                    {dashboard.expenses_by_category.map(c => (
                      <tr key={c.category} className={TABLE.tr}>
                        <td className={TABLE.td}>{getLabel(c.category, EXPENSE_CATEGORIES)}</td>
                        <td className={`${TABLE.td} text-right font-mono`}>{formatCurrency(c.total)}</td>
                        <td className={`${TABLE.td} text-right`}>{c.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Monthly Trends */}
          {(dashboard.income_trend?.length > 0 || dashboard.expense_trend?.length > 0) && (
            <div className={`${CARD.padded} mb-6`}>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Monthly Summary (Last 6 Months)</h2>
              <div className={TABLE.wrapper}>
                <table className={TABLE.table}>
                  <thead className={TABLE.thead}><tr>
                    <th scope="col" className={TABLE.th}>Month</th>
                    <th scope="col" className={`${TABLE.th} text-right`}>Income</th>
                    <th scope="col" className={`${TABLE.th} text-right`}>Expenses</th>
                    <th scope="col" className={`${TABLE.th} text-right`}>Net</th>
                  </tr></thead>
                  <tbody>
                    {buildTrendRows(dashboard.income_trend, dashboard.expense_trend).map(r => (
                      <tr key={r.month} className={TABLE.tr}>
                        <td className={TABLE.td}>{r.month}</td>
                        <td className={`${TABLE.td} text-right font-mono`}>{formatCurrency(r.income)}</td>
                        <td className={`${TABLE.td} text-right font-mono`}>{formatCurrency(r.expenses)}</td>
                        <td className={`${TABLE.td} text-right font-mono ${r.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(r.net)}</td>
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
  for (const r of incomeTrend) months.set(r.month, { month: r.month, income: r.invoiced ?? r.total ?? 0, expenses: 0 });
  for (const r of expenseTrend) {
    const existing = months.get(r.month) || { month: r.month, income: 0, expenses: 0 };
    existing.expenses = r.total ?? 0;
    months.set(r.month, existing);
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map(r => ({ ...r, net: r.income - r.expenses }));
}
