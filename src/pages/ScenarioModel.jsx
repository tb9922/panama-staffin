import { useState, useMemo } from 'react';
import { getCycleDates, getStaffForDay, formatDate } from '../lib/rotation.js';
import { calculateDayCost, calculateScenario } from '../lib/escalation.js';

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

export default function ScenarioModel({ data }) {
  const [customSick, setCustomSick] = useState(2);
  const [customAL, setCustomAL] = useState(1);
  const [customName, setCustomName] = useState('Custom Scenario');

  // Calculate base 28-day cost from actual roster
  const baseCost = useMemo(() => {
    const dates = getCycleDates(data.config.cycle_start_date, new Date(), 28);
    return dates.reduce((sum, date) => {
      const staff = getStaffForDay(data.staff, date, data.overrides, data.config);
      return sum + calculateDayCost(staff, data.config).total;
    }, 0);
  }, [data]);

  // Combine presets + custom
  const allScenarios = useMemo(() => {
    return [...PRESET_SCENARIOS, { name: customName, sick: customSick, al: customAL, isCustom: true }];
  }, [customSick, customAL, customName]);

  // Run scenarios
  const scenarioResults = useMemo(() => {
    const configWithStaff = { ...data.config, staff: data.staff };
    return allScenarios.map(s => {
      const result = calculateScenario(s.sick, s.al, configWithStaff);
      const total28 = baseCost + result.totalExtraCost;
      const monthly = total28 / 28 * 30.44;
      const annual = total28 / 28 * 365;
      return { ...s, ...result, baseCost, total28, monthly, annual };
    });
  }, [allScenarios, data, baseCost]);

  // Agency kill comparison (Typical scenario)
  const typical = scenarioResults[1];
  const elHrs = data.config.shifts.EL.hours;
  const nHrs = data.config.shifts.N.hours;
  const nightPct = data.config.night_gap_pct;
  const withoutKill28 = baseCost + typical.totalGaps * ((1 - nightPct) * elHrs * data.config.agency_rate_day + nightPct * nHrs * data.config.agency_rate_night) * 28;
  const withKill28 = typical.total28;
  const annualSaving = (withoutKill28 - withKill28) / 28 * 365;

  // Winter scenarios
  const winterResults = useMemo(() => {
    const floatPool = data.staff.filter(s => s.team === 'Float' && s.active !== false).length;
    const otCap = data.config.weekly_ot_cap || 8;
    return WINTER_SCENARIOS.map(s => {
      const weekly = s.gaps * 7;
      const floatWk = Math.min(weekly, floatPool * 5);
      const otWk = Math.min(Math.max(weekly - floatWk, 0), otCap);
      const agWk = Math.max(weekly - floatWk - otWk, 0);
      const agCostWk = agWk * (0.7 * elHrs * data.config.agency_rate_day + 0.3 * nHrs * data.config.agency_rate_night) / 7;
      return { ...s, weekly, floatWk, otWk, agWk, agCostWk: agCostWk * 7 };
    });
  }, [data]);

  return (
    <div className="p-6">
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{data.config.home_name} — Staffing Cost Scenarios</h1>
        <p className="text-xs text-gray-500">Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className="flex items-center justify-between mb-2 print:hidden">
        <h1 className="text-2xl font-bold text-gray-900">Staffing Cost Scenarios</h1>
        <button onClick={() => window.print()}
          className="border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-1.5 rounded text-sm">Print</button>
      </div>
      <p className="text-sm text-gray-500 mb-6">Adaptive model linked to roster, config, and daily costs</p>

      {/* Custom Scenario Builder */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 print:hidden">
        <h2 className="text-sm font-semibold text-blue-800 mb-3">Custom What-If Scenario</h2>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-blue-600 mb-1">Name</label>
            <input type="text" value={customName} onChange={e => setCustomName(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm w-40" />
          </div>
          <div>
            <label className="block text-xs text-blue-600 mb-1">Sick per day</label>
            <input type="number" min="0" max="15" step="1" value={customSick}
              onChange={e => setCustomSick(parseInt(e.target.value) || 0)}
              className="border rounded px-2 py-1.5 text-sm w-20" />
          </div>
          <div>
            <label className="block text-xs text-blue-600 mb-1">AL per day</label>
            <input type="number" min="0" max="10" step="1" value={customAL}
              onChange={e => setCustomAL(parseInt(e.target.value) || 0)}
              className="border rounded px-2 py-1.5 text-sm w-20" />
          </div>
          <div className="text-xs text-blue-600">
            Results appear in the last row of the table below
          </div>
        </div>
      </div>

      {/* Main Scenario Table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead className="bg-gray-800 text-white text-xs">
            <tr>
              <th className="py-2 px-3 text-left">Scenario</th>
              <th className="py-2 px-2 text-center">Sick/d</th>
              <th className="py-2 px-2 text-center">AL/d</th>
              <th className="py-2 px-2 text-center">Gaps</th>
              <th className="py-2 px-2 text-center">Float</th>
              <th className="py-2 px-2 text-center">OT</th>
              <th className="py-2 px-2 text-center">AG Day</th>
              <th className="py-2 px-2 text-center">AG Night</th>
              <th className="py-2 px-2 text-right">Base £</th>
              <th className="py-2 px-2 text-right">Extra £</th>
              <th className="py-2 px-2 text-right font-bold">Total 28d £</th>
              <th className="py-2 px-2 text-right">Monthly £</th>
              <th className="py-2 px-2 text-right">Annual £</th>
            </tr>
          </thead>
          <tbody>
            {scenarioResults.map((s, i) => (
              <tr key={i} className={`border-b ${
                s.isCustom ? 'bg-blue-50 border-blue-200' :
                i === 0 ? 'bg-green-50' : i >= 4 ? 'bg-red-50' : 'hover:bg-gray-50'
              }`}>
                <td className="py-2 px-3 font-medium text-xs">
                  {s.isCustom ? <span className="text-blue-700">{s.name}</span> : s.name}
                </td>
                <td className="py-2 px-2 text-center">{s.sick}</td>
                <td className="py-2 px-2 text-center">{s.al}</td>
                <td className="py-2 px-2 text-center font-medium">{s.totalGaps}</td>
                <td className="py-2 px-2 text-center text-green-600">{s.floatFills}</td>
                <td className="py-2 px-2 text-center text-orange-600">{s.otFills}</td>
                <td className="py-2 px-2 text-center text-red-600">{s.agDayFills}</td>
                <td className="py-2 px-2 text-center text-red-600">{s.agNightFills}</td>
                <td className="py-2 px-2 text-right text-gray-500">£{Math.round(s.baseCost).toLocaleString()}</td>
                <td className="py-2 px-2 text-right text-amber-600">£{Math.round(s.totalExtraCost).toLocaleString()}</td>
                <td className="py-2 px-2 text-right font-bold">£{Math.round(s.total28).toLocaleString()}</td>
                <td className="py-2 px-2 text-right text-gray-600">£{Math.round(s.monthly).toLocaleString()}</td>
                <td className="py-2 px-2 text-right text-gray-600">£{Math.round(s.annual).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Agency Kill Impact */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-4">Agency Kill Impact</h2>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{'WITHOUT Agency Kill (all gaps \u2192 agency):'}</span>
              <span className="font-medium">£{Math.round(withoutKill28).toLocaleString()} / 28d</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{'WITH Agency Kill (float \u2192 OT \u2192 agency last):'}</span>
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
        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-4">Winter Scenarios (Weekly OT Cap)</h2>
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-600 border-b">
              <tr>
                <th className="py-1 text-left">Scenario</th>
                <th className="py-1 text-center">Gaps/d</th>
                <th className="py-1 text-center">Float</th>
                <th className="py-1 text-center">OT</th>
                <th className="py-1 text-center">Agency</th>
                <th className="py-1 text-right">AG £/wk</th>
              </tr>
            </thead>
            <tbody>
              {winterResults.map((w, i) => (
                <tr key={i} className="border-b">
                  <td className="py-1.5 text-xs font-medium">{w.name}</td>
                  <td className="py-1.5 text-center">{w.gaps}</td>
                  <td className="py-1.5 text-center text-green-600">{w.floatWk}</td>
                  <td className="py-1.5 text-center text-orange-600">{w.otWk}</td>
                  <td className="py-1.5 text-center text-red-600">{w.agWk}</td>
                  <td className="py-1.5 text-right font-mono">{w.agCostWk > 0 ? `£${w.agCostWk.toFixed(0)}` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assumptions */}
      <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-500">
        <strong>Assumptions:</strong> Float pool = {data.staff.filter(s => s.team === 'Float' && s.active !== false).length} |
        OT pool = {data.config.bank_staff_pool_size} |
        Night gap % = {(data.config.night_gap_pct * 100).toFixed(0)}% |
        OT premium = £{data.config.ot_premium}/hr |
        Agency day = £{data.config.agency_rate_day}/hr |
        Agency night = £{data.config.agency_rate_night}/hr |
        Weekly OT cap = {data.config.weekly_ot_cap} shifts
      </div>
    </div>
  );
}
