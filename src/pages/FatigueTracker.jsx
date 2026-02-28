import { useMemo, useState, useEffect } from 'react';
import {
  getCycleDates, getStaffForDay, formatDate, getActualShift,
  isWorkingShift, isCareRole, SHIFT_COLORS,
} from '../lib/rotation.js';
import { checkFatigueRisk } from '../lib/escalation.js';
import { CARD, TABLE, BTN } from '../lib/design.js';
import { downloadXLSX } from '../lib/excel.js';

export default function FatigueTracker({ data }) {
  // Reactive today — updates at midnight so fatigue data is never stale
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const timer = setTimeout(() => setToday(new Date()), tomorrow - now);
    return () => clearTimeout(timer);
  }, [today]);

  const cycleDates = useMemo(() => getCycleDates(data.config.cycle_start_date, today, 28), [data.config.cycle_start_date, today]);

  const activeStaff = useMemo(() => data.staff.filter(s => s.active !== false && isCareRole(s.role)), [data.staff]);
  const maxConsec = data.config.max_consecutive_days;

  // Calculate fatigue data for each staff member
  const fatigueData = useMemo(() => {
    return activeStaff.map(s => {
      const fatigue = checkFatigueRisk(s, today, data.overrides, data.config);

      // Build working pattern for the 28-day cycle
      const pattern = cycleDates.map(date => {
        const actual = getActualShift(s, date, data.overrides, data.config.cycle_start_date);
        return { date, shift: actual.shift, working: isWorkingShift(actual.shift) };
      });

      // Count consecutive blocks
      let maxBlock = 0;
      let currentBlock = 0;
      pattern.forEach(p => {
        if (p.working) {
          currentBlock++;
          maxBlock = Math.max(maxBlock, currentBlock);
        } else {
          currentBlock = 0;
        }
      });

      const totalWorking = pattern.filter(p => p.working).length;
      const totalOff = pattern.filter(p => !p.working).length;

      return {
        ...s,
        fatigue,
        pattern,
        maxBlock,
        totalWorking,
        totalOff,
        avgWeeklyShifts: totalWorking / 4,
      };
    }).sort((a, b) => b.fatigue.consecutive - a.fatigue.consecutive);
  }, [activeStaff, cycleDates, data.overrides, data.config, today]);

  const exceeded = fatigueData.filter(s => s.fatigue.exceeded);
  const atRisk = fatigueData.filter(s => s.fatigue.atRisk && !s.fatigue.exceeded);

  const todayIdx = useMemo(() => {
    const todayStr = formatDate(today);
    return cycleDates.findIndex(d => formatDate(d) === todayStr);
  }, [cycleDates]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{data.config.home_name} — Fatigue Tracker</h1>
        <p className="text-xs text-gray-500">Max consecutive days: {maxConsec} | {activeStaff.length} staff | Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className="flex items-center justify-between mb-2 print:hidden">
        <h1 className="text-2xl font-bold text-gray-900">Fatigue Tracker</h1>
        <div className="flex gap-2">
          <button onClick={() => {
            const headers = ['Staff', 'Team', 'Role', 'Current Consec Days', 'Max Block (28d)', 'Status', 'Total Working', 'Total Off', 'Avg Shifts/wk'];
            const rows = fatigueData.map(s => [
              s.name, s.team, s.role,
              s.fatigue.consecutive,
              s.maxBlock,
              s.fatigue.exceeded ? 'BREACH' : s.fatigue.atRisk ? 'RISK' : 'OK',
              s.totalWorking,
              s.totalOff,
              parseFloat(s.avgWeeklyShifts.toFixed(1)),
            ]);
            downloadXLSX(`fatigue_${data.config.home_name}`, [{ name: 'Fatigue Tracker', headers, rows }]);
          }} className={BTN.secondary}>Export Excel</button>
          <button onClick={() => window.print()} className={BTN.secondary}>Print</button>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-6 print:hidden">Max consecutive days: {maxConsec} | Monitoring {activeStaff.length} staff</p>

      {/* Alert Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className={`rounded-xl p-4 ${exceeded.length > 0 ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
          <div className={`text-3xl font-bold ${exceeded.length > 0 ? 'text-red-600' : 'text-green-600'}`}>{exceeded.length}</div>
          <div className="text-sm text-gray-600">Exceeded limit</div>
        </div>
        <div className={`rounded-xl p-4 ${atRisk.length > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
          <div className={`text-3xl font-bold ${atRisk.length > 0 ? 'text-amber-600' : 'text-green-600'}`}>{atRisk.length}</div>
          <div className="text-sm text-gray-600">At risk ({maxConsec}+ days)</div>
        </div>
        <div className="rounded-xl p-4 bg-blue-50 border border-blue-200">
          <div className="text-3xl font-bold text-blue-600">{activeStaff.length - atRisk.length - exceeded.length}</div>
          <div className="text-sm text-gray-600">Safe</div>
        </div>
      </div>

      {/* Fatigue Table with Pattern */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className="text-[11px] border-collapse">
            <thead>
              <tr className="bg-gray-800 text-white">
                <th className="py-2 px-2 text-left sticky left-0 bg-gray-800 z-10 min-w-[130px]">Staff</th>
                <th className="py-2 px-1 text-center min-w-[40px]">Now</th>
                <th className="py-2 px-1 text-center min-w-[40px]">Max</th>
                <th className="py-2 px-1 text-center min-w-[40px]">Status</th>
                {cycleDates.map((d, i) => (
                  <th key={i} className={`py-2 px-0 text-center min-w-[22px] ${i === todayIdx ? 'bg-blue-700' : ''}`}>
                    <div className="text-[8px]">{d.getDate()}</div>
                  </th>
                ))}
                <th className="py-2 px-2 text-center min-w-[50px]">Shifts</th>
                <th className="py-2 px-2 text-center min-w-[50px]">Avg/wk</th>
              </tr>
            </thead>
            <tbody>
              {fatigueData.map(s => (
                <tr key={s.id} className={`${TABLE.tr} ${s.fatigue.exceeded ? 'bg-red-50' : s.fatigue.atRisk ? 'bg-amber-50' : ''}`}>
                  <td className="py-1 px-2 sticky left-0 bg-white z-10 border-r">
                    <div className="font-medium truncate max-w-[120px]">{s.name}</div>
                    <div className="text-[9px] text-gray-400">{s.team}</div>
                  </td>
                  <td className="py-1 px-1 text-center">
                    <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      s.fatigue.exceeded ? 'bg-red-200 text-red-800' :
                      s.fatigue.atRisk ? 'bg-amber-200 text-amber-800' : 'bg-green-100 text-green-700'
                    }`}>{s.fatigue.consecutive}d</span>
                  </td>
                  <td className="py-1 px-1 text-center font-mono">{s.maxBlock}</td>
                  <td className="py-1 px-1 text-center">
                    {s.fatigue.exceeded ? (
                      <span className="text-red-600 font-bold">BREACH</span>
                    ) : s.fatigue.atRisk ? (
                      <span className="text-amber-600 font-bold">RISK</span>
                    ) : (
                      <span className="text-green-600">OK</span>
                    )}
                  </td>
                  {s.pattern.map((p, i) => (
                    <td key={i} className={`py-0.5 px-0 text-center ${i === todayIdx ? 'ring-1 ring-blue-400' : ''}`}>
                      <div className={`w-5 h-5 mx-auto rounded-sm text-[8px] flex items-center justify-center ${
                        p.working ? (
                          p.shift === 'N' ? 'bg-purple-200 text-purple-800' :
                          p.shift.startsWith('OC') ? 'bg-orange-200 text-orange-800' :
                          p.shift.startsWith('AG') ? 'bg-red-200 text-red-800' :
                          'bg-green-200 text-green-800'
                        ) : (
                          p.shift === 'SICK' ? 'bg-red-100 text-red-600' :
                          p.shift === 'AL' ? 'bg-yellow-100 text-yellow-600' :
                          'bg-gray-100 text-gray-300'
                        )
                      }`}>
                        {p.working ? (p.shift === 'N' ? 'N' : 'W') : (p.shift === 'SICK' ? 'S' : p.shift === 'AL' ? 'A' : '-')}
                      </div>
                    </td>
                  ))}
                  <td className={TABLE.tdMono + ' text-center'}>{s.totalWorking}/28</td>
                  <td className={TABLE.tdMono + ' text-center'}>{s.avgWeeklyShifts.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-4 text-[10px] text-gray-600">
        <span><span className="inline-block w-4 h-4 rounded-sm bg-green-200 mr-1 align-middle" /> Day shift</span>
        <span><span className="inline-block w-4 h-4 rounded-sm bg-purple-200 mr-1 align-middle" /> Night</span>
        <span><span className="inline-block w-4 h-4 rounded-sm bg-orange-200 mr-1 align-middle" /> OT/On-Call</span>
        <span><span className="inline-block w-4 h-4 rounded-sm bg-red-200 mr-1 align-middle" /> Agency</span>
        <span><span className="inline-block w-4 h-4 rounded-sm bg-gray-100 mr-1 align-middle" /> Off</span>
        <span><span className="inline-block w-4 h-4 rounded-sm bg-red-100 mr-1 align-middle" /> Sick</span>
        <span><span className="inline-block w-4 h-4 rounded-sm bg-yellow-100 mr-1 align-middle" /> AL</span>
      </div>
    </div>
  );
}
