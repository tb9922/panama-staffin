import { useState, useEffect } from 'react';
import { syncBankHolidays } from '../lib/bankHolidays.js';
import { isCareRole } from '../lib/rotation.js';
import { CARD, TABLE, INPUT, BTN, BADGE } from '../lib/design.js';

export default function Config({ data, updateData }) {
  const [config, setConfig] = useState(JSON.parse(JSON.stringify(data.config)));
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);

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
      <label className={INPUT.label}>{label}</label>
      <div className="flex items-center gap-1">
        {type === 'number' ? (
          <input type="number" step={step || 1} value={getVal(path)}
            onChange={e => handleChange(path, parseFloat(e.target.value) || 0)}
            className={INPUT.sm} />
        ) : (
          <input type={type} value={getVal(path)}
            onChange={e => handleChange(path, e.target.value)}
            className={INPUT.sm} />
        )}
        {unit && <span className="text-xs text-gray-400 whitespace-nowrap">{unit}</span>}
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {dirty && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 mb-4 flex items-center justify-between text-sm">
          <span className="text-amber-700">You have unsaved changes</span>
          <button onClick={handleSave} className={`${BTN.danger} ${BTN.xs} !bg-amber-600 !hover:bg-amber-700`}>Save Now</button>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <button onClick={handleSave}
          className={`${BTN.primary} ${saved ? '!bg-green-600' : dirty ? '!bg-amber-600 hover:!bg-amber-700' : ''}`}>
          {saved ? 'Saved!' : dirty ? 'Save Changes *' : 'Save Changes'}
        </button>
      </div>

      {/* Home Details */}
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Home Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Field label="Home Name" path="home_name" type="text" />
          <Field label="Registered Beds" path="registered_beds" />
          <div>
            <label className={INPUT.label}>Care Type</label>
            <select value={config.care_type} onChange={e => handleChange('care_type', e.target.value)}
              className={INPUT.select}>
              {['Residential', 'Nursing', 'Dementia', 'Mixed'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <Field label="Cycle Start Date" path="cycle_start_date" type="date" />
        </div>
      </section>

      {/* Shift Definitions */}
      <section className={`${CARD.flush} mb-5`}>
        <div className="p-5 pb-0">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Shift Times & Hours</h2>
        </div>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th className={TABLE.th}>Code</th>
                <th className={TABLE.th}>Name</th>
                <th className={TABLE.th}>Start</th>
                <th className={TABLE.th}>End</th>
                <th className={TABLE.th}>Hours</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(config.shifts).map(([code, shift]) => (
                <tr key={code} className={TABLE.tr}>
                  <td className={TABLE.tdMono}><span className="font-bold">{code}</span></td>
                  <td className={TABLE.td}>
                    <input type="text" value={shift.name} onChange={e => handleChange(`shifts.${code}.name`, e.target.value)}
                      className={INPUT.sm} />
                  </td>
                  <td className={TABLE.td}>
                    <input type="time" value={shift.start} onChange={e => handleChange(`shifts.${code}.start`, e.target.value)}
                      className={INPUT.sm} />
                  </td>
                  <td className={TABLE.td}>
                    <input type="time" value={shift.end} onChange={e => handleChange(`shifts.${code}.end`, e.target.value)}
                      className={INPUT.sm} />
                  </td>
                  <td className={TABLE.td}>
                    <input type="number" step="0.25" value={shift.hours}
                      onChange={e => handleChange(`shifts.${code}.hours`, parseFloat(e.target.value) || 0)}
                      className={`${INPUT.sm} w-20`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-2 gap-4 p-5 pt-4">
          <Field label="Handover" path="handover_mins" unit="mins" />
          <Field label="Break Deduction" path="break_deduction" step={0.5} unit="hrs" />
        </div>
      </section>

      {/* Minimum Staffing */}
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Minimum Staffing Levels</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {['early', 'late', 'night'].map(period => (
            <div key={period} className="border border-gray-200 rounded-xl p-4">
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
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Overtime & Agency</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="OT Premium" path="ot_premium" step={0.5} unit="/hr" />
          <Field label="Agency Day Rate" path="agency_rate_day" unit="/hr" />
          <Field label="Agency Night Rate" path="agency_rate_night" unit="/hr" />
          <Field label="Agency Target (e.g. 0.05 = 5%)" path="agency_target_pct" step={0.01} />
          <Field label="Sleep-In Rate (£ flat per night)" path="sleep_in_rate" step={0.01} unit="/night" />
        </div>
      </section>

      {/* Safety Limits */}
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Safety Limits</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Max Consecutive Days" path="max_consecutive_days" />
          <Field label="Max AL Same Day" path="max_al_same_day" />
          <Field label="Float Retainer" path="float_retainer_weekly" unit="/wk" />
          <Field label="Weekly OT Cap" path="weekly_ot_cap" unit="shifts" />
        </div>
        <div className="mt-4 space-y-2">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={!!config.enforce_onboarding_blocking}
              onChange={e => handleChange('enforce_onboarding_blocking', e.target.checked)} className="accent-blue-600" />
            Warn when rostering staff with incomplete onboarding (DBS, RTW, references, identity)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={!!config.enforce_training_blocking}
              onChange={e => handleChange('enforce_training_blocking', e.target.checked)} className="accent-blue-600" />
            Warn when rostering staff with expired critical training (fire safety, moving &amp; handling, safeguarding)
          </label>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-100">
          <label className={INPUT.label}>Past-Date Edit PIN (4–6 digits)</label>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={config.edit_lock_pin || ''}
            onChange={e => handleChange('edit_lock_pin', e.target.value.replace(/\D/g, ''))}
            placeholder="Leave blank to disable locking"
            className={`${INPUT.sm} w-40`}
          />
          <p className="text-xs text-gray-400 mt-1">
            Managers must enter this PIN to edit any date before today. Session-only — refreshing the page re-locks.
          </p>
        </div>
      </section>

      {/* Annual Leave */}
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Annual Leave</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="AL Entitlement" path="al_entitlement_days" unit="days/yr" />
          <Field label="Avg AL Per Day" path="avg_al_per_day" unit="people" />
          <Field label="Max Carryover" path="al_carryover_max" unit="days" />
          <div>
            <label className={INPUT.label}>Leave Year Start</label>
            <select value={config.leave_year_start || '04-01'}
              onChange={e => handleChange('leave_year_start', e.target.value)}
              className={INPUT.select}>
              <option value="01-01">January (Calendar year)</option>
              <option value="04-01">April (UK tax year)</option>
              <option value="09-01">September (Academic year)</option>
            </select>
            {(() => {
              const ly = config.leave_year_start || '04-01';
              const [mm, dd] = ly.split('-').map(Number);
              const now = new Date();
              const thisYr = new Date(Date.UTC(now.getFullYear(), mm - 1, dd));
              const start = now >= thisYr ? thisYr : new Date(Date.UTC(now.getFullYear() - 1, mm - 1, dd));
              const end = new Date(start); end.setUTCFullYear(end.getUTCFullYear() + 1); end.setUTCDate(end.getUTCDate() - 1);
              const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
              return <p className="text-xs text-gray-400 mt-1">Current: {fmt(start)} – {fmt(end)}</p>;
            })()}
          </div>
        </div>
      </section>

      {/* Weekly Hours Targets */}
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Weekly Hours Targets</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="FT Target (EL)" path="ft_target_el" step={0.5} unit="hrs/wk" />
          <Field label="FT Target (E/L only)" path="ft_target_partial" step={0.5} unit="hrs/wk" />
          <Field label="Night FT Target" path="night_ft_target" step={0.5} unit="hrs/wk" />
        </div>
      </section>

      {/* Bank Holiday & Sickness */}
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Bank Holiday & Sickness</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="BH Premium Multiplier" path="bh_premium_multiplier" step={0.1} unit="x" />
          <Field label="Sickness Rate" path="sickness_rate" step={0.01} />
          <Field label="Night Gap %" path="night_gap_pct" step={0.05} />
          <div>
            <Field label="NLW Rate" path="nlw_rate" step={0.01} unit="/hr" />
            {(() => {
              const nlw = config.nlw_rate || 12.21;
              const below = data.staff.filter(s => s.active !== false && isCareRole(s.role) && s.hourly_rate < nlw);
              return below.length > 0 ? (
                <p className="text-xs text-red-600 mt-1">{below.length} staff below this rate</p>
              ) : null;
            })()}
          </div>
        </div>
      </section>

      {/* Fortification */}
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Fortification Parameters</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Emergency Call-In Premium" path="emergency_callin_premium" step={0.1} unit="x" />
          <Field label="Manager Floor Rate" path="manager_floor_rate" unit="/hr" />
          <Field label="Winter Sick Uplift" path="winter_sick_uplift" step={0.1} unit="x" />
          <Field label="Agency Availability %" path="agency_availability_pct" step={0.1} />
          <Field label="Bank Staff Pool" path="bank_staff_pool_size" />
        </div>
      </section>

      {/* Budget Targets */}
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Budget Targets</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Monthly Staff Budget" path="monthly_staff_budget" unit="/month" />
          <Field label="Monthly Agency Cap" path="monthly_agency_cap" unit="/month" />
        </div>
        <p className="text-xs text-gray-400 mt-2">Used by Budget vs Actual page. Per-month overrides can be set there.</p>
      </section>

      {/* Bank Holidays List */}
      <section className={CARD.padded}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Bank Holidays</h2>
          <button onClick={async () => {
            setSyncStatus({ loading: true });
            try {
              const result = await syncBankHolidays(config.bank_holidays);
              handleChange('bank_holidays', result.holidays);
              setSyncStatus({ success: true, msg: `Synced via ${result.source} — ${result.added} new holidays added (${result.holidays.length} total)` });
              setTimeout(() => setSyncStatus(null), 5000);
            } catch (err) {
              setSyncStatus({ error: true, msg: 'Sync failed: ' + err.message });
              setTimeout(() => setSyncStatus(null), 5000);
            }
          }} disabled={syncStatus?.loading}
            className={`${BTN.primary} ${BTN.sm} !bg-purple-600 hover:!bg-purple-700 active:!bg-purple-800`}>
            {syncStatus?.loading ? 'Syncing...' : 'Sync UK Bank Holidays'}
          </button>
        </div>
        {syncStatus && !syncStatus.loading && (
          <div className={`text-sm px-3 py-2 rounded-xl mb-3 ${syncStatus.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {syncStatus.msg}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 mb-3">
          {config.bank_holidays?.map((bh, i) => (
            <div key={i} className={`flex items-center justify-between ${BADGE.pink} !rounded-xl !px-3 !py-2 !text-sm`}>
              <div>
                <div className="font-medium text-xs">{bh.name}</div>
                <div className="text-[10px] text-gray-500">{bh.date}</div>
              </div>
              <button onClick={() => {
                const newBH = [...config.bank_holidays];
                newBH.splice(i, 1);
                handleChange('bank_holidays', newBH);
              }} className="text-red-400 hover:text-red-600 text-xs ml-2 transition-colors duration-150">X</button>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <input id="bh-date" type="date" className={INPUT.sm} />
          <input id="bh-name" type="text" placeholder="Holiday name" className={`${INPUT.sm} flex-1`} />
          <button onClick={() => {
            const dateEl = document.getElementById('bh-date');
            const nameEl = document.getElementById('bh-name');
            if (dateEl.value && nameEl.value) {
              handleChange('bank_holidays', [...(config.bank_holidays || []), { date: dateEl.value, name: nameEl.value }]);
              dateEl.value = '';
              nameEl.value = '';
            }
          }} className={`${BTN.primary} ${BTN.sm} !bg-pink-600 hover:!bg-pink-700 active:!bg-pink-800`}>Add</button>
        </div>
      </section>
    </div>
  );
}
