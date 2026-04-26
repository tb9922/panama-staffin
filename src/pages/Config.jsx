import { useState, useEffect, useCallback, useMemo } from 'react';
import { BANK_HOLIDAY_REGIONS, syncBankHolidays } from '../lib/bankHolidays.js';
import {
  isCareRole,
  ROTATION_PRESETS,
  resolvePatternForScope,
  resolveCycleLengthForScope,
  resolveCycleStartDateForScope,
  getCycleDay,
  formatDate,
  parseDate,
  addDays,
} from '../lib/rotation.js';
import { getMinimumWageRate } from '../../shared/nmw.js';
import { scoreCycleStartOffset } from '../lib/rotationAnalysis.js';
import { CARD, TABLE, INPUT, BTN, BADGE, PAGE } from '../lib/design.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import { getCurrentHome, getSchedulingData, saveConfig } from '../lib/api.js';
import { useData } from '../contexts/DataContext.jsx';
import ErrorState from '../components/ErrorState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import LoadingState from '../components/LoadingState.jsx';
import useTransientNotice from '../hooks/useTransientNotice.js';
import { useConfirm } from '../hooks/useConfirm.jsx';

export default function Config() {
  const { canWrite } = useData();
  const canEdit = canWrite('config');
  const homeSlug = getCurrentHome();
  const [config, setConfig] = useState(null);
  const [configUpdatedAt, setConfigUpdatedAt] = useState(null);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [newBhDate, setNewBhDate] = useState('');
  const [newBhName, setNewBhName] = useState('');
  const { notice, showNotice, clearNotice } = useTransientNotice();

  useDirtyGuard(dirty);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const d = await getSchedulingData(homeSlug);
      setConfig(JSON.parse(JSON.stringify(d.config || {})));
      setConfigUpdatedAt(d.configUpdatedAt || null);
      setStaff(d.staff || []);
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug]);

  useEffect(() => { load(); }, [load]);

  function handleChange(path, value) {
    if (!canEdit) return;
    const keys = path.split('.');
    const newConfig = JSON.parse(JSON.stringify(config));
    let obj = newConfig;
    for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
    obj[keys[keys.length - 1]] = value;
    setConfig(newConfig);
    setSaved(false);
    setSaveError(null);
    setDirty(true);
  }

  async function handleSave() {
    if (!canEdit || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveConfig(homeSlug, config, { clientUpdatedAt: configUpdatedAt });
      if (result?.updated_at) setConfigUpdatedAt(result.updated_at);
      setSaved(true);
      setDirty(false);
      showNotice('Settings saved.');
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function getVal(path) {
    const keys = path.split('.');
    let obj = config;
    for (const k of keys) obj = obj?.[k];
    return obj ?? '';
  }

  const inputIdFor = (path) => `config-${path.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

  const Field = ({ label, path, type = 'number', step, unit }) => {
    const id = inputIdFor(path);
    return (
      <div>
        <label htmlFor={id} className={INPUT.label}>{label}</label>
        <div className="flex items-center gap-1">
          {type === 'number' ? (
            <input id={id} type="number" step={step || 1} value={getVal(path)}
              onChange={e => handleChange(path, e.target.value === '' ? '' : parseFloat(e.target.value))}
              disabled={!canEdit}
              className={INPUT.sm} />
          ) : (
            <input id={id} type={type} value={getVal(path)}
              onChange={e => handleChange(path, e.target.value)}
              disabled={!canEdit}
              className={INPUT.sm} />
          )}
          {unit && <span className="whitespace-nowrap text-xs text-[var(--ink-4)]">{unit}</span>}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className={PAGE.container}>
        <LoadingState message="Loading settings..." card />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={PAGE.container}>
        <ErrorState title="Unable to load settings" message={loadError} onRetry={load} />
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className={PAGE.container}>
      {notice && (
        <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">
          {notice.content}
        </InlineNotice>
      )}
      {dirty && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-[var(--caution)] bg-[var(--caution-soft)] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[var(--caution)]">You have unsaved changes</span>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`${BTN.secondary} ${BTN.sm} border-[var(--caution)] text-[var(--caution)] hover:bg-[var(--caution-soft)]`}
          >
            {saving ? 'Saving...' : 'Save Now'}
          </button>
        </div>
      )}
      {saveError && (
        <div className="mb-4 rounded-xl border border-[var(--alert)] bg-[var(--alert-soft)] px-4 py-3 text-sm text-[var(--alert)]">
          Save failed: {saveError}
        </div>
      )}
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Settings</h1>
          <p className={PAGE.subtitle}>Home configuration, rota patterns, budgets and compliance defaults</p>
        </div>
        {canEdit && <button onClick={handleSave} disabled={saving}
          className={`${BTN.primary} w-full sm:w-auto ${saved ? '!border-[var(--ok)] !bg-[var(--ok)]' : dirty ? '!border-[var(--caution)] !bg-[var(--caution)] hover:!brightness-95' : ''}`}>
          {saving ? 'Saving...' : saved ? 'Saved!' : dirty ? 'Save Changes *' : 'Save Changes'}
        </button>}
      </div>

      {/* Home Details */}
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">Home Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Field label="Home Name" path="home_name" type="text" />
          <Field label="Registered Beds" path="registered_beds" />
          <div>
            <label htmlFor="config-care-type" className={INPUT.label}>Care Type</label>
            <select id="config-care-type" value={config.care_type} onChange={e => handleChange('care_type', e.target.value)}
              className={INPUT.select}>
              {['Residential', 'Nursing', 'Dementia', 'Mixed'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <Field label="Day Cycle Start Date" path="cycle_start_date" type="date" />
          <div>
            <label htmlFor="config-night-cycle-start-date" className={INPUT.label}>Night Cycle Start Date</label>
            <input
              id="config-night-cycle-start-date"
              type="date"
              value={config.cycle_start_date_night || ''}
              onChange={e => handleChange('cycle_start_date_night', e.target.value || undefined)}
              disabled={!canEdit}
              className={INPUT.sm}
            />
            <p className="mt-1 text-[11px] text-[var(--ink-3)]">
              Optional. Leave blank to use the day cycle start date.
            </p>
          </div>
        </div>
      </section>

      {/* Day Rotation Pattern */}
      <RotationPatternSection
        config={config}
        canEdit={canEdit}
        scope="day"
        onChangePattern={(patternOrNull) => {
          const next = JSON.parse(JSON.stringify(config));
          if (patternOrNull == null) {
            delete next.rotation_pattern;
          } else {
            next.rotation_pattern = patternOrNull;
          }
          setConfig(next);
          setSaved(false);
          setSaveError(null);
          setDirty(true);
        }}
      />

      {/* Night Rotation Pattern */}
      <RotationPatternSection
        config={config}
        canEdit={canEdit}
        scope="night"
        onChangePattern={(patternOrNull) => {
          const next = JSON.parse(JSON.stringify(config));
          if (patternOrNull == null) {
            delete next.rotation_pattern_night;
          } else {
            next.rotation_pattern_night = patternOrNull;
          }
          setConfig(next);
          setSaved(false);
          setSaveError(null);
          setDirty(true);
        }}
      />

      {/* Day Cycle Start Tuning */}
      <CycleStartTuningSection
        config={config}
        staff={staff}
        canEdit={canEdit}
        scope="day"
        onApplyOffset={(offsetDays) => {
          const base = parseDate(config.cycle_start_date || formatDate(new Date()));
          const newStart = formatDate(addDays(base, offsetDays));
          handleChange('cycle_start_date', newStart);
        }}
      />

      {/* Night Cycle Start Tuning */}
      <CycleStartTuningSection
        config={config}
        staff={staff}
        canEdit={canEdit}
        scope="night"
        onApplyOffset={(offsetDays) => {
          const effectiveStart = resolveCycleStartDateForScope(config, 'night', formatDate(new Date()));
          const base = parseDate(effectiveStart);
          const newStart = formatDate(addDays(base, offsetDays));
          handleChange('cycle_start_date_night', newStart);
        }}
      />

      {/* Shift Definitions */}
      <section className={`${CARD.flush} mb-5`}>
        <div className="p-5 pb-0">
          <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">Shift Times & Hours</h2>
        </div>
        <div className="space-y-3 px-5 pb-4 sm:hidden">
          {Object.entries(config.shifts || {}).map(([code, shift]) => (
            <div key={code} className="rounded-xl border border-[var(--line)] bg-[var(--paper-2)] p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="font-mono text-sm font-bold text-[var(--accent)]">{code}</span>
                <span className="text-xs font-medium text-[var(--ink-3)]">{shift.start || '--:--'} to {shift.end || '--:--'}</span>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label htmlFor={`config-mobile-shift-${code}-name`} className={INPUT.label}>Name</label>
                  <input id={`config-mobile-shift-${code}-name`} type="text" value={shift.name} onChange={e => handleChange(`shifts.${code}.name`, e.target.value)}
                    disabled={!canEdit}
                    className={INPUT.sm} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={`config-mobile-shift-${code}-start`} className={INPUT.label}>Start</label>
                    <input id={`config-mobile-shift-${code}-start`} type="time" value={shift.start} onChange={e => handleChange(`shifts.${code}.start`, e.target.value)}
                      disabled={!canEdit}
                      className={INPUT.sm} />
                  </div>
                  <div>
                    <label htmlFor={`config-mobile-shift-${code}-end`} className={INPUT.label}>End</label>
                    <input id={`config-mobile-shift-${code}-end`} type="time" value={shift.end} onChange={e => handleChange(`shifts.${code}.end`, e.target.value)}
                      disabled={!canEdit}
                      className={INPUT.sm} />
                  </div>
                </div>
                <div>
                  <label htmlFor={`config-mobile-shift-${code}-hours`} className={INPUT.label}>Hours</label>
                  <input id={`config-mobile-shift-${code}-hours`} type="number" step="0.25" value={shift.hours}
                    onChange={e => handleChange(`shifts.${code}.hours`, parseFloat(e.target.value) || 0)}
                    disabled={!canEdit}
                    className={INPUT.sm} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className={`${TABLE.wrapper} hidden sm:block`}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Code</th>
                <th scope="col" className={TABLE.th}>Name</th>
                <th scope="col" className={TABLE.th}>Start</th>
                <th scope="col" className={TABLE.th}>End</th>
                <th scope="col" className={TABLE.th}>Hours</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(config.shifts || {}).map(([code, shift]) => (
                <tr key={code} className={TABLE.tr}>
                  <td className={TABLE.tdMono}><span className="font-bold">{code}</span></td>
                  <td className={TABLE.td}>
                    <input type="text" value={shift.name} onChange={e => handleChange(`shifts.${code}.name`, e.target.value)}
                      aria-label={`${code} shift name`}
                      className={INPUT.sm} />
                  </td>
                  <td className={TABLE.td}>
                    <input type="time" value={shift.start} onChange={e => handleChange(`shifts.${code}.start`, e.target.value)}
                      aria-label={`${code} shift start time`}
                      className={INPUT.sm} />
                  </td>
                  <td className={TABLE.td}>
                    <input type="time" value={shift.end} onChange={e => handleChange(`shifts.${code}.end`, e.target.value)}
                      aria-label={`${code} shift end time`}
                      className={INPUT.sm} />
                  </td>
                  <td className={TABLE.td}>
                    <input type="number" step="0.25" value={shift.hours}
                      onChange={e => handleChange(`shifts.${code}.hours`, parseFloat(e.target.value) || 0)}
                      aria-label={`${code} shift hours`}
                      className={`${INPUT.sm} w-20`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-5 pt-4" />
      </section>

      {/* Minimum Staffing */}
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">Minimum Staffing Levels</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {['early', 'late', 'night'].map(period => (
            <div key={period} className="rounded-xl border border-[var(--line)] bg-[var(--paper-2)] p-4">
              <h3 className="mb-3 font-semibold capitalize text-[var(--ink-2)]">{period} Shift</h3>
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
        <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">Overtime & Agency</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <Field label="OT Premium" path="ot_premium" step={0.5} unit="/hr" />
          <Field label="Agency Day Rate" path="agency_rate_day" unit="/hr" />
          <Field label="Agency Night Rate" path="agency_rate_night" unit="/hr" />
          <Field label="Sleep-In Rate (£ flat per night)" path="sleep_in_rate" step={0.01} unit="/night" />
        </div>
      </section>

      {/* Safety Limits */}
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">Safety Limits</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <Field label="Max Consecutive Days" path="max_consecutive_days" />
          <Field label="Max AL Same Day" path="max_al_same_day" />
        </div>
        <div className="mt-4 space-y-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--ink-2)]">
            <input type="checkbox" checked={!!config.enforce_onboarding_blocking}
              onChange={e => handleChange('enforce_onboarding_blocking', e.target.checked)} className="accent-blue-600" />
            Warn when rostering staff with incomplete onboarding (DBS, RTW, references, identity)
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--ink-2)]">
            <input type="checkbox" checked={!!config.enforce_training_blocking}
              onChange={e => handleChange('enforce_training_blocking', e.target.checked)} className="accent-blue-600" />
            Warn when rostering staff with expired critical training (fire safety, moving &amp; handling, safeguarding)
          </label>
        </div>
        <div className="mt-4 border-t border-[var(--line)] pt-4">
          <label htmlFor="config-edit-lock-pin" className={INPUT.label}>Past-Date Edit PIN (4–6 digits)</label>
          <input
            id="config-edit-lock-pin"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={config.edit_lock_pin || ''}
            onChange={e => handleChange('edit_lock_pin', e.target.value.replace(/\D/g, ''))}
            placeholder="Leave blank to disable locking"
            className={`${INPUT.sm} w-40`}
          />
          {config.edit_lock_pin && String(config.edit_lock_pin).length < 4 && (
            <p className="mt-1 text-xs text-[var(--alert)]">PIN must be at least 4 digits</p>
          )}
          <p className="mt-1 text-xs text-[var(--ink-4)]">
            Managers must enter this PIN to edit any date before today. Session-only — refreshing the page re-locks.
          </p>
        </div>
      </section>

      {/* Staff Portal & Clock-In */}
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">Staff Portal & Clock-In</h2>
        <div className="grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr] gap-6">
          <div className="space-y-3">
            <label className={`flex items-start gap-3 text-sm text-[var(--ink-2)] ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}>
              <input
                type="checkbox"
                checked={!!config.clock_in_required}
                onChange={(e) => handleChange('clock_in_required', e.target.checked)}
                disabled={!canEdit}
                className="mt-0.5 accent-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <span>
                <span className="block font-medium text-[var(--ink)]">Enable staff clock-in for this home</span>
                <span className="mt-1 block text-xs text-[var(--ink-3)]">
                  Staff can use the staff portal to clock in and out. GPS auto-approval only works when the geofence is set below.
                </span>
              </span>
            </label>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              Staff portal access itself is controlled by the server-side <code>ENABLE_STAFF_PORTAL</code> flag.
              These settings only control this home&apos;s clock-in behaviour.
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            <Field label="Geofence Latitude" path="geofence_lat" step={0.000001} />
            <Field label="Geofence Longitude" path="geofence_lng" step={0.000001} />
            <Field label="Geofence Radius" path="geofence_radius_m" unit="m" />
            <Field label="Early Clock-In Window" path="clock_in_early_min" unit="min" />
            <Field label="Late Clock-In Window" path="clock_in_late_min" unit="min" />
          </div>
        </div>
      </section>

      {/* Annual Leave */}
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">Annual Leave</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <div>
            <label className={INPUT.label}>AL Entitlement</label>
            <p className="mt-1 text-xs text-[var(--ink-3)]">Auto: 5.6 x contracted weekly hours.<br/>Override per staff in Staff Database.</p>
          </div>
          <Field label="Avg AL Per Day" path="avg_al_per_day" unit="people" />
          <div>
            <label className={INPUT.label}>Carryover</label>
            <p className="mt-1 text-xs text-[var(--ink-3)]">Set per staff in hours (Staff Database).</p>
          </div>
          <div>
            <label htmlFor="config-leave-year-start" className={INPUT.label}>Leave Year Start</label>
            <select id="config-leave-year-start" value={config.leave_year_start || '04-01'}
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
              const thisYr = new Date(Date.UTC(now.getUTCFullYear(), mm - 1, dd));
              const start = now >= thisYr ? thisYr : new Date(Date.UTC(now.getUTCFullYear() - 1, mm - 1, dd));
              const end = new Date(start); end.setUTCFullYear(end.getUTCFullYear() + 1); end.setUTCDate(end.getUTCDate() - 1);
              const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
              return <p className="mt-1 text-xs text-[var(--ink-4)]">Current: {fmt(start)} – {fmt(end)}</p>;
            })()}
          </div>
        </div>
      </section>

      {/* Weekly Hours Targets */}
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">Weekly Hours Targets</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          <Field label="FT Target (EL)" path="ft_target_el" step={0.5} unit="hrs/wk" />
          <Field label="FT Target (E/L only)" path="ft_target_partial" step={0.5} unit="hrs/wk" />
          <Field label="Night FT Target" path="night_ft_target" step={0.5} unit="hrs/wk" />
        </div>
      </section>

      {/* Bank Holiday & Sickness */}
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">Bank Holiday & Sickness</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <Field label="BH Premium Multiplier" path="bh_premium_multiplier" step={0.1} unit="x" />
          <Field label="Sickness Rate" path="sickness_rate" step={0.01} />
          <Field label="Night Gap %" path="night_gap_pct" step={0.05} />
          <div>
            <Field label="NLW Rate (21+)" path="nlw_rate" step={0.01} unit="/hr" />
            <Field label="NMW Rate (18-20)" path="nmw_rate_18_20" step={0.01} unit="/hr" />
            <Field label="NMW Rate (U18)" path="nmw_rate_under_18" step={0.01} unit="/hr" />
            {(() => {
              const below = staff.filter(s => s.active !== false && isCareRole(s.role) && (() => {
                const { rate } = getMinimumWageRate(s.date_of_birth, config);
                return s.hourly_rate < rate;
              })());
              return below.length > 0 ? (
                <p className="mt-1 text-xs text-[var(--alert)]">{below.length} staff below minimum wage for their age</p>
              ) : null;
            })()}
          </div>
        </div>
      </section>

      {/* Fortification */}
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">Fortification Parameters</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <Field label="Emergency Call-In Premium" path="emergency_callin_premium" step={0.1} unit="x" />
          <Field label="Manager Floor Rate" path="manager_floor_rate" unit="/hr" />
          <Field label="Winter Sick Uplift" path="winter_sick_uplift" step={0.1} unit="x" />
          <Field label="Agency Availability %" path="agency_availability_pct" step={0.1} />
          <Field label="Bank Staff Pool" path="bank_staff_pool_size" />
        </div>
      </section>

      {/* Budget Targets */}
      <section className={`${CARD.padded} mb-5`}>
        <h2 className="mb-4 text-lg font-semibold text-[var(--ink)]">Budget Targets</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          <Field label="Monthly Staff Budget" path="monthly_staff_budget" unit="/month" />
          <Field label="Monthly Agency Cap" path="monthly_agency_cap" unit="/month" />
        </div>
        <p className="mt-2 text-xs text-[var(--ink-4)]">Used by Budget vs Actual page. Per-month overrides can be set there.</p>
      </section>

      {/* Bank Holidays List */}
      <section className={CARD.padded}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Bank Holidays</h2>
          <button onClick={async () => {
            setSyncStatus({ loading: true });
            try {
              const region = config.bank_holiday_region || 'england-and-wales';
              const result = await syncBankHolidays(config.bank_holidays, region);
              handleChange('bank_holidays', result.holidays);
              setSyncStatus({ success: true, msg: `Synced via ${result.source} — ${result.added} new holidays added (${result.holidays.length} total)` });
              setTimeout(() => setSyncStatus(null), 5000);
            } catch (err) {
              setSyncStatus({ error: true, msg: 'Sync failed: ' + err.message });
              setTimeout(() => setSyncStatus(null), 5000);
            }
          }} disabled={syncStatus?.loading}
            className={`${BTN.primary} ${BTN.sm}`}>
            {syncStatus?.loading ? 'Syncing...' : 'Sync UK Bank Holidays'}
          </button>
        </div>
        <div className="mb-4 max-w-sm">
          <label className={INPUT.label}>Bank Holiday Region</label>
          <select
            aria-label="Bank Holiday Region"
            value={config.bank_holiday_region || 'england-and-wales'}
            onChange={(e) => handleChange('bank_holiday_region', e.target.value)}
            className={INPUT.select}
          >
            {BANK_HOLIDAY_REGIONS.map((region) => (
              <option key={region.value} value={region.value}>{region.label}</option>
            ))}
          </select>
        </div>
        {syncStatus && !syncStatus.loading && (
          <InlineNotice
            variant={syncStatus.success ? 'success' : 'error'}
            className="mb-3"
            onDismiss={() => setSyncStatus(null)}
          >
            {syncStatus.msg}
          </InlineNotice>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 mb-3">
          {config.bank_holidays?.map((bh, i) => (
            <div key={i} className={`flex items-center justify-between ${BADGE.pink} !rounded-xl !px-3 !py-2 !text-sm`}>
              <div>
                <div className="font-medium text-xs">{bh.name}</div>
                <div className="text-[10px] text-[var(--ink-3)]">{bh.date}</div>
              </div>
              <button onClick={() => {
                const newBH = [...config.bank_holidays];
                newBH.splice(i, 1);
                handleChange('bank_holidays', newBH);
              }} className="ml-2 text-xs text-[var(--alert)] transition-colors duration-150 hover:brightness-90">X</button>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <input type="date" value={newBhDate} onChange={e => setNewBhDate(e.target.value)} aria-label="New bank holiday date" className={INPUT.sm} />
          <input type="text" value={newBhName} onChange={e => setNewBhName(e.target.value)} aria-label="New bank holiday name" placeholder="Holiday name" className={`${INPUT.sm} flex-1`} />
          <button onClick={() => {
            if (newBhDate && newBhName) {
              handleChange('bank_holidays', [...(config.bank_holidays || []), { date: newBhDate, name: newBhName }]);
              setNewBhDate('');
              setNewBhName('');
            }
          }} className={`${BTN.primary} ${BTN.sm}`}>Add</button>
        </div>
      </section>
    </div>
  );
}

// ── Rotation Pattern section ─────────────────────────────────────────────────

function RotationPatternSection({ config, canEdit, onChangePattern, scope = 'day' }) {
  const isNightScope = scope === 'night';
  const title = isNightScope ? 'Night Rotation Pattern' : 'Rotation Pattern';
  const activeCycleLength = resolveCycleLengthForScope(config, scope);
  const description = isNightScope
    ? `How work-days alternate across your ${activeCycleLength}-day night rota. Night A / Night B can follow a separate pattern from the day teams. If unset, night staff inherit the day pattern above.`
    : `How work-days alternate across your ${activeCycleLength}-day rota. Day A / Day B working patterns; existing overrides (sick, AL, agency) always take precedence over the pattern.`;
  const patternKey = isNightScope ? 'rotation_pattern_night' : 'rotation_pattern';
  const effectiveCycleStart = resolveCycleStartDateForScope(config, scope, formatDate(new Date()));
  const currentTeams = resolvePatternForScope(config, scope);
  const currentPresetId = config?.[patternKey]?.preset_id ?? null;
  const hasCustom = Boolean(config?.[patternKey]);
  const [linkComplement, setLinkComplement] = useState(true);

  const matchedPreset = useMemo(() => {
    return ROTATION_PRESETS.find(p =>
      p.teams.A.length === currentTeams.A.length &&
      p.teams.B.length === currentTeams.B.length &&
      p.teams.A.every((v, i) => v === currentTeams.A[i]) &&
      p.teams.B.every((v, i) => v === currentTeams.B[i])
    );
  }, [currentTeams]);

  const displayPresetId = currentPresetId ?? matchedPreset?.id ?? '';

  function applyPreset(presetId) {
    if (!canEdit) return;
    if (!presetId) {
      // "Custom" selected — clear preset_id but keep current teams
      onChangePattern({ preset_id: null, teams: { A: [...currentTeams.A], B: [...currentTeams.B] } });
      return;
    }
    const preset = ROTATION_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    onChangePattern({ preset_id: preset.id, teams: { A: [...preset.teams.A], B: [...preset.teams.B] } });
  }

  function resetToDefault() {
    if (!canEdit) return;
    onChangePattern(null);
  }

  function toggleCell(team, i) {
    if (!canEdit) return;
    const nextA = [...currentTeams.A];
    const nextB = [...currentTeams.B];
    if (team === 'A') {
      nextA[i] = nextA[i] === 1 ? 0 : 1;
      if (linkComplement) nextB[i] = nextA[i] === 1 ? 0 : 1;
    } else {
      nextB[i] = nextB[i] === 1 ? 0 : 1;
      if (linkComplement) nextA[i] = nextB[i] === 1 ? 0 : 1;
    }
    onChangePattern({ preset_id: null, teams: { A: nextA, B: nextB } });
  }

  // Next 28 days preview — which team would be working on each day
  const cycleStart = effectiveCycleStart;
  const previewDays = useMemo(() => {
    const today = parseDate(formatDate(new Date()));
    const rows = [];
    for (let i = 0; i < 28; i++) {
      const date = addDays(today, i);
      const cd = getCycleDay(date, cycleStart, activeCycleLength);
      rows.push({
        date,
        dateStr: formatDate(date),
        weekday: date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
        dayLabel: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
        aWorking: currentTeams.A[cd] === 1,
        bWorking: currentTeams.B[cd] === 1,
      });
    }
    return rows;
  }, [activeCycleLength, currentTeams, cycleStart]);

  return (
    <section className={`${CARD.padded} mb-5`}>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-[var(--ink)]">{title}</h2>
        {hasCustom && canEdit && (
          <button type="button" onClick={resetToDefault} className={`${BTN.ghost} ${BTN.xs}`}>
            {isNightScope ? 'Inherit day pattern' : 'Reset to Panama default'}
          </button>
        )}
      </div>
      <p className="mb-4 text-xs text-[var(--ink-3)]">
        {description}
      </p>
      {isNightScope && !hasCustom && (
        <div className="mb-4">
          <span className={`${BADGE.amber} text-[11px]`}>
            Using the day-team pattern until you customise nights.
          </span>
        </div>
      )}

      {/* Preset picker */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label htmlFor={`config-${scope}-rotation-preset`} className="text-xs font-medium text-[var(--ink-2)]">Preset:</label>
        <select
          id={`config-${scope}-rotation-preset`}
          value={displayPresetId}
          onChange={e => applyPreset(e.target.value)}
          disabled={!canEdit}
          className={INPUT.sm}
          style={{ minWidth: 220 }}
        >
          <option value="">— Custom —</option>
          {ROTATION_PRESETS.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {matchedPreset && (
          <span className="text-xs text-[var(--ink-3)]">{matchedPreset.description}</span>
        )}
      </div>

      {/* Editor grid */}
      <div className="mb-4 space-y-1.5">
        <div className="flex items-center gap-1 overflow-x-auto">
          <span className="w-14 shrink-0 font-mono text-xs text-[var(--ink-3)]">Day</span>
          {Array.from({ length: activeCycleLength }, (_, i) => (
            <span key={i} className="w-8 shrink-0 text-center font-mono text-[10px] text-[var(--ink-4)]">{i + 1}</span>
          ))}
        </div>
        {['A', 'B'].map(team => (
          <div key={team} className="flex items-center gap-1 overflow-x-auto">
            <span className="w-14 shrink-0 text-xs font-semibold text-[var(--ink-2)]">
              {isNightScope ? `Night ${team}` : `Team ${team}`}
            </span>
            {currentTeams[team].map((val, i) => (
              <button
                key={i}
                type="button"
                disabled={!canEdit}
                onClick={() => toggleCell(team, i)}
                aria-label={`Team ${team} day ${i + 1}: ${val === 1 ? 'working' : 'off'} — click to toggle`}
                className={`h-8 w-8 shrink-0 rounded text-[11px] font-semibold transition-colors ${
                  val === 1
                    ? 'border border-[var(--ok)] bg-[var(--ok-soft)] text-[var(--ok)] hover:brightness-95'
                    : 'border border-[var(--line)] bg-[var(--paper-2)] text-[var(--ink-4)] hover:bg-[var(--paper-3)]'
                } disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                {val === 1 ? 'On' : 'Off'}
              </button>
            ))}
          </div>
        ))}
      </div>

      <label className="mb-4 inline-flex items-center gap-2 text-xs text-[var(--ink-2)]">
        <input
          type="checkbox"
          checked={linkComplement}
          onChange={e => setLinkComplement(e.target.checked)}
          disabled={!canEdit}
        />
        Keep A and B complementary (toggling one flips the other)
      </label>

      {/* Preview */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">Preview — next 28 days</h3>
        <p className="mb-2 text-[11px] text-[var(--ink-3)]">
          Anchored to <span className="font-mono text-[var(--ink-2)]">{cycleStart}</span>
          {isNightScope && !config?.cycle_start_date_night ? ' (currently inheriting the day cycle start date).' : '.'}
        </p>
        <div className="grid grid-cols-7 gap-1 text-[11px]">
          {previewDays.map(row => (
            <div key={row.dateStr} className="rounded border border-[var(--line)] bg-[var(--paper)] px-1.5 py-1 leading-tight">
              <div className="flex items-center justify-between">
                <span className="text-[var(--ink-4)]">{row.weekday}</span>
                <span className="text-[var(--ink-3)]">{row.dayLabel}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1">
                <span className={`rounded px-1 text-[10px] font-semibold ${row.aWorking ? 'bg-[var(--ok-soft)] text-[var(--ok)]' : 'bg-[var(--paper-2)] text-[var(--ink-4)]'}`}>
                  {isNightScope ? 'NA' : 'A'}
                </span>
                <span className={`rounded px-1 text-[10px] font-semibold ${row.bWorking ? 'bg-[var(--ok-soft)] text-[var(--ok)]' : 'bg-[var(--paper-2)] text-[var(--ink-4)]'}`}>
                  {isNightScope ? 'NB' : 'B'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Cycle Start Tuning section ───────────────────────────────────────────────

function CycleStartTuningSection({ config, staff, canEdit, onApplyOffset, scope = 'day' }) {
  const { confirm, ConfirmDialog } = useConfirm();
  const isNightScope = scope === 'night';
  const title = isNightScope ? 'Night Cycle Start Tuning' : 'Cycle Start Tuning';
  const targetKey = isNightScope ? 'cycle_start_date_night' : 'cycle_start_date';
  const activeCycleLength = resolveCycleLengthForScope(config, scope);
  const effectiveStart = resolveCycleStartDateForScope(config, scope, formatDate(new Date()));
  const relevantStaffCount = useMemo(
    () => (staff || []).filter(s => s.active !== false && (isNightScope ? s.team?.startsWith('Night') : !s.team?.startsWith('Night'))).length,
    [staff, isNightScope],
  );
  const [scores, setScores] = useState(null);

  const analyse = useCallback(() => {
    const results = [];
    for (let offset = 0; offset < activeCycleLength; offset++) {
      const s = scoreCycleStartOffset(config, staff, offset, new Date(), { scope });
      results.push({ offset, ...s });
    }
    setScores(results);
  }, [activeCycleLength, config, staff, scope]);

  const maxRatio = useMemo(() => scores ? Math.max(...scores.map(s => s.ratio)) : 0, [scores]);

  return (
    <>
    <section className={`${CARD.padded} mb-5`}>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-[var(--ink)]">{title}</h2>
        <button
          type="button"
          onClick={analyse}
          disabled={!relevantStaffCount}
          className={`${BTN.secondary} ${BTN.sm}`}
        >
          Analyse all {activeCycleLength} offsets
        </button>
      </div>
      <p className="mb-4 text-xs text-[var(--ink-3)]">
        {isNightScope ? 'Night' : 'Day'} rotation repeats every {activeCycleLength} days, but which weekday each
        cycle day lands on depends on <span className="font-mono text-[var(--ink-2)]">{targetKey}</span>.
        Shifting the start by 1–{Math.max(activeCycleLength - 1, 1)} days rearranges coverage across the week. Scores below show the fraction
        of period-slots that would be fully covered across the next 28 days for the current {isNightScope ? 'night' : 'day'} rota.
      </p>
      <p className="mb-4 text-[11px] text-[var(--ink-3)]">
        Current effective start: <span className="font-mono text-[var(--ink-2)]">{effectiveStart}</span>
        {isNightScope && !config?.cycle_start_date_night ? ' (currently inheriting the day cycle start date).' : '.'}
      </p>

      {scores == null ? (
        <p className="text-xs text-[var(--ink-4)]">Click <em>Analyse all {activeCycleLength} offsets</em> to compute coverage for every possible start offset.</p>
      ) : (
        <div className="space-y-1.5">
          {scores.map(s => (
            <div key={s.offset} className="flex items-center gap-2 text-xs">
              <span className="w-20 shrink-0 text-[var(--ink-3)]">
                {s.offset === 0 ? 'current' : `+${s.offset}d`}
              </span>
              <div className="relative h-5 flex-1 overflow-hidden rounded bg-[var(--paper-3)]">
                <div
                  className={`h-full ${s.ratio === maxRatio ? 'bg-[var(--ok)]' : 'bg-[var(--info)] opacity-60'}`}
                  style={{ width: `${Math.round(s.ratio * 100)}%` }}
                />
                <span className="absolute inset-0 flex items-center px-2 text-[11px] font-semibold text-[var(--ink)]">
                  {s.covered}/{s.total} ({Math.round(s.ratio * 100)}%)
                </span>
              </div>
              {s.offset !== 0 && canEdit && (
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'Apply Cycle Offset',
                      message: `Shift ${targetKey} by ${s.offset} day${s.offset === 1 ? '' : 's'}? ${isNightScope ? 'Night teams' : 'Day teams'} will re-align.`,
                      confirmLabel: 'Apply',
                      tone: 'danger',
                    });
                    if (ok) onApplyOffset(s.offset);
                  }}
                  className={`${BTN.ghost} ${BTN.xs} shrink-0`}
                >
                  Apply
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
    {ConfirmDialog}
    </>
  );
}
