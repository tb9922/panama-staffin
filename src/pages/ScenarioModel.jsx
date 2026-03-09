import { useState, useMemo, useEffect } from 'react';
import { getCycleDates, getStaffForDay } from '../lib/rotation.js';
import { calculateDayCost, calculateScenario } from '../lib/escalation.js';
import { CARD, TABLE, INPUT, BTN } from '../lib/design.js';
import { getCurrentHome, getSchedulingData } from '../lib/api.js';

const PRESET_SCENARIOS = [
  { name: 'CLEAN (Zero disruption)', sick: 0, al: 0 },
  { name: 'TYPICAL WEEK', sick: 1, al: 1 },
  { name: 'BAD WEEK', sick: 2, al: 2 },
  { name: 'CRISIS WEEK', sick: 3, al: 2 },
  { name: 'WORST CASE (Winter/Flu)', sick: 4, al: 2 },
  { name: 'PANDEMIC / NOROVIRUS', sick: 6, al: 2 },
];

const WINTER_SCENARIOS = [
  { name: 'WINTER TYPICAL', gaps: 3 },
  { name: 'WINTER BAD', gaps: 5 },
  { name: 'WINTER CRISIS', gaps: 7 },
  { name: 'WINTER WORST', gaps: 9 },
  { name: 'NOROVIRUS PEAK', gaps: 9 },
];

export default function ScenarioModel() {
  const [schedData, setSchedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [customSick, setCustomSick] = useState(2);
  const [customAL, setCustomAL] = useState(1);
  const [customName, setCustomName] = useState('Custom Scenario');

  const [error, setError] = useState(null);

  useEffect(() => {
    const homeSlug = getCurrentHome();
    if (!homeSlug) return;
    getSchedulingData(homeSlug)
      .then(setSchedData)
      .catch(e => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400 text-sm" role="status">Loading scenario data...</div>;
  if (error || !schedData) return <div className="p-6 text-red-600">{error || 'Failed to load scheduling data'}</div>;

  return <ScenarioModelInner schedData={schedData} customSick={customSick} setCustomSick={setCustomSick} customAL={customAL} setCustomAL={setCustomAL} customName={customName} setCustomName={setCustomName} />;
}

function ScenarioModelInner({ schedData, customSick, setCustomSick, customAL, setCustomAL, customName, setCustomName }) {
  const config = schedData.config;

  // Calculate base 28-day cost from actual roster
  const baseCost = useMemo(() => {
    const dates = getCycleDates(config.cycle_start_date, new Date(), 28);
    return dates.reduce((sum, date) => {
      const staff = getStaffForDay(schedData.staff, date, schedData.overrides, config);
      return sum + calculateDayCost(staff, config).total;
    }, 0);
  }, [schedData.staff, schedData.overrides, config]);

  // Combine presets + custom
  const allScenarios = useMemo(() => {
    return [...PRESET_SCENARIOS, { name: customName, sick: customSick, al: customAL, isCustom: true }];
  }, [customSick, customAL, customName]);

  // Run scenarios
  const scenarioResults = useMemo(() => {
    const configWithStaff = { ...config, staff: schedData.staff };
    return allScenarios.map(s => {
      const result = calculateScenario(s.sick, s.al, configWithStaff);
      const total28 = baseCost + result.totalExtraCost;
      const monthly = total28 / 28 * 30.44;
      const annual = total28 / 28 * 365;
      return { ...s, ...result, baseCost, total28, monthly, annual };
    });
  }, [allScenarios, config, schedData.staff, baseCost]);

  // Agency kill comparison (Typical scenario)
  const typical = scenarioResults[1];
  const elHrs = config.shifts.EL.hours;
  const nHrs = config.shifts.N.hours;
  const nightPct = config.night_gap_pct || 0.3;
  const withoutKill28 = baseCost + typical.totalGaps * ((1 - nightPct) * elHrs * config.agency_rate_day + nightPct * nHrs * config.agency_rate_night) * 28;
  const withKill28 = typical.total28;
  const annualSaving = (withoutKill28 - withKill28) / 28 * 365;

  // Winter scenarios
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const winterResults = useMemo(() => {
    const floatPool = schedData.staff.filter(s => s.team === 'Float' && s.active !== false).length;
    const otCap = config.weekly_ot_cap || 8;
    return WINTER_SCENARIOS.map(s => {
      const weekly = s.gaps * 7;
      const floatWk = Math.min(weekly, floatPool * 5);
      const otWk = Math.min(Math.max(weekly - floatWk, 0), otCap);
      const agWk = Math.max(weekly - floatWk - otWk, 0);
      const agCostWk = agWk * (0.7 * elHrs * config.agency_rate_day + 0.3 * nHrs * config.agency_rate_night) / 7;
      return { ...s, weekly, floatWk, otWk, agWk, agCostWk: agCostWk * 7 };
    });
  }, [schedData.staff, config]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{config.home_name} — Staffing Cost Scenarios</h1>
        <p className="text-xs text-gray-500">Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className="flex items-center justify-between mb-2 print:hidden">
        <h1 className="text-2xl font-bold text-gray-900">Staffing Cost Scenarios</h1>
        <button onClick={() => window.print()}
          className={BTN.secondary}>Print</button>
      </div>
      <p className="text-sm text-gray-500 mb-6">Adaptive model linked to roster, config, and daily costs</p>

      {/* Custom Scenario Builder */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 print:hidden">
        <h2 className="text-sm font-semibold text-blue-800 mb-3">Custom What-If Scenario</h2>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className={INPUT.label + ' !text-blue-600'}>Name</label>
            <input type="text" value={customName} onChange={e => setCustomName(e.target.value)}
              className={INPUT.sm + ' !w-40'} />
          </div>
          <div>
            <label className={INPUT.label + ' !text-blue-600'}>Sick per day</label>
            <input type="number" min="0" max="15" step="1" value={customSick}
              onChange={e => setCustomSick(parseInt(e.target.value) || 0)}
              className={INPUT.sm + ' !w-20'} />
          </div>
          <div>
            <label className={INPUT.label + ' !text-blue-600'}>AL per day</label>
            <input type="number" min="0" max="10" step="1" value={customAL}
              onChange={e => setCustomAL(parseInt(e.target.value) || 0)}
              className={INPUT.sm + ' !w-20'} />
          </div>
          <div className="text-xs text-blue-600">
            Results appear in the last row of the table below
          </div>
        </div>
      </div>

      {/* Main Scenario Table */}
      <div className={CARD.flush + ' mb-6'}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className="bg-gray-800 text-white text-xs">
              <tr>
                <th scope="col" className={TABLE.th}>Scenario</th>
                <th scope="col" className={TABLE.th + ' text-center'}>Sick/d</th>
                <th scope="col" className={TABLE.th + ' text-center'}>AL/d</th>
                <th scope="col" className={TABLE.th + ' text-center'}>Gaps</th>
                <th scope="col" className={TABLE.th + ' text-center'}>Float</th>
                <th scope="col" className={TABLE.th + ' text-center'}>OT</th>
                <th scope="col" className={TABLE.th + ' text-center'}>AG Day</th>
                <th scope="col" className={TABLE.th + ' text-center'}>AG Night</th>
                <th scope="col" className={TABLE.th + ' text-right'}>Base £</th>
                <th scope="col" className={TABLE.th + ' text-right'}>Extra £</th>
                <th scope="col" className={TABLE.th + ' text-right font-bold'}>Total 28d £</th>
                <th scope="col" className={TABLE.th + ' text-right'}>Monthly £</th>
                <th scope="col" className={TABLE.th + ' text-right'}>Annual £</th>
              </tr>
            </thead>
            <tbody>
              {scenarioResults.map((s, i) => (
                <tr key={i} className={`${TABLE.tr} ${
                  s.isCustom ? 'bg-blue-50 border-blue-200' :
                  i === 0 ? 'bg-green-50' : i >= 4 ? 'bg-red-50' : ''
                }`}>
                  <td className={TABLE.td + ' font-medium text-xs'}>
                    {s.isCustom ? <span className="text-blue-700">{s.name}</span> : s.name}
                  </td>
                  <td className={TABLE.td + ' text-center'}>{s.sick}</td>
                  <td className={TABLE.td + ' text-center'}>{s.al}</td>
                  <td className={TABLE.td + ' text-center font-medium'}>{s.totalGaps}</td>
                  <td className={TABLE.td + ' text-center text-green-600'}>{s.floatFills}</td>
                  <td className={TABLE.td + ' text-center text-orange-600'}>{s.otFills}</td>
                  <td className={TABLE.td + ' text-center text-red-600'}>{s.agDayFills}</td>
                  <td className={TABLE.td + ' text-center text-red-600'}>{s.agNightFills}</td>
                  <td className={TABLE.td + ' text-right text-gray-500'}>£{Math.round(s.baseCost).toLocaleString()}</td>
                  <td className={TABLE.td + ' text-right text-amber-600'}>£{Math.round(s.totalExtraCost).toLocaleString()}</td>
                  <td className={TABLE.td + ' text-right font-bold'}>£{Math.round(s.total28).toLocaleString()}</td>
                  <td className={TABLE.td + ' text-right text-gray-600'}>£{Math.round(s.monthly).toLocaleString()}</td>
                  <td className={TABLE.td + ' text-right text-gray-600'}>£{Math.round(s.annual).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Agency Kill Impact */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className={CARD.padded}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-4">Agency Kill Impact</h2>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{'WITHOUT Agency Kill (all gaps → agency):'}</span>
              <span className="font-medium">£{Math.round(withoutKill28).toLocaleString()} / 28d</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{'WITH Agency Kill (float → OT → agency last):'}</span>
              <span className="font-medium text-green-600">£{Math.round(withKill28).toLocaleString()} / 28d</span>
            </div>
            <div className="border-t pt-3 flex justify-between text-sm font-bold">
              <span>Annual Saving per Home:</span>
              <span className="text-green-600 text-lg">£{Math.round(annualSaving).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-500">
              <span>Across 10 homes:</span>
              <span>£{Math.round(annualSaving * 10).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-500">
              <span>Across 30 homes:</span>
              <span>£{Math.round(annualSaving * 30).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Winter Scenarios */}
        <div className={CARD.padded}>
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-4">Winter Scenarios (Weekly OT Cap)</h2>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Scenario</th>
                <th scope="col" className={TABLE.th + ' text-center'}>Gaps/d</th>
                <th scope="col" className={TABLE.th + ' text-center'}>Float</th>
                <th scope="col" className={TABLE.th + ' text-center'}>OT</th>
                <th scope="col" className={TABLE.th + ' text-center'}>Agency</th>
                <th scope="col" className={TABLE.th + ' text-right'}>AG £/wk</th>
              </tr>
            </thead>
            <tbody>
              {winterResults.map((w, i) => (
                <tr key={i} className={TABLE.tr}>
                  <td className={TABLE.td + ' text-xs font-medium'}>{w.name}</td>
                  <td className={TABLE.td + ' text-center'}>{w.gaps}</td>
                  <td className={TABLE.td + ' text-center text-green-600'}>{w.floatWk}</td>
                  <td className={TABLE.td + ' text-center text-orange-600'}>{w.otWk}</td>
                  <td className={TABLE.td + ' text-center text-red-600'}>{w.agWk}</td>
                  <td className={TABLE.tdMono + ' text-right'}>{w.agCostWk > 0 ? `£${w.agCostWk.toFixed(0)}` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assumptions */}
      <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-500">
        <strong>Assumptions:</strong> Float pool = {schedData.staff.filter(s => s.team === 'Float' && s.active !== false).length} |
        OT pool = {config.bank_staff_pool_size} |
        Night gap % = {((config.night_gap_pct || 0.3) * 100).toFixed(0)}% |
        OT premium = £{config.ot_premium}/hr |
        Agency day = £{config.agency_rate_day}/hr |
        Agency night = £{config.agency_rate_night}/hr |
        Weekly OT cap = {config.weekly_ot_cap || 8} shifts
      </div>
    </div>
  );
}
