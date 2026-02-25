import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCycleDates, getStaffForDay, formatDate, isWorkingShift, isCareRole } from '../lib/rotation.js';
import { getDayCoverageStatus, calculateDayCost, checkFatigueRisk } from '../lib/escalation.js';
import { calculateAccrual } from '../lib/accrual.js';
import { getTrainingTypes, getTrainingAlerts, buildComplianceMatrix, getComplianceStats, getSupervisionAlerts, getAppraisalAlerts, getFireDrillAlerts } from '../lib/training.js';
import { getIncidentAlerts } from '../lib/incidents.js';
import { CARD, BADGE, ESC_COLORS, HEATMAP } from '../lib/design.js';

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

    // NMW compliance check
    const nlwRate = data.config.nlw_rate || 12.21;
    data.staff.filter(s => s.active !== false && isCareRole(s.role)).forEach(s => {
      if (s.hourly_rate != null && s.hourly_rate < nlwRate) {
        list.push({ type: 'error', msg: `${s.name}: £${s.hourly_rate.toFixed(2)}/hr is below NLW £${nlwRate.toFixed(2)}` });
      }
    });

    // AL accrual overbooked check
    data.staff.filter(s => s.active !== false && isCareRole(s.role)).forEach(s => {
      const acc = calculateAccrual(s, data.config, data.overrides, today);
      if (acc.remaining < 0) {
        list.push({ type: 'warning', msg: `${s.name}: ${Math.abs(acc.remaining).toFixed(1)} AL days over earned balance` });
      }
    });

    // Training compliance alerts
    const trainingTypes = getTrainingTypes(data.config);
    const activeStaff = data.staff.filter(s => s.active !== false);
    const trainingAlerts = getTrainingAlerts(activeStaff, trainingTypes, data.training || {}, today);
    trainingAlerts.forEach(a => list.push(a));

    // Incident alerts
    getIncidentAlerts(data.incidents || []).forEach(a => list.push(a));

    // Supervision, appraisal & fire drill alerts
    getSupervisionAlerts(activeStaff, data.config, data.supervisions || {}, today).forEach(a => list.push(a));
    getAppraisalAlerts(activeStaff, data.appraisals || {}, today).forEach(a => list.push(a));
    getFireDrillAlerts(data.fire_drills || [], today).forEach(a => list.push(a));

    return list.slice(0, 16);
  }, [cycleData, data]);

  // Coverage gauge helper
  const CoverageGauge = ({ period, cov }) => {
    if (!cov) return null;
    const headPct = cov.coverage.required.heads > 0
      ? Math.min((cov.coverage.headCount / cov.coverage.required.heads) * 100, 100) : 100;
    const skillPct = cov.coverage.required.skill_points > 0
      ? Math.min((cov.coverage.skillPoints / cov.coverage.required.skill_points) * 100, 100) : 100;
    const esc = ESC_COLORS[cov.escalation.color] || ESC_COLORS.green;
    return (
      <div className={`border rounded-xl p-3.5 ${esc.card}`}>
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-sm font-semibold capitalize">{period}</span>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${esc.badge}`}>
            {cov.escalation.label}
          </span>
        </div>
        <div className="space-y-2">
          <div>
            <div className="flex justify-between text-xs text-gray-600 mb-1">
              <span>Heads</span>
              <span className="font-mono font-bold">{cov.coverage.headCount}/{cov.coverage.required.heads}</span>
            </div>
            <div className="w-full bg-white/60 rounded-full h-2">
              <div className={`h-full rounded-full transition-all duration-300 ${esc.bar}`} style={{ width: `${headPct}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-gray-600 mb-1">
              <span>Skill</span>
              <span className="font-mono font-bold">{cov.coverage.skillPoints.toFixed(1)}/{cov.coverage.required.skill_points}</span>
            </div>
            <div className="w-full bg-white/60 rounded-full h-2">
              <div className={`h-full rounded-full transition-all duration-300 ${esc.bar}`} style={{ width: `${skillPct}%` }} />
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{data.config.home_name} — Dashboard</h1>
        <p className="text-xs text-gray-500">Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white rounded-2xl p-5 mb-6 flex items-center justify-between shadow-lg shadow-blue-900/20">
        <div>
          <h1 className="text-xl font-bold">{data.config.home_name}</h1>
          <p className="text-blue-200 text-sm">{data.config.registered_beds} beds — {data.config.care_type}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold">{today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
          <div className="flex items-center gap-2 justify-end mt-1">
            <span className="text-blue-200 text-xs">Panama rotation</span>
            <button onClick={() => window.print()} className="text-blue-200 hover:text-white text-xs border border-blue-400/50 rounded-lg px-2.5 py-1 print:hidden transition-colors">Print</button>
          </div>
        </div>
      </div>

      {/* Today's Coverage Gauges */}
      <div className={`${CARD.padded} mb-6 cursor-pointer hover:shadow-md transition-shadow`} onClick={() => navigate(`/day/${formatDate(today)}`)}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Today's Coverage — Live Status</h2>
          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
            todayData.coverage.overallLevel <= 1 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
            todayData.coverage.overallLevel <= 2 ? 'bg-amber-50 text-amber-700 border-amber-200' :
            todayData.coverage.overallLevel <= 3 ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
            'bg-red-50 text-red-700 border-red-200'
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
        <div className={CARD.padded}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Staffing Summary</h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              ['On Duty', onDuty.length, 'text-emerald-600', 'border-l-emerald-500'],
              ['Sick', sick.length, sick.length > 0 ? 'text-red-600' : 'text-gray-400', 'border-l-red-500'],
              ['Annual Leave', al.length, al.length > 0 ? 'text-yellow-600' : 'text-gray-400', 'border-l-yellow-500'],
              ['Float Deployed', floatDeployed.length, floatDeployed.length > 0 ? 'text-orange-600' : 'text-gray-400', 'border-l-orange-500'],
              ['Agency', agencyToday.length, agencyToday.length > 0 ? 'text-red-600' : 'text-gray-400', 'border-l-pink-500'],
              ['Total Staff', data.staff.filter(s => s.active !== false).length, 'text-gray-700', 'border-l-blue-500'],
            ].map(([label, count, color, accent]) => (
              <div key={label} className={`border rounded-xl p-3 text-center border-l-4 ${accent}`}>
                <div className={`text-2xl font-bold ${color}`}>{count}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Cost Summary */}
        <div className={`${CARD.padded} cursor-pointer hover:shadow-md transition-shadow`} onClick={() => navigate('/costs')}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Cost Summary (28-day)</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-600 text-sm">This cycle:</span>
              <span className="text-xl font-bold">£{Math.round(cycleCost).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600 text-sm">Monthly proj:</span>
              <span className="font-semibold">£{Math.round(monthlyProj).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600 text-sm">Annual proj:</span>
              <span className="font-semibold">£{Math.round(annualProj).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600 text-sm">Today's cost:</span>
              <span className="font-semibold">£{todayData.cost.total.toFixed(0)}</span>
            </div>
            <div className="flex items-center justify-between pt-3 border-t border-gray-100">
              <span className="text-gray-600 text-sm">Agency %:</span>
              <span className={agencyPct <= (data.config.agency_target_pct || 0.05) * 100 ? BADGE.green : BADGE.red}>
                {agencyPct.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* 28-Day Heatmap */}
        <div className={`${CARD.padded} lg:col-span-2`}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">28-Day Coverage Heatmap</h2>
          <div className="flex gap-1.5 flex-wrap">
            {cycleData.map((d, i) => {
              const isToday = i === todayIdx;
              const dateStr = formatDate(d.date);
              return (
                <button key={i} onClick={() => navigate(`/day/${dateStr}`)}
                  className={`flex flex-col items-center p-1 rounded-lg transition-all hover:scale-105 ${isToday ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
                  title={`${d.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`}>
                  <div className="text-[9px] text-gray-400 mb-0.5">D{i + 1}</div>
                  <div className={`w-8 h-8 rounded-lg ${HEATMAP[d.coverage.overall] || HEATMAP.empty} flex items-center justify-center text-white text-[11px] font-bold shadow-sm`}>
                    {d.date.getDate()}
                  </div>
                  <div className="text-[9px] text-gray-400 mt-0.5">{d.date.toLocaleDateString('en-GB', { weekday: 'short' })}</div>
                </button>
              );
            })}
          </div>
          <div className="flex gap-5 mt-4 text-[10px] text-gray-500">
            <span className="flex items-center gap-1.5"><span className={`inline-block w-3 h-3 rounded ${HEATMAP.green}`} /> Covered</span>
            <span className="flex items-center gap-1.5"><span className={`inline-block w-3 h-3 rounded ${HEATMAP.amber}`} /> Float/OT</span>
            <span className="flex items-center gap-1.5"><span className={`inline-block w-3 h-3 rounded ${HEATMAP.yellow}`} /> Agency</span>
            <span className="flex items-center gap-1.5"><span className={`inline-block w-3 h-3 rounded ${HEATMAP.red}`} /> Short/Unsafe</span>
          </div>
        </div>

        {/* Training Compliance */}
        {(() => {
          const trainingTypes = getTrainingTypes(data.config);
          const activeStaff = data.staff.filter(s => s.active !== false);
          const matrix = buildComplianceMatrix(activeStaff, trainingTypes, data.training || {}, today);
          const stats = getComplianceStats(matrix);
          const pctColor = stats.compliancePct >= 90 ? 'text-emerald-600' : stats.compliancePct >= 70 ? 'text-amber-600' : 'text-red-600';
          return (
            <div className={`${CARD.padded} cursor-pointer hover:shadow-md transition-shadow`} onClick={() => navigate('/training')}>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Training Compliance</h2>
              <div className="flex items-center justify-between mb-3">
                <span className={`text-3xl font-bold ${pctColor}`}>{stats.compliancePct}%</span>
                <span className={stats.compliancePct >= 90 ? BADGE.green : stats.compliancePct >= 70 ? BADGE.amber : BADGE.red}>
                  {stats.compliancePct >= 90 ? 'Compliant' : stats.compliancePct >= 70 ? 'At Risk' : 'Non-Compliant'}
                </span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Compliant</span>
                  <span className="font-semibold text-emerald-600">{stats.compliant}</span>
                </div>
                {stats.expired > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Expired</span>
                    <span className="font-semibold text-red-600">{stats.expired}</span>
                  </div>
                )}
                {stats.expiringSoon > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Expiring Soon</span>
                    <span className="font-semibold text-amber-600">{stats.expiringSoon}</span>
                  </div>
                )}
                {stats.urgent > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Urgent</span>
                    <span className="font-semibold text-red-600">{stats.urgent}</span>
                  </div>
                )}
                {stats.notStarted > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Not Started</span>
                    <span className="font-semibold text-gray-500">{stats.notStarted}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Alerts */}
        <div className={`${CARD.padded} lg:col-span-2`}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Alerts</h2>
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              All clear — full coverage this cycle
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {alerts.map((alert, i) => (
                <div key={i} className={`flex items-start gap-2 text-xs px-3 py-2 rounded-lg border ${
                  alert.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}>
                  <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={
                      alert.type === 'error'
                        ? 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.07 16.5c-.77.833.192 2.5 1.732 2.5z'
                        : 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                    } />
                  </svg>
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
