import { useMemo, useState } from 'react';
import { formatDate, isCareRole, getActualShift, parseDate } from '../lib/rotation.js';

function getMonthRange(monthsBack) {
  const months = [];
  const now = new Date();
  for (let i = monthsBack - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    months.push({
      label: start.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      fullLabel: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      start,
      end,
      dates: getDatesInRange(start, end),
    });
  }
  return months;
}

function getDatesInRange(start, end) {
  const dates = [];
  const d = new Date(start);
  while (d <= end) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

export default function SickTrends({ data }) {
  const MONTHS_BACK = 6;
  const months = useMemo(() => getMonthRange(MONTHS_BACK), []);
  const activeStaff = data.staff.filter(s => s.active !== false && isCareRole(s.role));
  const [filterStaff, setFilterStaff] = useState('All');
  const [filterMonth, setFilterMonth] = useState('All');

  // Calculate sick days per staff per month
  const sickData = useMemo(() => {
    return activeStaff.map(s => {
      const monthCounts = months.map(m => {
        let sickDays = 0;
        m.dates.forEach(date => {
          const actual = getActualShift(s, date, data.overrides, data.config.cycle_start_date);
          if (actual.shift === 'SICK') sickDays++;
        });
        return sickDays;
      });
      const total = monthCounts.reduce((a, b) => a + b, 0);
      // Trend: compare last 3 months avg vs first 3 months avg
      const firstHalf = monthCounts.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
      const secondHalf = monthCounts.slice(3).reduce((a, b) => a + b, 0) / 3;
      const trend = secondHalf > firstHalf + 0.5 ? 'worsening' : secondHalf < firstHalf - 0.5 ? 'improving' : 'stable';
      return { ...s, monthCounts, total, trend };
    }).sort((a, b) => b.total - a.total);
  }, [activeStaff, months, data]);

  // Totals per month
  const monthTotals = useMemo(() => {
    return months.map((_, mi) => sickData.reduce((sum, s) => sum + s.monthCounts[mi], 0));
  }, [sickData, months]);

  // Build detailed sick log — every individual sick day with exact date and who was sick
  const sickLog = useMemo(() => {
    const log = [];
    activeStaff.forEach(s => {
      months.forEach(m => {
        m.dates.forEach(date => {
          const actual = getActualShift(s, date, data.overrides, data.config.cycle_start_date);
          if (actual.shift === 'SICK') {
            log.push({
              date: formatDate(date),
              dateObj: date,
              staffId: s.id,
              staffName: s.name,
              team: s.team,
              role: s.role,
              reason: actual.reason || '',
              dayOfWeek: date.toLocaleDateString('en-GB', { weekday: 'short' }),
            });
          }
        });
      });
    });
    log.sort((a, b) => b.date.localeCompare(a.date)); // most recent first
    return log;
  }, [activeStaff, months, data]);

  // Filtered sick log
  const filteredLog = useMemo(() => {
    return sickLog.filter(entry => {
      if (filterStaff !== 'All' && entry.staffId !== filterStaff) return false;
      if (filterMonth !== 'All') {
        const entryMonth = entry.date.slice(0, 7); // YYYY-MM
        if (entryMonth !== filterMonth) return false;
      }
      return true;
    });
  }, [sickLog, filterStaff, filterMonth]);

  // Unique months for filter dropdown
  const uniqueMonths = useMemo(() => {
    const set = new Set(sickLog.map(e => e.date.slice(0, 7)));
    return [...set].sort().reverse();
  }, [sickLog]);

  const maxMonthTotal = Math.max(...monthTotals, 1);
  const grandTotal = monthTotals.reduce((a, b) => a + b, 0);
  const avgPerMonth = grandTotal / MONTHS_BACK;
  const staffWithSick = sickData.filter(s => s.total > 0);
  const topOffenders = sickData.filter(s => s.total >= 3);

  // SVG chart dimensions
  const chartW = 600;
  const chartH = 200;
  const barW = chartW / months.length - 12;
  const barGap = 12;

  const trendIcon = (trend) => {
    if (trend === 'worsening') return { symbol: '^', color: 'text-red-600', bg: 'bg-red-50' };
    if (trend === 'improving') return { symbol: 'v', color: 'text-green-600', bg: 'bg-green-50' };
    return { symbol: '-', color: 'text-gray-500', bg: 'bg-gray-50' };
  };

  return (
    <div className="p-6">
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{data.config.home_name} — Sick Trend Analytics</h1>
        <p className="text-xs text-gray-500">Last {MONTHS_BACK} months | Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sick Trend Analytics</h1>
          <p className="text-sm text-gray-500">Last {MONTHS_BACK} months — {activeStaff.length} staff monitored</p>
        </div>
        <button onClick={() => window.print()}
          className="border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-1.5 rounded text-sm">Print</button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="rounded-lg p-3 bg-red-50 border border-red-200">
          <div className="text-xs font-medium text-red-600">Total Sick Days</div>
          <div className="text-2xl font-bold text-red-700 mt-0.5">{grandTotal}</div>
          <div className="text-[10px] text-red-500">last {MONTHS_BACK} months</div>
        </div>
        <div className="rounded-lg p-3 bg-amber-50 border border-amber-200">
          <div className="text-xs font-medium text-amber-600">Avg / Month</div>
          <div className="text-2xl font-bold text-amber-700 mt-0.5">{avgPerMonth.toFixed(1)}</div>
          <div className="text-[10px] text-amber-500">sick days</div>
        </div>
        <div className="rounded-lg p-3 bg-blue-50 border border-blue-200">
          <div className="text-xs font-medium text-blue-600">Staff Affected</div>
          <div className="text-2xl font-bold text-blue-700 mt-0.5">{staffWithSick.length}/{activeStaff.length}</div>
          <div className="text-[10px] text-blue-500">had sick days</div>
        </div>
        <div className={`rounded-lg p-3 ${topOffenders.length > 0 ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
          <div className={`text-xs font-medium ${topOffenders.length > 0 ? 'text-red-600' : 'text-green-600'}`}>High Absence</div>
          <div className={`text-2xl font-bold mt-0.5 ${topOffenders.length > 0 ? 'text-red-700' : 'text-green-700'}`}>{topOffenders.length}</div>
          <div className={`text-[10px] ${topOffenders.length > 0 ? 'text-red-500' : 'text-green-500'}`}>3+ sick days</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Chart */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-4">Monthly Sick Days</h2>
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${chartW} ${chartH + 40}`} className="w-full min-w-[400px]">
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map(pct => {
                const y = chartH - pct * chartH;
                const val = Math.round(pct * maxMonthTotal);
                return (
                  <g key={pct}>
                    <line x1={0} y1={y} x2={chartW} y2={y} stroke="#e5e7eb" strokeWidth={1} />
                    <text x={0} y={y - 4} fill="#9ca3af" fontSize={10}>{val}</text>
                  </g>
                );
              })}

              {/* Bars */}
              {monthTotals.map((count, i) => {
                const x = i * (barW + barGap) + barGap;
                const h = maxMonthTotal > 0 ? (count / maxMonthTotal) * chartH : 0;
                const y = chartH - h;
                // Color based on severity
                const fill = count === 0 ? '#d1fae5' : count <= avgPerMonth ? '#fbbf24' : '#ef4444';
                return (
                  <g key={i}>
                    <rect x={x} y={y} width={barW} height={h} rx={4} fill={fill} opacity={0.85} />
                    {count > 0 && (
                      <text x={x + barW / 2} y={y - 4} textAnchor="middle" fill="#374151" fontSize={12} fontWeight="bold">{count}</text>
                    )}
                    <text x={x + barW / 2} y={chartH + 16} textAnchor="middle" fill="#6b7280" fontSize={10}>{months[i].label}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Top Offenders */}
        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Highest Absence</h2>
          {staffWithSick.length === 0 ? (
            <div className="text-sm text-green-600 font-medium py-4">No sick days recorded</div>
          ) : (
            <div className="space-y-2">
              {staffWithSick.slice(0, 10).map((s, i) => {
                const ti = trendIcon(s.trend);
                return (
                  <div key={s.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-400 w-4 text-right">{i + 1}.</span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{s.name}</div>
                        <div className="text-[10px] text-gray-400">{s.team} — {s.role}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${ti.bg} ${ti.color}`}>{ti.symbol}</span>
                      <span className={`font-bold text-sm ${s.total >= 3 ? 'text-red-600' : 'text-gray-700'}`}>{s.total}d</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Detailed Table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto mt-6">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600 uppercase">
            <tr>
              <th className="py-2 px-3 text-left">Staff</th>
              <th className="py-2 px-3 text-left">Team</th>
              <th className="py-2 px-3 text-left">Role</th>
              {months.map(m => (
                <th key={m.label} className="py-2 px-2 text-center">{m.label}</th>
              ))}
              <th className="py-2 px-3 text-center font-bold">Total</th>
              <th className="py-2 px-3 text-center">Trend</th>
            </tr>
          </thead>
          <tbody>
            {sickData.map(s => {
              const ti = trendIcon(s.trend);
              return (
                <tr key={s.id} className={`border-b hover:bg-gray-50 ${s.total >= 3 ? 'bg-red-50' : ''}`}>
                  <td className="py-1.5 px-3 font-medium">{s.name}</td>
                  <td className="py-1.5 px-3 text-xs text-gray-500">{s.team}</td>
                  <td className="py-1.5 px-3 text-xs text-gray-500">{s.role}</td>
                  {s.monthCounts.map((count, mi) => (
                    <td key={mi} className="py-1.5 px-2 text-center">
                      {count > 0 ? (
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                          count >= 3 ? 'bg-red-200 text-red-800' : count >= 2 ? 'bg-amber-200 text-amber-800' : 'bg-yellow-100 text-yellow-700'
                        }`}>{count}</span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                  ))}
                  <td className="py-1.5 px-3 text-center">
                    <span className={`font-bold ${s.total >= 3 ? 'text-red-600' : s.total > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                      {s.total}
                    </span>
                  </td>
                  <td className="py-1.5 px-3 text-center">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${ti.bg} ${ti.color}`}>{s.trend}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 font-bold border-t-2">
              <td className="py-2 px-3" colSpan={3}>Total</td>
              {monthTotals.map((total, mi) => (
                <td key={mi} className="py-2 px-2 text-center text-red-600">{total}</td>
              ))}
              <td className="py-2 px-3 text-center text-red-600">{grandTotal}</td>
              <td className="py-2 px-3"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Detailed Sick Log — exact dates */}
      <div className="bg-white rounded-lg shadow overflow-x-auto mt-6">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-sm font-semibold text-gray-500 uppercase">Sick Day Log — Exact Dates</h2>
          <div className="flex gap-2">
            <select value={filterStaff} onChange={e => setFilterStaff(e.target.value)} className="border rounded px-2 py-1 text-xs">
              <option value="All">All Staff</option>
              {staffWithSick.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="border rounded px-2 py-1 text-xs">
              <option value="All">All Months</option>
              {uniqueMonths.map(m => {
                const [y, mo] = m.split('-');
                const label = new Date(Number(y), Number(mo) - 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
                return <option key={m} value={m}>{label}</option>;
              })}
            </select>
          </div>
        </div>
        {filteredLog.length === 0 ? (
          <div className="text-sm text-gray-400 p-4 text-center">No sick days recorded{filterStaff !== 'All' || filterMonth !== 'All' ? ' for this filter' : ''}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600 uppercase">
              <tr>
                <th className="py-2 px-3 text-left">Date</th>
                <th className="py-2 px-3 text-left">Day</th>
                <th className="py-2 px-3 text-left">Staff</th>
                <th className="py-2 px-3 text-left">Team</th>
                <th className="py-2 px-3 text-left">Role</th>
                <th className="py-2 px-3 text-left">Reason</th>
              </tr>
            </thead>
            <tbody>
              {filteredLog.map((entry, i) => (
                <tr key={`${entry.date}-${entry.staffId}`} className="border-b hover:bg-gray-50">
                  <td className="py-1.5 px-3 font-mono text-xs">{parseDate(entry.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td className="py-1.5 px-3 text-xs text-gray-500">{entry.dayOfWeek}</td>
                  <td className="py-1.5 px-3 font-medium">{entry.staffName}</td>
                  <td className="py-1.5 px-3 text-xs text-gray-500">{entry.team}</td>
                  <td className="py-1.5 px-3 text-xs text-gray-500">{entry.role}</td>
                  <td className="py-1.5 px-3 text-xs text-gray-500">{entry.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 border-t-2">
                <td className="py-2 px-3 font-bold text-xs" colSpan={2}>Total: {filteredLog.length} sick day{filteredLog.length !== 1 ? 's' : ''}</td>
                <td className="py-2 px-3 text-xs text-gray-500" colSpan={4}>
                  {new Set(filteredLog.map(e => e.staffId)).size} staff member{new Set(filteredLog.map(e => e.staffId)).size !== 1 ? 's' : ''}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-4 text-[10px] text-gray-500">
        <span><span className="inline-block w-3 h-3 rounded bg-red-50 border border-red-200 mr-1 align-middle" /> 3+ sick days (high absence)</span>
        <span>Trend: ^ worsening | v improving | - stable (compares first 3 months vs last 3 months)</span>
      </div>
    </div>
  );
}
