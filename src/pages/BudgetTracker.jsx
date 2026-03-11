import { useState, useMemo, useEffect } from 'react';
import { getStaffForDay } from '../lib/rotation.js';
import { calculateDayCost } from '../lib/escalation.js';
import { CARD, TABLE, INPUT, BTN, BADGE, MODAL } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import { downloadXLSX } from '../lib/excel.js';
import { getCurrentHome, getSchedulingData, saveConfig, getLoggedInUser } from '../lib/api.js';

function getMonthDates(year, month) {
  const dates = [];
  const d = new Date(Date.UTC(year, month, 1));
  while (d.getUTCMonth() === month) {
    dates.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

export default function BudgetTracker() {
  const [schedData, setSchedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingBudget, setEditingBudget] = useState(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [agencyCapInput, setAgencyCapInput] = useState('');

  useEffect(() => {
    const homeSlug = getCurrentHome();
    if (!homeSlug) return;
    // BudgetTracker shows 6 months back + 5 months forward — request a wider override window
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 6, 0)).toISOString().slice(0, 10);
    getSchedulingData(homeSlug, { from, to })
      .then(setSchedData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400 text-sm" role="status">Loading budget data...</div>;
  if (error) return <div className="p-6 text-red-600" role="alert">Error: {error}</div>;
  if (!schedData) return null;

  return <BudgetTrackerInner schedData={schedData} setSchedData={setSchedData} editingBudget={editingBudget} setEditingBudget={setEditingBudget} budgetInput={budgetInput} setBudgetInput={setBudgetInput} agencyCapInput={agencyCapInput} setAgencyCapInput={setAgencyCapInput} />;
}

function BudgetTrackerInner({ schedData, setSchedData, editingBudget, setEditingBudget, budgetInput, setBudgetInput, agencyCapInput, setAgencyCapInput }) {
  const isAdmin = getLoggedInUser()?.role === 'admin';
  const config = schedData.config;
  const defaultBudget = config.monthly_staff_budget || 0;
  const defaultAgencyCap = config.monthly_agency_cap || 0;
  const budgetOverrides = useMemo(() => config.budget_overrides || {}, [config.budget_overrides]);

  // 12-month rolling view: 6 months back, current, 5 months forward
  const months = useMemo(() => {
    const result = [];
    const now = new Date();
    for (let i = -6; i <= 5; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      result.push({
        year: d.getUTCFullYear(),
        month: d.getUTCMonth(),
        key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
        fullLabel: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
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
        const staffForDay = getStaffForDay(schedData.staff, date, schedData.overrides, config);
        const cost = calculateDayCost(staffForDay, config);
        total += cost.total;
        agency += cost.agency;
        base += cost.base;
        ot += cost.otPremium;
        bh += cost.bhPremium;
      });

      const budget = budgetOverrides[m.key] ?? defaultBudget;
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
  }, [months, schedData, config, defaultBudget, defaultAgencyCap, budgetOverrides]);

  // YTD calculations (Jan to current month of current year)
  const ytd = useMemo(() => {
    const now = new Date();
    const yearMonths = monthData.filter(m => m.year === now.getUTCFullYear() && m.month <= now.getUTCMonth());
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
    const remainingMonths = 12 - (now.getUTCMonth() + 1);
    const projected = ytd.actual + (avgMonthly * remainingMonths);
    const annualBudget = defaultBudget * 12;
    return { avgMonthly, projected, annualBudget, remaining: remainingMonths };
  }, [monthData, ytd, defaultBudget]);

  async function patchConfig(patch) {
    const newConfig = { ...config, ...patch };
    try {
      await saveConfig(getCurrentHome(), newConfig);
      setSchedData(prev => ({ ...prev, config: newConfig }));
    } catch (e) {
      alert(`Save failed: ${e.message}`);
    }
  }

  async function saveBudgetOverride(monthKey) {
    const val = parseFloat(budgetInput);
    if (isNaN(val) || val < 0) return;
    await patchConfig({ budget_overrides: { ...budgetOverrides, [monthKey]: val } });
    setEditingBudget(null);
  }

  async function saveDefaultBudget() {
    const total = parseFloat(budgetInput) || 0;
    const agCap = parseFloat(agencyCapInput) || 0;
    await patchConfig({ monthly_staff_budget: total, monthly_agency_cap: agCap });
    setEditingBudget(null);
  }

  // SVG chart
  const chartW = 700;
  const chartH = 200;
  const maxVal = Math.max(...monthData.map(m => Math.max(m.actual, m.budget)), 1);
  const barW = (chartW / months.length) - 8;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{config.home_name} — Budget vs Actual</h1>
        <p className="text-xs text-gray-500">12-month rolling view | Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Budget vs Actual</h1>
          <p className="text-sm text-gray-500">12-month rolling view — staffing cost tracking</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && <button onClick={() => {
            setEditingBudget('default');
            setBudgetInput(String(defaultBudget || ''));
            setAgencyCapInput(String(defaultAgencyCap || ''));
          }} className={BTN.primary}>
            Set Budget
          </button>}
          <button onClick={() => {
            const headers = ['Month', 'Budget £', 'Actual £', 'Variance £', 'Var %', 'Base £', 'OT £', 'Agency £', 'BH £'];
            const rows = monthData.map(m => [
              m.fullLabel,
              m.budget > 0 ? Math.round(m.budget) : '',
              Math.round(m.actual),
              m.budget > 0 ? Math.round(m.variance) : '',
              m.budget > 0 ? parseFloat(m.variancePct.toFixed(1)) : '',
              Math.round(m.base),
              Math.round(m.ot),
              Math.round(m.agency),
              Math.round(m.bh),
            ]);
            downloadXLSX(`budget_${config.home_name}`, [{ name: 'Budget vs Actual', headers, rows }]);
          }} className={BTN.secondary}>Export Excel</button>
          <button onClick={() => window.print()}
            className={BTN.secondary}>Print</button>
        </div>
      </div>

      {/* Budget Setting Modal */}
      <Modal isOpen={editingBudget === 'default'} onClose={() => setEditingBudget(null)} title="Set Monthly Budget" size="sm">
            <div className="space-y-3">
              <div>
                <label className={INPUT.label}>Total Staff Budget (£/month)</label>
                <input type="number" value={budgetInput} onChange={e => setBudgetInput(e.target.value)}
                  className={INPUT.base} placeholder="e.g. 50000" />
              </div>
              <div>
                <label className={INPUT.label}>Agency Cap (£/month)</label>
                <input type="number" value={agencyCapInput} onChange={e => setAgencyCapInput(e.target.value)}
                  className={INPUT.base} placeholder="e.g. 5000" />
              </div>
            </div>
            <div className={MODAL.footer}>
              <button onClick={() => setEditingBudget(null)} className={BTN.secondary}>Cancel</button>
              <button onClick={saveDefaultBudget} className={BTN.primary}>Save</button>
            </div>
      </Modal>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {defaultBudget > 0 ? (
          <>
            <div className="rounded-xl p-3 bg-blue-50 border border-blue-200">
              <div className="text-xs font-medium text-blue-600">Monthly Budget</div>
              <div className="text-2xl font-bold text-blue-700 mt-0.5">£{Math.round(defaultBudget).toLocaleString()}</div>
              <div className="text-[10px] text-blue-500">per month target</div>
            </div>
            <div className={`rounded-xl p-3 ${ytd.variance > 0 ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
              <div className={`text-xs font-medium ${ytd.variance > 0 ? 'text-red-600' : 'text-green-600'}`}>YTD Variance</div>
              <div className={`text-2xl font-bold mt-0.5 ${ytd.variance > 0 ? 'text-red-700' : 'text-green-700'}`}>
                £{Math.round(Math.abs(ytd.variance)).toLocaleString()}
              </div>
              <div className={`text-[10px] ${ytd.variance > 0 ? 'text-red-500' : 'text-green-500'}`}>
                {ytd.variance > 0 ? 'over budget' : 'under budget'} ({ytd.months} months)
              </div>
            </div>
            <div className="rounded-xl p-3 bg-purple-50 border border-purple-200">
              <div className="text-xs font-medium text-purple-600">Annual Forecast</div>
              <div className="text-2xl font-bold text-purple-700 mt-0.5">£{forecast ? Math.round(forecast.projected).toLocaleString() : '-'}</div>
              <div className="text-[10px] text-purple-500">
                {forecast ? `based on trailing 3-month avg` : 'no data yet'}
              </div>
            </div>
            <div className={`rounded-xl p-3 ${defaultAgencyCap > 0 && ytd.agency > defaultAgencyCap * ytd.months ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
              <div className="text-xs font-medium text-amber-600">Agency YTD</div>
              <div className="text-2xl font-bold text-amber-700 mt-0.5">£{Math.round(ytd.agency).toLocaleString()}</div>
              <div className="text-[10px] text-amber-500">
                {defaultAgencyCap > 0 ? `cap: £${(defaultAgencyCap * ytd.months).toLocaleString()} YTD` : 'no cap set'}
              </div>
            </div>
          </>
        ) : (
          <div className="col-span-full bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
            <div className="text-amber-700 font-medium">No budget set</div>
            <p className="text-amber-600 text-sm mt-1">Click "Set Budget" above to set monthly targets and start tracking variance</p>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className={`${CARD.padded} mb-6`}>
        <h2 className="text-sm font-semibold text-gray-500 uppercase mb-4">Monthly Comparison</h2>
        <div className={TABLE.wrapper}>
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
          <span><span className="inline-block w-3 h-3 rounded-full bg-blue-300 mr-1 align-middle" /> Under/on budget</span>
          <span><span className="inline-block w-3 h-3 rounded-full bg-red-300 mr-1 align-middle" /> Over budget</span>
          <span><span className="inline-block w-3 h-3 rounded-full bg-red-500 mr-1 align-middle opacity-60" /> Agency portion</span>
          {defaultBudget > 0 && <span className="text-red-500">- - - Budget line</span>}
        </div>
      </div>

      {/* Monthly Detail Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Month</th>
                <th scope="col" className={`${TABLE.th} text-right`}>Budget £</th>
                <th scope="col" className={`${TABLE.th} text-right`}>Actual £</th>
                <th scope="col" className={`${TABLE.th} text-right`}>Variance £</th>
                <th scope="col" className={`${TABLE.th} text-right`}>Var %</th>
                <th scope="col" className={`${TABLE.th} text-right`}>Base £</th>
                <th scope="col" className={`${TABLE.th} text-right`}>OT £</th>
                <th scope="col" className={`${TABLE.th} text-right`}>Agency £</th>
                <th scope="col" className={`${TABLE.th} text-right`}>BH £</th>
                <th scope="col" className={`${TABLE.th} text-center`}>Status</th>
                {isAdmin && <th scope="col" className={`${TABLE.th} text-center print:hidden`}>Budget</th>}
              </tr>
            </thead>
            <tbody>
              {monthData.map(m => (
                <tr key={m.key} className={`${TABLE.tr} ${m.isCurrent ? 'bg-blue-50' : m.isFuture ? 'opacity-60' : ''}`}>
                  <td className={`${TABLE.td} font-medium`}>
                    {m.fullLabel}
                    {m.isCurrent && <span className="ml-1 text-[10px] text-blue-600">(current)</span>}
                  </td>
                  <td className={`${TABLE.tdMono} text-right text-gray-500`}>
                    {m.budget > 0 ? `£${Math.round(m.budget).toLocaleString()}` : '-'}
                  </td>
                  <td className={`${TABLE.tdMono} text-right font-bold`}>£{Math.round(m.actual).toLocaleString()}</td>
                  <td className={`${TABLE.tdMono} text-right ${m.variance > 0 ? 'text-red-600' : m.budget > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                    {m.budget > 0 ? `${m.variance > 0 ? '+' : ''}£${Math.round(m.variance).toLocaleString()}` : '-'}
                  </td>
                  <td className={`${TABLE.tdMono} text-right text-xs ${m.variancePct > 5 ? 'text-red-600 font-bold' : m.variancePct < -5 ? 'text-green-600' : 'text-gray-500'}`}>
                    {m.budget > 0 ? `${m.variancePct > 0 ? '+' : ''}${m.variancePct.toFixed(1)}%` : '-'}
                  </td>
                  <td className={`${TABLE.tdMono} text-right text-gray-500`}>£{Math.round(m.base).toLocaleString()}</td>
                  <td className={`${TABLE.tdMono} text-right text-orange-600`}>{m.ot > 0 ? `£${Math.round(m.ot).toLocaleString()}` : '-'}</td>
                  <td className={`${TABLE.tdMono} text-right text-red-600`}>{m.agency > 0 ? `£${Math.round(m.agency).toLocaleString()}` : '-'}</td>
                  <td className={`${TABLE.tdMono} text-right text-pink-600`}>{m.bh > 0 ? `£${Math.round(m.bh).toLocaleString()}` : '-'}</td>
                  <td className={`${TABLE.td} text-center`}>
                    {m.budget > 0 ? (
                      <span className={
                        m.variancePct > 10 ? BADGE.red :
                        m.variancePct > 0 ? BADGE.amber :
                        BADGE.green
                      }>
                        {m.variancePct > 10 ? 'OVER' : m.variancePct > 0 ? 'WARN' : 'OK'}
                      </span>
                    ) : <span className="text-gray-300">-</span>}
                  </td>
                  {isAdmin && <td className={`${TABLE.td} text-center print:hidden`}>
                    <button onClick={() => {
                      setEditingBudget(m.key);
                      setBudgetInput(String(m.budget || defaultBudget || ''));
                    }} className="text-blue-500 hover:text-blue-700 text-[10px] underline transition-colors duration-150">edit</button>
                  </td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 font-bold border-t-2">
                <td className={TABLE.td}>Total (12 months)</td>
                <td className={`${TABLE.tdMono} text-right`}>£{Math.round(monthData.reduce((s, m) => s + m.budget, 0)).toLocaleString()}</td>
                <td className={`${TABLE.tdMono} text-right`}>£{Math.round(monthData.reduce((s, m) => s + m.actual, 0)).toLocaleString()}</td>
                <td className={`${TABLE.tdMono} text-right ${monthData.reduce((s, m) => s + m.variance, 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  £{Math.round(Math.abs(monthData.reduce((s, m) => s + m.variance, 0))).toLocaleString()}
                </td>
                <td className={TABLE.td} colSpan={6}></td>
                {isAdmin && <td className={`${TABLE.td} print:hidden`}></td>}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Per-month budget edit modal */}
      <Modal isOpen={!!editingBudget && editingBudget !== 'default'} onClose={() => setEditingBudget(null)} title={`Budget for ${editingBudget || ''}`} size="sm">
            <input type="number" value={budgetInput} onChange={e => setBudgetInput(e.target.value)}
              className={`${INPUT.base} mb-3`} placeholder="Monthly budget £" />
            <div className={MODAL.footer}>
              <button onClick={() => setEditingBudget(null)} className={BTN.ghost}>X</button>
              <button onClick={() => {
                // Reset to default
                const newOverrides = { ...budgetOverrides };
                delete newOverrides[editingBudget];
                patchConfig({ budget_overrides: newOverrides });
                setEditingBudget(null);
              }} className={BTN.secondary}>Use Default</button>
              <button onClick={() => saveBudgetOverride(editingBudget)} className={BTN.primary}>Save</button>
            </div>
      </Modal>
    </div>
  );
}
