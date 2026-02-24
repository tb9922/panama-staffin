import { useState, useMemo } from 'react';
import { getStaffForDay, formatDate, isWorkingShift } from '../lib/rotation.js';
import { calculateDayCost } from '../lib/escalation.js';

function downloadCSV(filename, headers, rows) {
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function getMonthDates(year, month) {
  const dates = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

export default function CostTracker({ data }) {
  const [monthOffset, setMonthOffset] = useState(0);

  const { monthDates, monthLabel } = useMemo(() => {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const dates = getMonthDates(target.getFullYear(), target.getMonth());
    const label = target.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    return { monthDates: dates, monthLabel: label };
  }, [monthOffset]);

  const dayData = useMemo(() => {
    let cumulative = 0;
    return monthDates.map((date, i) => {
      const staffForDay = getStaffForDay(data.staff, date, data.overrides, data.config);
      const cost = calculateDayCost(staffForDay, data.config);
      const workingStaff = staffForDay.filter(s => isWorkingShift(s.shift));
      cumulative += cost.total;
      return { date, cost, staffCount: workingStaff.length, cumulative, dayNum: i + 1 };
    });
  }, [data, monthDates]);

  const totals = useMemo(() => dayData.reduce((acc, d) => ({
    base: acc.base + d.cost.base,
    otPremium: acc.otPremium + d.cost.otPremium,
    agencyDay: acc.agencyDay + d.cost.agencyDay,
    agencyNight: acc.agencyNight + d.cost.agencyNight,
    bhPremium: acc.bhPremium + d.cost.bhPremium,
    total: acc.total + d.cost.total,
    agency: acc.agency + d.cost.agency,
  }), { base: 0, otPremium: 0, agencyDay: 0, agencyNight: 0, bhPremium: 0, total: 0, agency: 0 }), [dayData]);

  const days = monthDates.length;
  const monthlyProj = totals.total / days * 30.44;
  const annualProj = totals.total / days * 365;
  const maxCost = Math.max(...dayData.map(d => d.cost.total));
  const agencyPct = totals.total > 0 ? (totals.agency / totals.total) * 100 : 0;

  return (
    <div className="p-6">
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{data.config.home_name} — Cost Tracker: {monthLabel}</h1>
        <p className="text-xs text-gray-500">{days} days | Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className="flex items-center justify-between mb-6 print:hidden">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Cost Tracker</h1>
          <div className="flex items-center gap-1">
            <button onClick={() => setMonthOffset(monthOffset - 1)}
              className="px-2 py-1 bg-gray-200 rounded hover:bg-gray-300 text-xs">&larr;</button>
            {monthOffset !== 0 && (
              <button onClick={() => setMonthOffset(0)}
                className="px-2 py-1 text-blue-600 text-xs hover:underline">Current</button>
            )}
            <button onClick={() => setMonthOffset(monthOffset + 1)}
              className="px-2 py-1 bg-gray-200 rounded hover:bg-gray-300 text-xs">&rarr;</button>
          </div>
          <span className="text-sm font-medium text-gray-600">{monthLabel}</span>
          <span className="text-xs text-gray-400">({days} days)</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => {
            const headers = ['Day#', 'Day', 'Date', 'Base £', 'OT Prem £', 'AG Day £', 'AG Night £', 'BH Prem £', 'Total £', 'Cumulative £'];
            const rows = dayData.map(d => [
              d.dayNum,
              d.date.toLocaleDateString('en-GB', { weekday: 'short' }),
              formatDate(d.date),
              d.cost.base.toFixed(2),
              d.cost.otPremium.toFixed(2),
              d.cost.agencyDay.toFixed(2),
              d.cost.agencyNight.toFixed(2),
              d.cost.bhPremium.toFixed(2),
              d.cost.total.toFixed(2),
              d.cumulative.toFixed(2),
            ]);
            downloadCSV(`costs_${monthLabel.replace(' ', '_')}.csv`, headers, rows);
          }} className="border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-1.5 rounded text-sm">Export CSV</button>
          <button onClick={() => window.print()}
            className="border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-1.5 rounded text-sm">Print</button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[
          ['Month Total', `£${Math.round(totals.total).toLocaleString()}`, 'bg-blue-50 text-blue-800'],
          ['Monthly Proj', `£${Math.round(monthlyProj).toLocaleString()}`, 'bg-green-50 text-green-800'],
          ['Annual Proj', `£${Math.round(annualProj).toLocaleString()}`, 'bg-purple-50 text-purple-800'],
          ['Agency Total', `£${Math.round(totals.agency).toLocaleString()}`, 'bg-red-50 text-red-800'],
          ['Agency %', `${agencyPct.toFixed(1)}%`, agencyPct <= (data.config.agency_target_pct || 0.05) * 100 ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'],
        ].map(([label, value, color]) => (
          <div key={label} className={`rounded-lg p-3 ${color}`}>
            <div className="text-xs font-medium opacity-70">{label}</div>
            <div className="text-xl font-bold mt-0.5">{value}</div>
          </div>
        ))}
      </div>

      {/* Daily Cost Table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="py-2 px-2 text-left">Day#</th>
              <th className="py-2 px-2 text-left">Day</th>
              <th className="py-2 px-2 text-left">Date</th>
              <th className="py-2 px-2 text-right">Base £</th>
              <th className="py-2 px-2 text-right">OT Prem £</th>
              <th className="py-2 px-2 text-right">AG Day £</th>
              <th className="py-2 px-2 text-right">AG Night £</th>
              <th className="py-2 px-2 text-right">BH Prem £</th>
              <th className="py-2 px-2 text-right font-bold">Total £</th>
              <th className="py-2 px-2 text-right">Cumul £</th>
              <th className="py-2 px-2 text-left w-24">Bar</th>
            </tr>
          </thead>
          <tbody>
            {dayData.map(d => {
              const isToday = formatDate(d.date) === formatDate(new Date());
              const pct = maxCost > 0 ? (d.cost.total / maxCost) * 100 : 0;
              return (
                <tr key={d.dayNum} className={`border-b ${isToday ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                  <td className="py-1.5 px-2 font-mono text-gray-400">{d.dayNum}</td>
                  <td className="py-1.5 px-2 text-xs">{d.date.toLocaleDateString('en-GB', { weekday: 'short' })}</td>
                  <td className="py-1.5 px-2 text-xs">
                    <span className={isToday ? 'font-bold text-blue-700' : ''}>
                      {d.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono">{d.cost.base.toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-orange-600">{d.cost.otPremium > 0 ? d.cost.otPremium.toFixed(2) : '-'}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-red-600">{d.cost.agencyDay > 0 ? d.cost.agencyDay.toFixed(2) : '-'}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-red-600">{d.cost.agencyNight > 0 ? d.cost.agencyNight.toFixed(2) : '-'}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-pink-600">{d.cost.bhPremium > 0 ? d.cost.bhPremium.toFixed(2) : '-'}</td>
                  <td className="py-1.5 px-2 text-right font-mono font-bold">{d.cost.total.toFixed(2)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-gray-400">{d.cumulative.toFixed(0)}</td>
                  <td className="py-1.5 px-2">
                    <div className="w-full bg-gray-100 rounded h-3">
                      <div className={`h-full rounded ${d.cost.agency > 0 ? 'bg-red-400' : 'bg-blue-400'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 font-bold border-t-2">
              <td className="py-2 px-2" colSpan={3}>Month Total ({days} days)</td>
              <td className="py-2 px-2 text-right">£{totals.base.toFixed(2)}</td>
              <td className="py-2 px-2 text-right text-orange-600">£{totals.otPremium.toFixed(2)}</td>
              <td className="py-2 px-2 text-right text-red-600">£{totals.agencyDay.toFixed(2)}</td>
              <td className="py-2 px-2 text-right text-red-600">£{totals.agencyNight.toFixed(2)}</td>
              <td className="py-2 px-2 text-right text-pink-600">£{totals.bhPremium.toFixed(2)}</td>
              <td className="py-2 px-2 text-right">£{totals.total.toFixed(2)}</td>
              <td className="py-2 px-2" colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold text-gray-800 mb-3">Cost Breakdown</h3>
          {[
            ['Base Staff', totals.base, 'bg-blue-400'],
            ['OT Premium', totals.otPremium, 'bg-orange-400'],
            ['Agency Day', totals.agencyDay, 'bg-red-400'],
            ['Agency Night', totals.agencyNight, 'bg-red-600'],
            ['BH Premium', totals.bhPremium, 'bg-pink-400'],
          ].map(([label, value, color]) => {
            const pct = totals.total > 0 ? (value / totals.total) * 100 : 0;
            return (
              <div key={label} className="mb-2">
                <div className="flex justify-between text-xs"><span>{label}</span><span>£{value.toFixed(0)} ({pct.toFixed(1)}%)</span></div>
                <div className="w-full bg-gray-100 rounded h-2 mt-0.5"><div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold text-gray-800 mb-3">Daily Average</h3>
          <div className="text-3xl font-bold">£{Math.round(totals.total / days).toLocaleString()}</div>
          <div className="text-sm text-gray-500 mt-1">per day</div>
          <div className="mt-4 text-sm text-gray-600">
            <div>Highest: £{Math.round(maxCost).toLocaleString()}</div>
            <div>Lowest: £{Math.round(Math.min(...dayData.map(d => d.cost.total))).toLocaleString()}</div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold text-gray-800 mb-3">Agency Impact</h3>
          <div className="text-3xl font-bold text-red-600">£{Math.round(totals.agency).toLocaleString()}</div>
          <div className="text-sm text-gray-500 mt-1">agency spend this month</div>
          <div className="mt-4 text-sm">
            <div className="text-gray-600">Target: {((data.config.agency_target_pct || 0.05) * 100).toFixed(0)}% max</div>
            <div className={`font-medium ${agencyPct > (data.config.agency_target_pct || 0.05) * 100 ? 'text-red-600' : 'text-green-600'}`}>
              Actual: {agencyPct.toFixed(1)}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
