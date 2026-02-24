import { useState, useMemo } from 'react';
import { getStaffForDay, formatDate, isWorkingShift } from '../lib/rotation.js';
import { calculateDayCost } from '../lib/escalation.js';

function getMonthDates(year, month) {
  const dates = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

export default function BudgetTracker({ data, updateData }) {
  const [editingBudget, setEditingBudget] = useState(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [agencyCapInput, setAgencyCapInput] = useState('');

  const defaultBudget = data.config.monthly_staff_budget || 0;
  const defaultAgencyCap = data.config.monthly_agency_cap || 0;
  const budgetOverrides = data.config.budget_overrides || {};

  // 12-month rolling view: 6 months back, current, 5 months forward
  const months = useMemo(() => {
    const result = [];
    const now = new Date();
    for (let i = -6; i <= 5; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      result.push({
        year: d.getFullYear(),
        month: d.getMonth(),
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
        fullLabel: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
        isCurrent: i === 0,
        isFuture: i > 0,
      });
    }
    return result;
  }, []);

  // Calculate actual costs per month
  const monthData = useMemo(() => {
    return months.map(m => {
      const dates = getMonthDates(m.year, m.month);
      let total = 0, agency = 0, base = 0, ot = 0, bh = 0;

      dates.forEach(date => {
        const staffForDay = getStaffForDay(data.staff, date, data.overrides, data.config);
        const cost = calculateDayCost(staffForDay, data.config);
        total += cost.total;
        agency += cost.agency;
        base += cost.base;
        ot += cost.otPremium;
        bh += cost.bhPremium;
      });

      const budget = budgetOverrides[m.key] || defaultBudget;
      const agencyCap = defaultAgencyCap;
      const variance = budget > 0 ? total - budget : 0;
      const variancePct = budget > 0 ? (variance / budget) * 100 : 0;
      const agencyVariance = agencyCap > 0 ? agency - agencyCap : 0;

      return {
        ...m,
        actual: total,
        agency,
        base,
        ot,
        bh,
        budget,
        agencyCap,
        variance,
        variancePct,
        agencyVariance,
        days: dates.length,
      };
    });
  }, [months, data, defaultBudget, defaultAgencyCap, budgetOverrides]);

  // YTD calculations (Jan to current month of current year)
  const ytd = useMemo(() => {
    const now = new Date();
    const yearMonths = monthData.filter(m => m.year === now.getFullYear() && m.month <= now.getMonth());
    const actualYTD = yearMonths.reduce((s, m) => s + m.actual, 0);
    const budgetYTD = yearMonths.reduce((s, m) => s + m.budget, 0);
    const agencyYTD = yearMonths.reduce((s, m) => s + m.agency, 0);
    return { actual: actualYTD, budget: budgetYTD, agency: agencyYTD, variance: actualYTD - budgetYTD, months: yearMonths.length };
  }, [monthData]);

  // Forecast: project remaining year based on trailing 3-month avg
  const forecast = useMemo(() => {
    const now = new Date();
    const recent = monthData.filter(m => !m.isFuture && m.actual > 0).slice(-3);
    if (recent.length === 0) return null;
    const avgMonthly = recent.reduce((s, m) => s + m.actual, 0) / recent.length;
    const remainingMonths = 12 - (now.getMonth() + 1);
    const projected = ytd.actual + (avgMonthly * remainingMonths);
    const annualBudget = defaultBudget * 12;
    return { avgMonthly, projected, annualBudget, remaining: remainingMonths };
  }, [monthData, ytd, defaultBudget]);

  // SVG chart
  const chartW = 700;
  const chartH = 200;
  const maxVal = Math.max(...monthData.map(m => Math.max(m.actual, m.budget)), 1);
  const barW = (chartW / months.length) - 8;

  function saveBudgetOverride(monthKey) {
    const val = parseFloat(budgetInput);
    if (isNaN(val) || val <= 0) return;
    const newOverrides = { ...budgetOverrides, [monthKey]: val };
    updateData({
      ...data,
      config: { ...data.config, budget_overrides: newOverrides },
    });
    setEditingBudget(null);
  }

  function saveDefaultBudget() {
    const total = parseFloat(budgetInput) || 0;
    const agCap = parseFloat(agencyCapInput) || 0;
    updateData({
      ...data,
      config: { ...data.config, monthly_staff_budget: total, monthly_agency_cap: agCap },
    });
    setEditingBudget(null);
  }

  return (
    <div className="p-6">
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{data.config.home_name} — Budget vs Actual</h1>
        <p className="text-xs text-gray-500">12-month rolling view | Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Budget vs Actual</h1>
          <p className="text-sm text-gray-500">12-month rolling view — staffing cost tracking</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => {
            setEditingBudget('default');
            setBudgetInput(String(defaultBudget || ''));
            setAgencyCapInput(String(defaultAgencyCap || ''));
          }} className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700">
            Set Budget
          </button>
          <button onClick={() => window.print()}
            className="border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-1.5 rounded text-sm">Print</button>
        </div>
      </div>

      {/* Budget Setting Modal */}
      {editingBudget === 'default' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 print:hidden">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-gray-900 mb-4">Set Monthly Budget</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Total Staff Budget (£/month)</label>
                <input type="number" value={budgetInput} onChange={e => setBudgetInput(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g. 50000" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Agency Cap (£/month)</label>
                <input type="number" value={agencyCapInput} onChange={e => setAgencyCapInput(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g. 5000" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveDefaultBudget} className="flex-1 bg-blue-600 text-white py-2 rounded text-sm hover:bg-blue-700">Save</button>
              <button onClick={() => setEditingBudget(null)} className="flex-1 border py-2 rounded text-sm hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {defaultBudget > 0 ? (
          <>
            <div className="rounded-lg p-3 bg-blue-50 border border-blue-200">
              <div className="text-xs font-medium text-blue-600">Monthly Budget</div>
              <div className="text-2xl font-bold text-blue-700 mt-0.5">£{Math.round(defaultBudget).toLocaleString()}</div>
              <div className="text-[10px] text-blue-500">per month target</div>
            </div>
            <div className={`rounded-lg p-3 ${ytd.variance > 0 ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
              <div className={`text-xs font-medium ${ytd.variance > 0 ? 'text-red-600' : 'text-green-600'}`}>YTD Variance</div>
              <div className={`text-2xl font-bold mt-0.5 ${ytd.variance > 0 ? 'text-red-700' : 'text-green-700'}`}>
                £{Math.round(Math.abs(ytd.variance)).toLocaleString()}
              </div>
              <div className={`text-[10px] ${ytd.variance > 0 ? 'text-red-500' : 'text-green-500'}`}>
                {ytd.variance > 0 ? 'over budget' : 'under budget'} ({ytd.months} months)
              </div>
            </div>
            <div className="rounded-lg p-3 bg-purple-50 border border-purple-200">
              <div className="text-xs font-medium text-purple-600">Annual Forecast</div>
              <div className="text-2xl font-bold text-purple-700 mt-0.5">£{forecast ? Math.round(forecast.projected).toLocaleString() : '-'}</div>
              <div className="text-[10px] text-purple-500">
                {forecast ? `based on trailing 3-month avg` : 'no data yet'}
              </div>
            </div>
            <div className={`rounded-lg p-3 ${defaultAgencyCap > 0 && ytd.agency > defaultAgencyCap * ytd.months ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
              <div className="text-xs font-medium text-amber-600">Agency YTD</div>
              <div className="text-2xl font-bold text-amber-700 mt-0.5">£{Math.round(ytd.agency).toLocaleString()}</div>
              <div className="text-[10px] text-amber-500">
                {defaultAgencyCap > 0 ? `cap: £${(defaultAgencyCap * ytd.months).toLocaleString()} YTD` : 'no cap set'}
              </div>
            </div>
          </>
        ) : (
          <div className="col-span-full bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
            <div className="text-amber-700 font-medium">No budget set</div>
            <p className="text-amber-600 text-sm mt-1">Click "Set Budget" above to set monthly targets and start tracking variance</p>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="bg-white rounded-lg shadow p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase mb-4">Monthly Comparison</h2>
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${chartW} ${chartH + 50}`} className="w-full min-w-[500px]">
            {/* Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map(pct => {
              const y = chartH - pct * chartH;
              const val = Math.round(pct * maxVal);
              return (
                <g key={pct}>
                  <line x1={30} y1={y} x2={chartW} y2={y} stroke="#e5e7eb" strokeWidth={1} />
                  <text x={28} y={y + 3} fill="#9ca3af" fontSize={8} textAnchor="end">£{(val / 1000).toFixed(0)}k</text>
                </g>
              );
            })}

            {/* Budget line */}
            {defaultBudget > 0 && (
              <line x1={30} y1={chartH - (defaultBudget / maxVal) * chartH}
                x2={chartW} y2={chartH - (defaultBudget / maxVal) * chartH}
                stroke="#ef4444" strokeWidth={1.5} strokeDasharray="6 3" />
            )}

            {/* Bars */}
            {monthData.map((m, i) => {
              const x = 34 + i * ((chartW - 34) / months.length);
              const actualH = maxVal > 0 ? (m.actual / maxVal) * chartH : 0;
              const agencyH = maxVal > 0 ? (m.agency / maxVal) * chartH : 0;
              const yActual = chartH - actualH;

              return (
                <g key={m.key}>
                  {/* Actual bar */}
                  <rect x={x} y={yActual} width={barW} height={actualH} rx={3}
                    fill={m.variance > 0 ? '#fca5a5' : '#93c5fd'} opacity={m.isFuture ? 0.4 : 0.85} />
                  {/* Agency portion */}
                  {m.agency > 0 && (
                    <rect x={x} y={chartH - agencyH} width={barW} height={agencyH} rx={0}
                      fill="#ef4444" opacity={m.isFuture ? 0.3 : 0.6} />
                  )}
                  {/* Value label */}
                  {m.actual > 0 && (
                    <text x={x + barW / 2} y={yActual - 3} textAnchor="middle" fill="#374151" fontSize={8} fontWeight="bold">
                      £{(m.actual / 1000).toFixed(1)}k
                    </text>
                  )}
                  {/* Month label */}
                  <text x={x + barW / 2} y={chartH + 12} textAnchor="middle" fill="#6b7280" fontSize={8}
                    fontWeight={m.isCurrent ? 'bold' : 'normal'}>{m.label}</text>
                  {/* Current month indicator */}
                  {m.isCurrent && (
                    <rect x={x - 1} y={chartH + 15} width={barW + 2} height={2} fill="#3b82f6" rx={1} />
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        <div className="flex flex-wrap gap-4 mt-2 text-[10px] text-gray-500">
          <span><span className="inline-block w-3 h-3 rounded bg-blue-300 mr-1 align-middle" /> Under/on budget</span>
          <span><span className="inline-block w-3 h-3 rounded bg-red-300 mr-1 align-middle" /> Over budget</span>
          <span><span className="inline-block w-3 h-3 rounded bg-red-500 mr-1 align-middle opacity-60" /> Agency portion</span>
          {defaultBudget > 0 && <span className="text-red-500">- - - Budget line</span>}
        </div>
      </div>

      {/* Monthly Detail Table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600 uppercase">
            <tr>
              <th className="py-2 px-3 text-left">Month</th>
              <th className="py-2 px-2 text-right">Budget £</th>
              <th className="py-2 px-2 text-right">Actual £</th>
              <th className="py-2 px-2 text-right">Variance £</th>
              <th className="py-2 px-2 text-right">Var %</th>
              <th className="py-2 px-2 text-right">Base £</th>
              <th className="py-2 px-2 text-right">OT £</th>
              <th className="py-2 px-2 text-right">Agency £</th>
              <th className="py-2 px-2 text-right">BH £</th>
              <th className="py-2 px-2 text-center">Status</th>
              <th className="py-2 px-2 text-center print:hidden">Budget</th>
            </tr>
          </thead>
          <tbody>
            {monthData.map(m => (
              <tr key={m.key} className={`border-b ${m.isCurrent ? 'bg-blue-50' : m.isFuture ? 'opacity-60' : 'hover:bg-gray-50'}`}>
                <td className="py-1.5 px-3 font-medium">
                  {m.fullLabel}
                  {m.isCurrent && <span className="ml-1 text-[10px] text-blue-600">(current)</span>}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-gray-500">
                  {m.budget > 0 ? `£${Math.round(m.budget).toLocaleString()}` : '-'}
                </td>
                <td className="py-1.5 px-2 text-right font-mono font-bold">£{Math.round(m.actual).toLocaleString()}</td>
                <td className={`py-1.5 px-2 text-right font-mono ${m.variance > 0 ? 'text-red-600' : m.budget > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                  {m.budget > 0 ? `${m.variance > 0 ? '+' : ''}£${Math.round(m.variance).toLocaleString()}` : '-'}
                </td>
                <td className={`py-1.5 px-2 text-right font-mono text-xs ${m.variancePct > 5 ? 'text-red-600 font-bold' : m.variancePct < -5 ? 'text-green-600' : 'text-gray-500'}`}>
                  {m.budget > 0 ? `${m.variancePct > 0 ? '+' : ''}${m.variancePct.toFixed(1)}%` : '-'}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-gray-500">£{Math.round(m.base).toLocaleString()}</td>
                <td className="py-1.5 px-2 text-right font-mono text-orange-600">{m.ot > 0 ? `£${Math.round(m.ot).toLocaleString()}` : '-'}</td>
                <td className="py-1.5 px-2 text-right font-mono text-red-600">{m.agency > 0 ? `£${Math.round(m.agency).toLocaleString()}` : '-'}</td>
                <td className="py-1.5 px-2 text-right font-mono text-pink-600">{m.bh > 0 ? `£${Math.round(m.bh).toLocaleString()}` : '-'}</td>
                <td className="py-1.5 px-2 text-center">
                  {m.budget > 0 ? (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      m.variancePct > 10 ? 'bg-red-200 text-red-800' :
                      m.variancePct > 0 ? 'bg-amber-200 text-amber-800' :
                      'bg-green-100 text-green-700'
                    }`}>
                      {m.variancePct > 10 ? 'OVER' : m.variancePct > 0 ? 'WARN' : 'OK'}
                    </span>
                  ) : <span className="text-gray-300">-</span>}
                </td>
                <td className="py-1.5 px-2 text-center print:hidden">
                  <button onClick={() => {
                    setEditingBudget(m.key);
                    setBudgetInput(String(m.budget || defaultBudget || ''));
                  }} className="text-blue-500 hover:text-blue-700 text-[10px] underline">edit</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 font-bold border-t-2">
              <td className="py-2 px-3">Total (12 months)</td>
              <td className="py-2 px-2 text-right font-mono">£{Math.round(monthData.reduce((s, m) => s + m.budget, 0)).toLocaleString()}</td>
              <td className="py-2 px-2 text-right font-mono">£{Math.round(monthData.reduce((s, m) => s + m.actual, 0)).toLocaleString()}</td>
              <td className={`py-2 px-2 text-right font-mono ${monthData.reduce((s, m) => s + m.variance, 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                £{Math.round(Math.abs(monthData.reduce((s, m) => s + m.variance, 0))).toLocaleString()}
              </td>
              <td className="py-2 px-2" colSpan={5}></td>
              <td className="py-2 px-2 print:hidden"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Per-month budget edit modal */}
      {editingBudget && editingBudget !== 'default' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 print:hidden">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-gray-900 mb-3">Budget for {editingBudget}</h3>
            <input type="number" value={budgetInput} onChange={e => setBudgetInput(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm mb-3" placeholder="Monthly budget £" />
            <div className="flex gap-2">
              <button onClick={() => saveBudgetOverride(editingBudget)} className="flex-1 bg-blue-600 text-white py-2 rounded text-sm hover:bg-blue-700">Save</button>
              <button onClick={() => {
                // Reset to default
                const newOverrides = { ...budgetOverrides };
                delete newOverrides[editingBudget];
                updateData({ ...data, config: { ...data.config, budget_overrides: newOverrides } });
                setEditingBudget(null);
              }} className="flex-1 border py-2 rounded text-sm hover:bg-gray-50">Use Default</button>
              <button onClick={() => setEditingBudget(null)} className="px-3 border py-2 rounded text-sm hover:bg-gray-50">X</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
