import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCycleDates, getStaffForDay, formatDate, isWorkingShift, isCareRole } from '../lib/rotation.js';
import { getDayCoverageStatus, calculateDayCost, checkFatigueRisk } from '../lib/escalation.js';

export default function Dashboard({ data }) {
  const navigate = useNavigate();
  const today = new Date();

  const cycleDates = useMemo(() => getCycleDates(data.config.cycle_start_date, today, 28), [data.config.cycle_start_date]);

  const cycleData = useMemo(() => {
    return cycleDates.map(date => {
      const staffForDay = getStaffForDay(data.staff, date, data.overrides, data.config);
      const coverage = getDayCoverageStatus(staffForDay, data.config);
      const cost = calculateDayCost(staffForDay, data.config);
      return { date, staffForDay, coverage, cost };
    });
  }, [data, cycleDates]);

  const todayIdx = useMemo(() => {
    const todayStr = formatDate(today);
    return cycleData.findIndex(d => formatDate(d.date) === todayStr);
  }, [cycleData]);

  const todayData = todayIdx >= 0 ? cycleData[todayIdx] : cycleData[0];
  const todayStaff = todayData.staffForDay;
  const onDuty = todayStaff.filter(s => isWorkingShift(s.shift));
  const sick = todayStaff.filter(s => s.shift === 'SICK');
  const al = todayStaff.filter(s => s.shift === 'AL');
  const agencyToday = todayStaff.filter(s => s.shift?.startsWith('AG-'));
  const floatDeployed = todayStaff.filter(s => s.team === 'Float' && isWorkingShift(s.shift) && s.shift !== 'AVL');

  const cycleCost = useMemo(() => cycleData.reduce((s, d) => s + d.cost.total, 0), [cycleData]);
  const monthlyProj = cycleCost / 28 * 30.44;
  const annualProj = cycleCost / 28 * 365;
  const agencyTotal = cycleData.reduce((s, d) => s + d.cost.agency, 0);
  const agencyPct = cycleCost > 0 ? (agencyTotal / cycleCost) * 100 : 0;

  // Alerts
  const alerts = useMemo(() => {
    const list = [];
    cycleData.forEach(d => {
      const dateLabel = d.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      ['early', 'late', 'night'].forEach(period => {
        const esc = d.coverage[period]?.escalation;
        if (!esc) return;
        if (esc.level >= 4) list.push({ type: 'error', msg: `${dateLabel}: ${period} — ${esc.status}` });
        else if (esc.level >= 3) list.push({ type: 'warning', msg: `${dateLabel}: ${period} — ${esc.status}` });
      });
    });

    data.staff.filter(s => s.active !== false && isCareRole(s.role)).forEach(s => {
      const fatigue = checkFatigueRisk(s, today, data.overrides, data.config);
      if (fatigue.exceeded) {
        list.push({ type: 'error', msg: `${s.name}: ${fatigue.consecutive} consecutive days (max ${data.config.max_consecutive_days})` });
      } else if (fatigue.atRisk) {
        list.push({ type: 'warning', msg: `${s.name}: ${fatigue.consecutive} consecutive days — at limit` });
      }
    });

    return list.slice(0, 12);
  }, [cycleData, data]);

  const heatmapColor = { green: 'bg-green-500', amber: 'bg-amber-500', yellow: 'bg-yellow-400', red: 'bg-red-500' };

  // Coverage gauge helper
  const CoverageGauge = ({ period, cov }) => {
    if (!cov) return null;
    const headPct = cov.coverage.required.heads > 0
      ? Math.min((cov.coverage.headCount / cov.coverage.required.heads) * 100, 100) : 100;
    const skillPct = cov.coverage.required.skill_points > 0
      ? Math.min((cov.coverage.skillPoints / cov.coverage.required.skill_points) * 100, 100) : 100;
    const escColors = { green: 'text-green-600 bg-green-50 border-green-200', amber: 'text-amber-600 bg-amber-50 border-amber-200', yellow: 'text-yellow-600 bg-yellow-50 border-yellow-200', red: 'text-red-600 bg-red-50 border-red-200' };
    const barColor = { green: 'bg-green-500', amber: 'bg-amber-500', yellow: 'bg-yellow-400', red: 'bg-red-500' };
    return (
      <div className={`border rounded-lg p-3 ${escColors[cov.escalation.color] || 'border-gray-200'}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold capitalize">{period}</span>
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${escColors[cov.escalation.color]}`}>
            {cov.escalation.label}
          </span>
        </div>
        <div className="space-y-1.5">
          <div>
            <div className="flex justify-between text-xs text-gray-600 mb-0.5">
              <span>Heads</span>
              <span className="font-mono font-bold">{cov.coverage.headCount}/{cov.coverage.required.heads}</span>
            </div>
            <div className="w-full bg-gray-200 rounded h-2">
              <div className={`h-full rounded ${barColor[cov.escalation.color] || 'bg-gray-400'}`} style={{ width: `${headPct}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-gray-600 mb-0.5">
              <span>Skill</span>
              <span className="font-mono font-bold">{cov.coverage.skillPoints.toFixed(1)}/{cov.coverage.required.skill_points}</span>
            </div>
            <div className="w-full bg-gray-200 rounded h-2">
              <div className={`h-full rounded ${barColor[cov.escalation.color] || 'bg-gray-400'}`} style={{ width: `${skillPct}%` }} />
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6">
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{data.config.home_name} — Dashboard</h1>
        <p className="text-xs text-gray-500">Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      {/* Header */}
      <div className="bg-gray-900 text-white rounded-lg p-4 mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{data.config.home_name}</h1>
          <p className="text-gray-400 text-sm">{data.config.registered_beds} beds — {data.config.care_type}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold">{today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
          <div className="flex items-center gap-2 justify-end mt-1">
            <span className="text-gray-400 text-xs">Panama rotation</span>
            <button onClick={() => window.print()} className="text-gray-400 hover:text-white text-xs border border-gray-600 rounded px-2 py-0.5 print:hidden">Print</button>
          </div>
        </div>
      </div>

      {/* Today's Coverage Gauges — the main KPI */}
      <div className="bg-white rounded-lg shadow p-5 mb-6 cursor-pointer hover:shadow-lg transition-shadow" onClick={() => navigate(`/day/${formatDate(today)}`)}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase">Today's Coverage — Live Status</h2>
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${
            todayData.coverage.overallLevel <= 1 ? 'bg-green-100 text-green-700' :
            todayData.coverage.overallLevel <= 2 ? 'bg-amber-100 text-amber-700' :
            todayData.coverage.overallLevel <= 3 ? 'bg-yellow-100 text-yellow-700' :
            'bg-red-100 text-red-700'
          }`}>
            {todayData.coverage.overallLevel <= 1 ? 'ALL CLEAR' :
             todayData.coverage.overallLevel <= 2 ? 'MONITOR' :
             todayData.coverage.overallLevel <= 3 ? 'ACTION NEEDED' :
             'CRITICAL'}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <CoverageGauge period="early" cov={todayData.coverage.early} />
          <CoverageGauge period="late" cov={todayData.coverage.late} />
          <CoverageGauge period="night" cov={todayData.coverage.night} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Staffing Summary */}
        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Staffing Summary</h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              ['On Duty', onDuty.length, 'text-green-600'],
              ['Sick', sick.length, sick.length > 0 ? 'text-red-600' : 'text-gray-600'],
              ['Annual Leave', al.length, al.length > 0 ? 'text-yellow-600' : 'text-gray-600'],
              ['Float Deployed', floatDeployed.length, floatDeployed.length > 0 ? 'text-orange-600' : 'text-gray-600'],
              ['Agency', agencyToday.length, agencyToday.length > 0 ? 'text-red-600' : 'text-gray-600'],
              ['Total Staff', data.staff.filter(s => s.active !== false).length, 'text-gray-700'],
            ].map(([label, count, color]) => (
              <div key={label} className="border rounded-lg p-2.5 text-center">
                <div className={`text-xl font-bold ${color}`}>{count}</div>
                <div className="text-[10px] text-gray-500">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Cost Summary */}
        <div className="bg-white rounded-lg shadow p-5 cursor-pointer hover:shadow-lg transition-shadow" onClick={() => navigate('/costs')}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Cost Summary (28-day)</h2>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">This cycle:</span>
              <span className="text-lg font-bold">£{Math.round(cycleCost).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Monthly proj:</span>
              <span className="font-medium">£{Math.round(monthlyProj).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Annual proj:</span>
              <span className="font-medium">£{Math.round(annualProj).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Today's cost:</span>
              <span className="font-medium">£{todayData.cost.total.toFixed(0)}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-gray-600">Agency %:</span>
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${agencyPct <= (data.config.agency_target_pct || 0.05) * 100 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {agencyPct.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* 28-Day Heatmap */}
        <div className="bg-white rounded-lg shadow p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">28-Day Coverage Heatmap</h2>
          <div className="flex gap-1 flex-wrap">
            {cycleData.map((d, i) => {
              const isToday = i === todayIdx;
              const dateStr = formatDate(d.date);
              return (
                <button key={i} onClick={() => navigate(`/day/${dateStr}`)}
                  className={`flex flex-col items-center p-1 rounded transition-all hover:scale-105 ${isToday ? 'ring-2 ring-blue-500' : ''}`}
                  title={`${d.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`}>
                  <div className="text-[9px] text-gray-400">D{i + 1}</div>
                  <div className={`w-7 h-7 rounded ${heatmapColor[d.coverage.overall] || 'bg-gray-300'} flex items-center justify-center text-white text-[10px] font-bold`}>
                    {d.date.getDate()}
                  </div>
                  <div className="text-[9px] text-gray-400">{d.date.toLocaleDateString('en-GB', { weekday: 'short' })}</div>
                </button>
              );
            })}
          </div>
          <div className="flex gap-4 mt-3 text-[10px] text-gray-500">
            <span><span className="inline-block w-3 h-3 rounded bg-green-500 mr-1 align-middle" /> Covered</span>
            <span><span className="inline-block w-3 h-3 rounded bg-amber-500 mr-1 align-middle" /> Float/OT</span>
            <span><span className="inline-block w-3 h-3 rounded bg-yellow-400 mr-1 align-middle" /> Agency</span>
            <span><span className="inline-block w-3 h-3 rounded bg-red-500 mr-1 align-middle" /> Short/Unsafe</span>
          </div>
        </div>

        {/* Alerts */}
        <div className="bg-white rounded-lg shadow p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Alerts</h2>
          {alerts.length === 0 ? (
            <div className="text-sm text-green-600 font-medium">All clear — full coverage this cycle</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {alerts.map((alert, i) => (
                <div key={i} className={`flex items-start gap-2 text-xs px-2.5 py-1.5 rounded ${
                  alert.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                }`}>
                  <span className="flex-shrink-0 mt-0.5">{alert.type === 'error' ? '!' : '~'}</span>
                  <span>{alert.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
