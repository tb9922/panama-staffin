import { useMemo, useState, useEffect, useCallback } from 'react';
import { formatDate, isCareRole, getActualShift, parseDate } from '../lib/rotation.js';
import { CARD, TABLE, INPUT, BTN, BADGE } from '../lib/design.js';
import { downloadXLSX } from '../lib/excel.js';
import { getCurrentHome, getSchedulingData } from '../lib/api.js';
import { endOfLocalMonthISO, startOfLocalMonthISO } from '../lib/localDates.js';
import { useData } from '../contexts/DataContext.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';

function getMonthRange(monthsBack) {
  const months = [];
  const now = new Date();
  for (let i = monthsBack - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0));
    months.push({
      label: start.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
      fullLabel: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
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
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

export default function SickTrends() {
  const { canWrite } = useData();
  const canEdit = canWrite('staff');
  const homeSlug = getCurrentHome();
  const [schedData, setSchedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!homeSlug) {
      setSchedData(null);
      setError(null);
      setLoading(false);
      return;
    }
    // SickTrends shows 6 months back — request wider override window
    const from = startOfLocalMonthISO(new Date(), -6);
    const to = endOfLocalMonthISO(new Date(), 0);
    setLoading(true);
    setError(null);
    try {
      setSchedData(await getSchedulingData(homeSlug, { from, to }));
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [homeSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState message="Loading sick trend data..." className="py-10" />;

  if (!homeSlug) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className={CARD.padded}>
          <EmptyState
            compact
            title="Sick Trend Analytics"
            description="Select a home to review absence patterns."
          />
        </div>
      </div>
    );
  }

  if (error || !schedData) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <ErrorState
          title="Unable to load sick trend analytics"
          message={error || 'Failed to load scheduling data'}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  return <SickTrendsInner schedData={schedData} canEdit={canEdit} />;
}

function SickTrendsInner({ schedData, canEdit }) {
  const config = schedData.config;
  const MONTHS_BACK = 6;
  const months = useMemo(() => getMonthRange(MONTHS_BACK), []);
  const activeStaff = useMemo(() => schedData.staff.filter(s => s.active !== false && isCareRole(s.role)), [schedData.staff]);
  const [filterStaff, setFilterStaff] = useState('All');
  const [filterMonth, setFilterMonth] = useState('All');

  // Anonymise staff names for non-admin viewers
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const staffLabel = useMemo(() => {
    if (canEdit) return (s) => s.name;
    const map = new Map();
    activeStaff.forEach((s, i) => map.set(s.id, `Staff Member ${i + 1}`));
    return (s) => map.get(s.id) || `Staff Member`;
  }, [canEdit, activeStaff]);

  // Calculate sick days per staff per month — includes exact dates
  const sickData = useMemo(() => {
    return activeStaff.map(s => {
      const monthDetails = months.map(m => {
        const sickDates = [];
        m.dates.forEach(date => {
          const actual = getActualShift(s, date, schedData.overrides, config.cycle_start_date);
          if (actual.shift === 'SICK') {
            sickDates.push({
              date: formatDate(date),
              day: date.getUTCDate(),
              dayOfWeek: date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
              reason: actual.reason || '',
            });
          }
        });
        return { count: sickDates.length, dates: sickDates };
      });
      const monthCounts = monthDetails.map(d => d.count);
      const total = monthCounts.reduce((a, b) => a + b, 0);
      const firstHalf = monthCounts.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
      const secondHalf = monthCounts.slice(3).reduce((a, b) => a + b, 0) / 3;
      const trend = secondHalf > firstHalf + 0.5 ? 'worsening' : secondHalf < firstHalf - 0.5 ? 'improving' : 'stable';
      return { ...s, monthCounts, monthDetails, total, trend };
    }).sort((a, b) => b.total - a.total);
  }, [activeStaff, months, schedData.overrides, config.cycle_start_date]);

  // Totals per month
  const monthTotals = useMemo(() => {
    return months.map((_, mi) => sickData.reduce((sum, s) => sum + s.monthCounts[mi], 0));
  }, [sickData, months]);

  // Derive sick log from sickData — avoids duplicate getActualShift iteration
  const sickLog = useMemo(() => {
    const log = [];
    sickData.forEach(s => {
      s.monthDetails.forEach(md => {
        md.dates.forEach(d => {
          log.push({
            date: d.date,
            dateObj: parseDate(d.date),
            staffId: s.id,
            staffName: s.name,
            team: s.team,
            role: s.role,
            reason: d.reason,
            dayOfWeek: d.dayOfWeek,
          });
        });
      });
    });
    log.sort((a, b) => b.date.localeCompare(a.date));
    return log;
  }, [sickData]);

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
    <div className="p-6 max-w-7xl mx-auto">
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{config.home_name} — Sick Trend Analytics</h1>
        <p className="text-xs text-gray-500">Last {MONTHS_BACK} months | Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sick Trend Analytics</h1>
          <p className="text-sm text-gray-500">Last {MONTHS_BACK} months — {activeStaff.length} staff monitored</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => {
            const summaryHeaders = ['Staff', 'Team', 'Role', ...months.map(m => m.fullLabel), 'Total', 'Trend'];
            const summaryRows = sickData.map(s => [
              staffLabel(s), s.team, s.role, ...s.monthCounts, s.total, s.trend,
            ]);
            const logHeaders = ['Date', 'Day', 'Staff', 'Team', 'Role', 'Reason'];
            const logRows = sickLog.map(e => [
              e.date, e.dayOfWeek, canEdit ? e.staffName : staffLabel({ id: e.staffId }), e.team, e.role, e.reason || '',
            ]);
            downloadXLSX(`sick_trends_${config.home_name}`, [
              { name: 'Monthly Summary', headers: summaryHeaders, rows: summaryRows },
              { name: 'Sick Log', headers: logHeaders, rows: logRows },
            ]);
          }} className={BTN.secondary}>Export Excel</button>
          <button onClick={() => window.print()} className={BTN.secondary}>Print</button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl p-3 bg-red-50 border border-red-200">
          <div className="text-xs font-medium text-red-600">Total Sick Days</div>
          <div className="text-2xl font-bold text-red-700 mt-0.5">{grandTotal}</div>
          <div className="text-[10px] text-red-500">last {MONTHS_BACK} months</div>
        </div>
        <div className="rounded-xl p-3 bg-amber-50 border border-amber-200">
          <div className="text-xs font-medium text-amber-600">Avg / Month</div>
          <div className="text-2xl font-bold text-amber-700 mt-0.5">{avgPerMonth.toFixed(1)}</div>
          <div className="text-[10px] text-amber-500">sick days</div>
        </div>
        <div className="rounded-xl p-3 bg-blue-50 border border-blue-200">
          <div className="text-xs font-medium text-blue-600">Staff Affected</div>
          <div className="text-2xl font-bold text-blue-700 mt-0.5">{staffWithSick.length}/{activeStaff.length}</div>
          <div className="text-[10px] text-blue-500">had sick days</div>
        </div>
        <div className={`rounded-xl p-3 ${topOffenders.length > 0 ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
          <div className={`text-xs font-medium ${topOffenders.length > 0 ? 'text-red-600' : 'text-green-600'}`}>High Absence</div>
          <div className={`text-2xl font-bold mt-0.5 ${topOffenders.length > 0 ? 'text-red-700' : 'text-green-700'}`}>{topOffenders.length}</div>
          <div className={`text-[10px] ${topOffenders.length > 0 ? 'text-red-500' : 'text-green-500'}`}>3+ sick days</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Chart */}
        <div className={`lg:col-span-2 ${CARD.padded}`}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-4">Monthly Sick Days</h2>
          <div className={TABLE.wrapper}>
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
        <div className={CARD.padded}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Highest Absence</h2>
          {staffWithSick.length === 0 ? (
            <EmptyState
              compact
              title="No sick days recorded"
              description="Sickness trends will appear here once absence overrides are recorded."
            />
          ) : (
            <div className="space-y-2">
              {staffWithSick.slice(0, 10).map((s, i) => {
                const ti = trendIcon(s.trend);
                return (
                  <div key={s.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-400 w-4 text-right">{i + 1}.</span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{staffLabel(s)}</div>
                        <div className="text-[10px] text-gray-400">{s.team} — {s.role}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`${BADGE.gray} ${ti.bg} ${ti.color}`}>{ti.symbol}</span>
                      <span className={`font-bold text-sm ${s.total >= 3 ? 'text-red-600' : 'text-gray-700'}`}>{s.total}d</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Detailed Table — shows exact sick dates in each cell */}
      <div className={`${CARD.flush} mt-6`}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Staff</th>
                <th scope="col" className={TABLE.th}>Team</th>
                <th scope="col" className={TABLE.th}>Role</th>
                {months.map(m => (
                  <th scope="col" key={m.label} className={`${TABLE.th} text-center`}>{m.label}</th>
                ))}
                <th scope="col" className={`${TABLE.th} text-center font-bold`}>Total</th>
                <th scope="col" className={`${TABLE.th} text-center`}>Trend</th>
              </tr>
            </thead>
            <tbody>
              {sickData.map(s => {
                const ti = trendIcon(s.trend);
                return (
                  <tr key={s.id} className={`${TABLE.tr} ${s.total >= 3 ? 'bg-red-50' : ''}`}>
                    <td className={`${TABLE.td} font-medium`}>{staffLabel(s)}</td>
                    <td className={`${TABLE.td} text-xs text-gray-500`}>{s.team}</td>
                    <td className={`${TABLE.td} text-xs text-gray-500`}>{s.role}</td>
                    {s.monthDetails.map((md, mi) => (
                      <td key={mi} className={`${TABLE.td} text-center align-top`}>
                        {md.count > 0 ? (
                          <div>
                            <span className={`inline-block px-1.5 py-0.5 rounded-full text-xs font-medium mb-1 ${
                              md.count >= 3 ? 'bg-red-200 text-red-800' : md.count >= 2 ? 'bg-amber-200 text-amber-800' : 'bg-yellow-100 text-yellow-700'
                            }`}>{md.count}</span>
                            <div className="space-y-0.5">
                              {md.dates.map(d => (
                                <div key={d.date} className="text-[10px] text-gray-500" title={d.reason || 'Sick'}>
                                  {d.dayOfWeek} {d.day}{d.reason ? ` — ${d.reason}` : ''}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                    ))}
                    <td className={`${TABLE.td} text-center`}>
                      <span className={`font-bold ${s.total >= 3 ? 'text-red-600' : s.total > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                        {s.total}
                      </span>
                    </td>
                    <td className={`${TABLE.td} text-center`}>
                      <span className={`${BADGE.gray} ${ti.bg} ${ti.color}`}>{s.trend}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 font-bold border-t-2">
                <td className={TABLE.td} colSpan={3}>Total</td>
                {monthTotals.map((total, mi) => (
                  <td key={mi} className={`${TABLE.td} text-center text-red-600`}>{total}</td>
                ))}
                <td className={`${TABLE.td} text-center text-red-600`}>{grandTotal}</td>
                <td className={TABLE.td}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Detailed Sick Log — exact dates */}
      <div className={`${CARD.flush} mt-6`}>
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-sm font-semibold text-gray-500 uppercase">Sick Day Log — Exact Dates</h2>
          <div className="flex gap-2">
            <select value={filterStaff} onChange={e => setFilterStaff(e.target.value)} className={`${INPUT.sm} w-auto`}>
              <option value="All">All Staff</option>
              {staffWithSick.map(s => <option key={s.id} value={s.id}>{staffLabel(s)}</option>)}
            </select>
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className={`${INPUT.sm} w-auto`}>
              <option value="All">All Months</option>
              {uniqueMonths.map(m => {
                const [y, mo] = m.split('-');
                const label = new Date(Date.UTC(Number(y), Number(mo) - 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
                return <option key={m} value={m}>{label}</option>;
              })}
            </select>
          </div>
        </div>
        {filteredLog.length === 0 ? (
          <div className={TABLE.empty}>
            <EmptyState
              compact
              title={`No sick days recorded${filterStaff !== 'All' || filterMonth !== 'All' ? ' for this filter' : ''}`}
              description="Adjust the staff or month filters to widen the results."
            />
          </div>
        ) : (
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Date</th>
                <th scope="col" className={TABLE.th}>Day</th>
                <th scope="col" className={TABLE.th}>Staff</th>
                <th scope="col" className={TABLE.th}>Team</th>
                <th scope="col" className={TABLE.th}>Role</th>
                <th scope="col" className={TABLE.th}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {filteredLog.map((entry, _i) => (
                <tr key={`${entry.date}-${entry.staffId}`} className={TABLE.tr}>
                  <td className={TABLE.tdMono}>{parseDate(entry.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</td>
                  <td className={`${TABLE.td} text-xs text-gray-500`}>{entry.dayOfWeek}</td>
                  <td className={`${TABLE.td} font-medium`}>{canEdit ? entry.staffName : (staffLabel({ id: entry.staffId }))}</td>
                  <td className={`${TABLE.td} text-xs text-gray-500`}>{entry.team}</td>
                  <td className={`${TABLE.td} text-xs text-gray-500`}>{entry.role}</td>
                  <td className={`${TABLE.td} text-xs text-gray-500`}>{entry.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 border-t-2">
                <td className={`${TABLE.td} font-bold text-xs`} colSpan={2}>Total: {filteredLog.length} sick day{filteredLog.length !== 1 ? 's' : ''}</td>
                <td className={`${TABLE.td} text-xs text-gray-500`} colSpan={4}>
                  {new Set(filteredLog.map(e => e.staffId)).size} staff member{new Set(filteredLog.map(e => e.staffId)).size !== 1 ? 's' : ''}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-4 text-[10px] text-gray-500">
        <span><span className="inline-block w-3 h-3 rounded-full bg-red-50 border border-red-200 mr-1 align-middle" /> 3+ sick days (high absence)</span>
        <span>Trend: ^ worsening | v improving | - stable (compares first 3 months vs last 3 months)</span>
      </div>
    </div>
  );
}
