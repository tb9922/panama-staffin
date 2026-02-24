import { useState, useEffect } from 'react';

export default function Config({ data, updateData }) {
  const [config, setConfig] = useState(JSON.parse(JSON.stringify(data.config)));
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Warn on navigation if unsaved
  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  function handleChange(path, value) {
    const keys = path.split('.');
    const newConfig = JSON.parse(JSON.stringify(config));
    let obj = newConfig;
    for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
    obj[keys[keys.length - 1]] = value;
    setConfig(newConfig);
    setSaved(false);
    setDirty(true);
  }

  function handleSave() {
    updateData({ ...data, config });
    setSaved(true);
    setDirty(false);
    setTimeout(() => setSaved(false), 2000);
  }

  function getVal(path) {
    const keys = path.split('.');
    let obj = config;
    for (const k of keys) obj = obj?.[k];
    return obj ?? '';
  }

  const Field = ({ label, path, type = 'number', step, unit }) => (
    <div>
      <label className="block text-sm font-medium text-gray-600 mb-1">{label}</label>
      <div className="flex items-center gap-1">
        {type === 'number' ? (
          <input type="number" step={step || 1} value={getVal(path)}
            onChange={e => handleChange(path, parseFloat(e.target.value) || 0)}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
        ) : (
          <input type={type} value={getVal(path)}
            onChange={e => handleChange(path, e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
        )}
        {unit && <span className="text-xs text-gray-400 whitespace-nowrap">{unit}</span>}
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl">
      {dirty && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 mb-4 flex items-center justify-between text-sm">
          <span className="text-amber-700">You have unsaved changes</span>
          <button onClick={handleSave} className="bg-amber-600 text-white px-3 py-1 rounded text-xs hover:bg-amber-700">Save Now</button>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <button onClick={handleSave}
          className={`px-6 py-2 rounded font-medium text-white ${saved ? 'bg-green-600' : dirty ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
          {saved ? 'Saved!' : dirty ? 'Save Changes *' : 'Save Changes'}
        </button>
      </div>

      {/* Home Details */}
      <section className="bg-white rounded-lg shadow p-5 mb-5">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Home Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Field label="Home Name" path="home_name" type="text" />
          <Field label="Registered Beds" path="registered_beds" />
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Care Type</label>
            <select value={config.care_type} onChange={e => handleChange('care_type', e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm">
              {['Residential', 'Nursing', 'Dementia', 'Mixed'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <Field label="Cycle Start Date" path="cycle_start_date" type="date" />
        </div>
      </section>

      {/* Shift Definitions */}
      <section className="bg-white rounded-lg shadow p-5 mb-5">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Shift Times & Hours</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-600 text-xs">
              <th className="py-2 pr-3">Code</th>
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Start</th>
              <th className="py-2 pr-3">End</th>
              <th className="py-2 pr-3">Hours</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(config.shifts).map(([code, shift]) => (
              <tr key={code} className="border-b">
                <td className="py-1.5 pr-3 font-mono font-bold">{code}</td>
                <td className="py-1.5 pr-3">
                  <input type="text" value={shift.name} onChange={e => handleChange(`shifts.${code}.name`, e.target.value)}
                    className="border rounded px-2 py-1 text-sm w-24" />
                </td>
                <td className="py-1.5 pr-3">
                  <input type="time" value={shift.start} onChange={e => handleChange(`shifts.${code}.start`, e.target.value)}
                    className="border rounded px-2 py-1 text-sm" />
                </td>
                <td className="py-1.5 pr-3">
                  <input type="time" value={shift.end} onChange={e => handleChange(`shifts.${code}.end`, e.target.value)}
                    className="border rounded px-2 py-1 text-sm" />
                </td>
                <td className="py-1.5 pr-3">
                  <input type="number" step="0.25" value={shift.hours}
                    onChange={e => handleChange(`shifts.${code}.hours`, parseFloat(e.target.value) || 0)}
                    className="border rounded px-2 py-1 text-sm w-20" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <Field label="Handover" path="handover_mins" unit="mins" />
          <Field label="Break Deduction" path="break_deduction" step={0.5} unit="hrs" />
        </div>
      </section>

      {/* Minimum Staffing */}
      <section className="bg-white rounded-lg shadow p-5 mb-5">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Minimum Staffing Levels</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {['early', 'late', 'night'].map(period => (
            <div key={period} className="border rounded-lg p-4">
              <h3 className="font-semibold text-gray-700 mb-3 capitalize">{period} Shift</h3>
              <div className="space-y-2">
                <Field label="Min Heads" path={`minimum_staffing.${period}.heads`} />
                <Field label="Min Skill Points" path={`minimum_staffing.${period}.skill_points`} step={0.5} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Overtime & Agency */}
      <section className="bg-white rounded-lg shadow p-5 mb-5">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Overtime & Agency</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="OT Premium" path="ot_premium" step={0.5} unit="£/hr" />
          <Field label="Agency Day Rate" path="agency_rate_day" unit="£/hr" />
          <Field label="Agency Night Rate" path="agency_rate_night" unit="£/hr" />
          <Field label="Agency Target (e.g. 0.05 = 5%)" path="agency_target_pct" step={0.01} />
        </div>
      </section>

      {/* Safety Limits */}
      <section className="bg-white rounded-lg shadow p-5 mb-5">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Safety Limits</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Max Consecutive Days" path="max_consecutive_days" />
          <Field label="Max AL Same Day" path="max_al_same_day" />
          <Field label="Float Retainer" path="float_retainer_weekly" unit="£/wk" />
          <Field label="Weekly OT Cap" path="weekly_ot_cap" unit="shifts" />
        </div>
      </section>

      {/* Annual Leave */}
      <section className="bg-white rounded-lg shadow p-5 mb-5">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Annual Leave</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="AL Entitlement" path="al_entitlement_days" unit="days/yr" />
          <Field label="Avg AL Per Day" path="avg_al_per_day" unit="people" />
        </div>
      </section>

      {/* Weekly Hours Targets */}
      <section className="bg-white rounded-lg shadow p-5 mb-5">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Weekly Hours Targets</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="FT Target (EL)" path="ft_target_el" step={0.5} unit="hrs/wk" />
          <Field label="FT Target (E/L only)" path="ft_target_partial" step={0.5} unit="hrs/wk" />
          <Field label="Night FT Target" path="night_ft_target" step={0.5} unit="hrs/wk" />
        </div>
      </section>

      {/* Bank Holiday & Sickness */}
      <section className="bg-white rounded-lg shadow p-5 mb-5">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Bank Holiday & Sickness</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="BH Premium Multiplier" path="bh_premium_multiplier" step={0.1} unit="x" />
          <Field label="Sickness Rate" path="sickness_rate" step={0.01} />
          <Field label="Night Gap %" path="night_gap_pct" step={0.05} />
          <Field label="NLW Rate" path="nlw_rate" step={0.01} unit="£/hr" />
        </div>
      </section>

      {/* Fortification */}
      <section className="bg-white rounded-lg shadow p-5 mb-5">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Fortification Parameters</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Emergency Call-In Premium" path="emergency_callin_premium" step={0.1} unit="x" />
          <Field label="Manager Floor Rate" path="manager_floor_rate" unit="£/hr" />
          <Field label="Winter Sick Uplift" path="winter_sick_uplift" step={0.1} unit="x" />
          <Field label="Agency Availability %" path="agency_availability_pct" step={0.1} />
          <Field label="Bank Staff Pool" path="bank_staff_pool_size" />
        </div>
      </section>

      {/* Bank Holidays List */}
      <section className="bg-white rounded-lg shadow p-5">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Bank Holidays</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 mb-3">
          {config.bank_holidays?.map((bh, i) => (
            <div key={i} className="flex items-center justify-between bg-pink-50 rounded px-3 py-2 text-sm border border-pink-200">
              <div>
                <div className="font-medium text-xs">{bh.name}</div>
                <div className="text-[10px] text-gray-500">{bh.date}</div>
              </div>
              <button onClick={() => {
                const newBH = [...config.bank_holidays];
                newBH.splice(i, 1);
                handleChange('bank_holidays', newBH);
              }} className="text-red-400 hover:text-red-600 text-xs ml-2">X</button>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <input id="bh-date" type="date" className="border rounded px-3 py-1.5 text-sm" />
          <input id="bh-name" type="text" placeholder="Holiday name" className="border rounded px-3 py-1.5 text-sm flex-1" />
          <button onClick={() => {
            const dateEl = document.getElementById('bh-date');
            const nameEl = document.getElementById('bh-name');
            if (dateEl.value && nameEl.value) {
              handleChange('bank_holidays', [...(config.bank_holidays || []), { date: dateEl.value, name: nameEl.value }]);
              dateEl.value = '';
              nameEl.value = '';
            }
          }} className="bg-pink-600 text-white px-4 py-1.5 rounded text-sm hover:bg-pink-700">Add</button>
        </div>
      </section>
    </div>
  );
}
