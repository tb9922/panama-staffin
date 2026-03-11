import { useState, useMemo, useEffect } from 'react';
import { getStaffForDay, formatDate, isWorkingShift } from '../lib/rotation.js';
import { calculateDayCost } from '../lib/escalation.js';
import { CARD, TABLE, BTN, BADGE, PAGE } from '../lib/design.js';
import { downloadXLSX } from '../lib/excel.js';
import { getLoggedInUser, getCurrentHome, getSchedulingData } from '../lib/api.js';

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
  const d = new Date(Date.UTC(year, month, 1));
  while (d.getUTCMonth() === month) {
    dates.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

export default function CostTracker() {
  const isAdmin = getLoggedInUser()?.role === 'admin';
  const [schedData, setSchedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [monthOffset, setMonthOffset] = useState(0);

  // Reactive today — updates at midnight so "today" highlighting stays accurate
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const now = new Date();
    const utcTomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const timer = setTimeout(() => setToday(new Date()), utcTomorrow - now.getTime());
    return () => clearTimeout(timer);
  }, [today]);

  useEffect(() => {
    const homeSlug = getCurrentHome();
    if (!homeSlug) return;
    getSchedulingData(homeSlug)
      .then(setSchedData)
      .catch(e => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  if (!isAdmin) {
    return (
      <div className={PAGE.container}>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Cost Tracker</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-700 text-sm">
          Admin access required to view cost data.
        </div>
      </div>
    );
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400 text-sm" role="status">Loading cost data...</div>;
  if (error || !schedData) return <div className="p-6 text-red-600">{error || 'Failed to load scheduling data'}</div>;

  return <CostTrackerInner schedData={schedData} monthOffset={monthOffset} setMonthOffset={setMonthOffset} today={today} />;
}

function CostTrackerInner({ schedData, monthOffset, setMonthOffset, today }) {
  const config = schedData.config;

  const { monthDates, monthLabel } = useMemo(() => {
    const now = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1));
    const dates = getMonthDates(target.getUTCFullYear(), target.getUTCMonth());
    const label = target.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return { monthDates: dates, monthLabel: label };
  }, [monthOffset]);

  const dayData = useMemo(() => {
    let cumulative = 0;
    return monthDates.map((date, i) => {
      const staffForDay = getStaffForDay(schedData.staff, date, schedData.overrides, config);
      const cost = calculateDayCost(staffForDay, config);
      const workingStaff = staffForDay.filter(s => isWorkingShift(s.shift));
      cumulative += cost.total;
      return { date, cost, staffCount: workingStaff.length, cumulative, dayNum: i + 1 };
    });
  }, [schedData, config, monthDates]);

  const totals = useMemo(() => dayData.reduce((acc, d) => ({
    base: acc.base + d.cost.base,
    otPremium: acc.otPremium + d.cost.otPremium,
    agencyDay: acc.agencyDay + d.cost.agencyDay,
    agencyNight: acc.agencyNight + d.cost.agencyNight,
    bhPremium: acc.bhPremium + d.cost.bhPremium,
    sleepIn: acc.sleepIn + (d.cost.sleepIn || 0),
    total: acc.total + d.cost.total,
    agency: acc.agency + d.cost.agency,
  }), { base: 0, otPremium: 0, agencyDay: 0, agencyNight: 0, bhPremium: 0, sleepIn: 0, total: 0, agency: 0 }), [dayData]);

  const days = monthDates.length;
  const monthlyProj = totals.total / days * 30.44;
  const annualProj = totals.total / days * 365;
  const maxCost = Math.max(...dayData.map(d => d.cost.total));
  const agencyPct = totals.total > 0 ? (totals.agency / totals.total) * 100 : 0;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{config.home_name} — Cost Tracker: {monthLabel}</h1>
        <p className="text-xs text-gray-500">{days} days | Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className="flex items-center justify-between mb-6 print:hidden">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Cost Tracker</h1>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setMonthOffset(monthOffset - 1)}
              className={`${BTN.ghost} ${BTN.xs}`}>&larr;</button>
            {monthOffset !== 0 && (
              <button onClick={() => setMonthOffset(0)}
                className="px-2 py-1 text-blue-600 text-xs hover:underline font-medium">Current</button>
            )}
            <button onClick={() => setMonthOffset(monthOffset + 1)}
              className={`${BTN.ghost} ${BTN.xs}`}>&rarr;</button>
          </div>
          <span className="text-sm font-medium text-gray-600">{monthLabel}</span>
          <span className="text-xs text-gray-400">({days} days)</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => {
            const headers = ['Day#', 'Day', 'Date', 'Base £', 'OT Prem £', 'AG Day £', 'AG Night £', 'BH Prem £', 'Total £', 'Cumulative £'];
            const rows = dayData.map(d => [
              d.dayNum,
              d.date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
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
          }} className={BTN.secondary}>Export CSV</button>
          <button onClick={() => {
            const headers = ['Day#', 'Day', 'Date', 'Base £', 'OT Prem £', 'AG Day £', 'AG Night £', 'BH Prem £', 'Total £', 'Cumulative £'];
            const rows = dayData.map(d => [
              d.dayNum,
              d.date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
              formatDate(d.date),
              parseFloat(d.cost.base.toFixed(2)),
              parseFloat(d.cost.otPremium.toFixed(2)),
              parseFloat(d.cost.agencyDay.toFixed(2)),
              parseFloat(d.cost.agencyNight.toFixed(2)),
              parseFloat(d.cost.bhPremium.toFixed(2)),
              parseFloat(d.cost.total.toFixed(2)),
              parseFloat(d.cumulative.toFixed(2)),
            ]);
            downloadXLSX(`costs_${monthLabel.replace(' ', '_')}`, [{ name: 'Daily Costs', headers, rows }]);
          }} className={BTN.secondary}>Export Excel</button>
          <button onClick={() => window.print()} className={BTN.secondary}>Print</button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[
          ['Month Total', `£${Math.round(totals.total).toLocaleString()}`, 'border-l-blue-500 bg-blue-50 text-blue-800'],
          ['Monthly Proj', `£${Math.round(monthlyProj).toLocaleString()}`, 'border-l-emerald-500 bg-emerald-50 text-emerald-800'],
          ['Annual Proj', `£${Math.round(annualProj).toLocaleString()}`, 'border-l-purple-500 bg-purple-50 text-purple-800'],
          ['Agency Total', `£${Math.round(totals.agency).toLocaleString()}`, 'border-l-red-500 bg-red-50 text-red-800'],
          ['Agency %', `${agencyPct.toFixed(1)}%`, agencyPct <= (config.agency_target_pct || 0.05) * 100 ? 'border-l-emerald-500 bg-emerald-50 text-emerald-800' : 'border-l-red-500 bg-red-50 text-red-800'],
        ].map(([label, value, color]) => (
          <div key={label} className={`rounded-xl p-3.5 border-l-4 ${color}`}>
            <div className="text-xs font-medium opacity-70">{label}</div>
            <div className="text-xl font-bold mt-0.5">{value}</div>
          </div>
        ))}
      </div>

      {/* Daily Cost Table */}
      <div className={`${CARD.flush} mb-6`}>
        <table className={TABLE.table}>
          <thead className={TABLE.thead}>
            <tr>
              <th scope="col" className={TABLE.th}>Day#</th>
              <th scope="col" className={TABLE.th}>Day</th>
              <th scope="col" className={TABLE.th}>Date</th>
              <th scope="col" className={`${TABLE.th} text-right`}>Base £</th>
              <th scope="col" className={`${TABLE.th} text-right`}>OT Prem £</th>
              <th scope="col" className={`${TABLE.th} text-right`}>AG Day £</th>
              <th scope="col" className={`${TABLE.th} text-right`}>AG Night £</th>
              <th scope="col" className={`${TABLE.th} text-right`}>BH Prem £</th>
              <th scope="col" className={`${TABLE.th} text-right font-bold`}>Total £</th>
              <th scope="col" className={`${TABLE.th} text-right`}>Cumul £</th>
              <th scope="col" className={`${TABLE.th} w-24`}>Bar</th>
            </tr>
          </thead>
          <tbody>
            {dayData.map(d => {
              const isToday = formatDate(d.date) === formatDate(today);
              const pct = maxCost > 0 ? (d.cost.total / maxCost) * 100 : 0;
              return (
                <tr key={d.dayNum} className={`${TABLE.tr} ${isToday ? 'bg-blue-50/70' : ''}`}>
                  <td className={`${TABLE.td} font-mono text-gray-400`}>{d.dayNum}</td>
                  <td className={`${TABLE.td} text-xs`}>{d.date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</td>
                  <td className={`${TABLE.td} text-xs`}>
                    <span className={isToday ? 'font-bold text-blue-700' : ''}>
                      {d.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}
                    </span>
                  </td>
                  <td className={`${TABLE.tdMono} text-right`}>{d.cost.base.toFixed(2)}</td>
                  <td className={`${TABLE.tdMono} text-right text-orange-600`}>{d.cost.otPremium > 0 ? d.cost.otPremium.toFixed(2) : '-'}</td>
                  <td className={`${TABLE.tdMono} text-right text-red-600`}>{d.cost.agencyDay > 0 ? d.cost.agencyDay.toFixed(2) : '-'}</td>
                  <td className={`${TABLE.tdMono} text-right text-red-600`}>{d.cost.agencyNight > 0 ? d.cost.agencyNight.toFixed(2) : '-'}</td>
                  <td className={`${TABLE.tdMono} text-right text-pink-600`}>{d.cost.bhPremium > 0 ? d.cost.bhPremium.toFixed(2) : '-'}</td>
                  <td className={`${TABLE.tdMono} text-right font-bold`}>{d.cost.total.toFixed(2)}</td>
                  <td className={`${TABLE.tdMono} text-right text-gray-400`}>{d.cumulative.toFixed(0)}</td>
                  <td className={TABLE.td}>
                    <div className="w-full bg-gray-100 rounded-full h-2.5">
                      <div className={`h-full rounded-full transition-all duration-300 ${d.cost.agency > 0 ? 'bg-red-400' : 'bg-blue-400'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-bold border-t-2">
              <td className={TABLE.td} colSpan={3}>Month Total ({days} days)</td>
              <td className={`${TABLE.td} text-right`}>£{totals.base.toFixed(2)}</td>
              <td className={`${TABLE.td} text-right text-orange-600`}>£{totals.otPremium.toFixed(2)}</td>
              <td className={`${TABLE.td} text-right text-red-600`}>£{totals.agencyDay.toFixed(2)}</td>
              <td className={`${TABLE.td} text-right text-red-600`}>£{totals.agencyNight.toFixed(2)}</td>
              <td className={`${TABLE.td} text-right text-pink-600`}>£{totals.bhPremium.toFixed(2)}</td>
              <td className={`${TABLE.td} text-right`}>£{totals.total.toFixed(2)}</td>
              <td className={TABLE.td} colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={CARD.padded}>
          <h3 className="font-semibold text-gray-800 mb-3">Cost Breakdown</h3>
          {[
            ['Base Staff', totals.base, 'bg-blue-400'],
            ['OT Premium', totals.otPremium, 'bg-orange-400'],
            ['Agency Day', totals.agencyDay, 'bg-red-400'],
            ['Agency Night', totals.agencyNight, 'bg-red-600'],
            ['BH Premium', totals.bhPremium, 'bg-pink-400'],
            ...(totals.sleepIn > 0 ? [['Sleep-in', totals.sleepIn, 'bg-purple-400']] : []),
          ].map(([label, value, color]) => {
            const pct = totals.total > 0 ? (value / totals.total) * 100 : 0;
            return (
              <div key={label} className="mb-2.5">
                <div className="flex justify-between text-xs"><span>{label}</span><span className="font-medium">£{value.toFixed(0)} ({pct.toFixed(1)}%)</span></div>
                <div className="w-full bg-gray-100 rounded-full h-2 mt-1"><div className={`h-full rounded-full transition-all duration-300 ${color}`} style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </div>
        <div className={CARD.padded}>
          <h3 className="font-semibold text-gray-800 mb-3">Daily Average</h3>
          <div className="text-3xl font-bold">£{Math.round(totals.total / days).toLocaleString()}</div>
          <div className="text-sm text-gray-500 mt-1">per day</div>
          <div className="mt-4 space-y-1 text-sm text-gray-600">
            <div>Highest: £{Math.round(maxCost).toLocaleString()}</div>
            <div>Lowest: £{Math.round(Math.min(...dayData.map(d => d.cost.total))).toLocaleString()}</div>
          </div>
        </div>
        <div className={CARD.padded}>
          <h3 className="font-semibold text-gray-800 mb-3">Agency Impact</h3>
          <div className="text-3xl font-bold text-red-600">£{Math.round(totals.agency).toLocaleString()}</div>
          <div className="text-sm text-gray-500 mt-1">agency spend this month</div>
          <div className="mt-4 space-y-1 text-sm">
            <div className="text-gray-600">Target: {((config.agency_target_pct || 0.05) * 100).toFixed(0)}% max</div>
            <div className={`font-medium ${agencyPct > (config.agency_target_pct || 0.05) * 100 ? 'text-red-600' : 'text-green-600'}`}>
              Actual: {agencyPct.toFixed(1)}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
