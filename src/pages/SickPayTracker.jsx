import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import { getSickPeriods, createSickPeriod, updateSickPeriod, getSSPConfig, getCurrentHome } from '../lib/api.js';

const EMPTY_CREATE = {
  staff_id: '', start_date: '', end_date: '',
  qualifying_days_per_week: 5, linked_to_period_id: '', notes: '',
};

const EMPTY_UPDATE = {
  end_date: '', fit_note_received: false, fit_note_date: '', notes: '',
};

function daysOpen(startDate, endDate) {
  const s = new Date(startDate);
  const e = endDate ? new Date(endDate) : new Date();
  return Math.round((e - s) / 86400000) + 1;
}

function needsFitNote(period) {
  if (period.fit_note_received) return false;
  return daysOpen(period.start_date, period.end_date) >= 7;
}

export default function SickPayTracker({ data, user }) {
  const homeSlug = getCurrentHome();
  const isAdmin  = user?.role === 'admin';

  const [periods, setPeriods]     = useState([]);
  const [sspConfig, setSSPConfig] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [saving, setSaving]       = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showUpdate, setShowUpdate] = useState(null); // period object to update
  const [createForm, setCreateForm] = useState(EMPTY_CREATE);
  const [updateForm, setUpdateForm] = useState(EMPTY_UPDATE);
  const [staffFilter, setStaffFilter] = useState('');

  const staffMap = {};
  (data?.staff || []).forEach(s => { staffMap[s.id] = s; });
  const activeStaff = (data?.staff || []).filter(s => s.active !== false);

  const load = useCallback(async () => {
    if (!homeSlug) return;
    try {
      setLoading(true);
      setError(null);
      const [perds, cfg] = await Promise.all([
        getSickPeriods(homeSlug),
        getSSPConfig(),
      ]);
      setPeriods(perds);
      setSSPConfig(cfg);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug]);

  useEffect(() => { load(); }, [load]);

  const openPeriods   = periods.filter(p => !p.end_date);
  const fitNoteAlerts = periods.filter(needsFitNote);

  const displayedPeriods = staffFilter
    ? periods.filter(p => p.staff_id === staffFilter)
    : periods;

  function cfield(k, v) { setCreateForm(f => ({ ...f, [k]: v })); }
  function ufield(k, v) { setUpdateForm(f => ({ ...f, [k]: v })); }

  async function handleCreate() {
    if (!createForm.staff_id || !createForm.start_date) return;
    setSaving(true);
    try {
      await createSickPeriod(homeSlug, {
        ...createForm,
        qualifying_days_per_week: parseInt(createForm.qualifying_days_per_week, 10) || 5,
        linked_to_period_id: createForm.linked_to_period_id || null,
        end_date: createForm.end_date || null,
      });
      setShowCreate(false);
      setCreateForm(EMPTY_CREATE);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate() {
    if (!showUpdate) return;
    setSaving(true);
    try {
      await updateSickPeriod(homeSlug, showUpdate.id, {
        end_date:          updateForm.end_date || null,
        fit_note_received: updateForm.fit_note_received,
        fit_note_date:     updateForm.fit_note_date || null,
        notes:             updateForm.notes || null,
      });
      setShowUpdate(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function openUpdateModal(period) {
    setUpdateForm({
      end_date:          period.end_date || '',
      fit_note_received: period.fit_note_received || false,
      fit_note_date:     period.fit_note_date || '',
      notes:             period.notes || '',
    });
    setShowUpdate(period);
  }

  if (loading) return <div className={PAGE.container}><p className="text-gray-500">Loading...</p></div>;

  return (
    <div className={PAGE.container}>
      {/* Header */}
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Sick Pay Tracker</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track sick periods, SSP eligibility, waiting days, and fit note requirements.
          </p>
        </div>
        {isAdmin && (
          <button className={BTN.primary} onClick={() => { setCreateForm(EMPTY_CREATE); setShowCreate(true); }}>
            Record Sick Period
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
      )}

      {/* Fit note alerts */}
      {fitNoteAlerts.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
          <strong>Fit note required for {fitNoteAlerts.length} staff member{fitNoteAlerts.length !== 1 ? 's' : ''}:</strong>{' '}
          {fitNoteAlerts.map(p => {
            const days = daysOpen(p.start_date, p.end_date);
            return `${staffMap[p.staff_id]?.name || p.staff_id} (${days} days)`;
          }).join(', ')}.{' '}
          A GP fit note is required for absences exceeding 7 calendar days.
        </div>
      )}

      {/* SSP config */}
      {sspConfig && (
        <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'SSP weekly rate', value: `£${parseFloat(sspConfig.weekly_rate).toFixed(2)}` },
            { label: 'Waiting days', value: sspConfig.waiting_days === 0 ? 'None (2026 rules)' : `${sspConfig.waiting_days} days` },
            { label: 'Max duration', value: `${sspConfig.max_weeks} weeks` },
            { label: 'LEL weekly', value: sspConfig.lel_weekly ? `£${parseFloat(sspConfig.lel_weekly).toFixed(2)}` : 'Abolished' },
          ].map(({ label, value }) => (
            <div key={label} className={`${CARD.padded} text-center`}>
              <div className="text-xs text-gray-500 mb-1">{label}</div>
              <div className="text-lg font-semibold text-gray-900">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Summary + filter */}
      <div className="mb-4 flex items-center gap-4">
        <div className="flex gap-3 flex-wrap text-sm">
          <span className={`px-3 py-1 rounded-full ${BADGE.amber}`}>
            {openPeriods.length} open
          </span>
          <span className={`px-3 py-1 rounded-full ${BADGE.gray}`}>
            {periods.length - openPeriods.length} closed
          </span>
          {fitNoteAlerts.length > 0 && (
            <span className={`px-3 py-1 rounded-full ${BADGE.red}`}>
              {fitNoteAlerts.length} fit note required
            </span>
          )}
        </div>
        <div className="ml-auto">
          <select
            className={INPUT.select + ' w-48'}
            value={staffFilter}
            onChange={e => setStaffFilter(e.target.value)}
          >
            <option value="">All staff</option>
            {activeStaff.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Sick periods table */}
      <div className={CARD.flush}>
        <table className={TABLE.table}>
          <thead className={TABLE.thead}>
            <tr>
              <th className={TABLE.th}>Staff Member</th>
              <th className={TABLE.th}>Start Date</th>
              <th className={TABLE.th}>End Date</th>
              <th className={TABLE.th}>Duration</th>
              <th className={TABLE.th}>Qualifying Days</th>
              <th className={TABLE.th}>Waiting Days</th>
              <th className={TABLE.th}>SSP Weeks Paid</th>
              <th className={TABLE.th}>Fit Note</th>
              <th className={TABLE.th}>Status</th>
              {isAdmin && <th className={TABLE.th}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {displayedPeriods.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 10 : 9} className="px-4 py-8 text-center text-gray-400 text-sm">
                  No sick periods recorded{staffFilter ? ' for this staff member' : ''}.
                </td>
              </tr>
            )}
            {displayedPeriods.map(period => {
              const staff = staffMap[period.staff_id];
              const isOpen = !period.end_date;
              const days = daysOpen(period.start_date, period.end_date);
              const fitNoteNeeded = needsFitNote(period);
              return (
                <tr key={period.id} className={TABLE.tr}>
                  <td className={TABLE.td}>
                    <div className="font-medium text-gray-900">{staff?.name || period.staff_id}</div>
                    {staff?.role && <div className="text-xs text-gray-400">{staff.role}</div>}
                  </td>
                  <td className={TABLE.td}>{period.start_date}</td>
                  <td className={TABLE.td}>{period.end_date || <span className="text-amber-600 font-medium">Open</span>}</td>
                  <td className={TABLE.td}>{days} day{days !== 1 ? 's' : ''}</td>
                  <td className={TABLE.td}>{period.qualifying_days_per_week}/wk</td>
                  <td className={TABLE.td}>{period.waiting_days_served}</td>
                  <td className={TABLE.td}>{parseFloat(period.ssp_weeks_paid || 0).toFixed(2)}</td>
                  <td className={TABLE.td}>
                    {period.fit_note_received ? (
                      <span className={`text-xs px-2 py-0.5 rounded ${BADGE.green}`}>
                        Received {period.fit_note_date || ''}
                      </span>
                    ) : fitNoteNeeded ? (
                      <span className={`text-xs px-2 py-0.5 rounded ${BADGE.red}`}>Required</span>
                    ) : days > 7 ? (
                      <span className={`text-xs px-2 py-0.5 rounded ${BADGE.amber}`}>Awaited</span>
                    ) : (
                      <span className="text-gray-400 text-xs">Not needed yet</span>
                    )}
                  </td>
                  <td className={TABLE.td}>
                    <span className={`text-xs px-2 py-0.5 rounded ${isOpen ? BADGE.amber : BADGE.gray}`}>
                      {isOpen ? 'Open' : 'Closed'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className={TABLE.td}>
                      <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => openUpdateModal(period)}>
                        Update
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-gray-400 space-y-1">
        <p>
          <strong>SSP calculation:</strong> Sick periods are matched against payroll line SICK shifts during
          calculateRun. SSP is calculated automatically based on qualifying days, waiting days, and the
          applicable SSP config rate.
        </p>
        <p>
          <strong>April 2026 changes:</strong> From 6 April 2026, waiting days are abolished (SSP payable from
          day 1) and the Lower Earnings Limit test is removed. The 2026 config row is pre-seeded.
        </p>
        <p>
          <strong>Linked periods:</strong> Sick periods within 8 weeks of a prior period are treated as
          linked — waiting days already served in the earlier period are not re-applied.
        </p>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className={MODAL.overlay}>
          <div className={MODAL.panel}>
            <h2 className={MODAL.title}>Record Sick Period</h2>

            <div className="space-y-4">
              <div>
                <label className={INPUT.label}>Staff Member</label>
                <select
                  className={INPUT.select}
                  value={createForm.staff_id}
                  onChange={e => cfield('staff_id', e.target.value)}
                >
                  <option value="">Select staff member...</option>
                  {activeStaff.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={INPUT.label}>Start Date</label>
                  <input type="date" className={INPUT.base}
                    value={createForm.start_date}
                    onChange={e => cfield('start_date', e.target.value)} />
                </div>
                <div>
                  <label className={INPUT.label}>End Date (leave blank if ongoing)</label>
                  <input type="date" className={INPUT.base}
                    value={createForm.end_date}
                    onChange={e => cfield('end_date', e.target.value)} />
                </div>
              </div>

              <div>
                <label className={INPUT.label}>Qualifying Days Per Week</label>
                <select
                  className={INPUT.select}
                  value={createForm.qualifying_days_per_week}
                  onChange={e => cfield('qualifying_days_per_week', e.target.value)}
                >
                  {[1, 2, 3, 4, 5, 6, 7].map(d => (
                    <option key={d} value={d}>{d} day{d !== 1 ? 's' : ''}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  The number of days this staff member is contracted to work per week. Default: 5.
                </p>
              </div>

              <div>
                <label className={INPUT.label}>Linked to Previous Period (optional)</label>
                <select
                  className={INPUT.select}
                  value={createForm.linked_to_period_id}
                  onChange={e => cfield('linked_to_period_id', e.target.value)}
                >
                  <option value="">None — new sick period</option>
                  {periods
                    .filter(p => p.staff_id === createForm.staff_id && p.end_date)
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        Period: {p.start_date} → {p.end_date} ({parseFloat(p.ssp_weeks_paid).toFixed(2)} SSP wks)
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className={INPUT.label}>Notes</label>
                <textarea className={INPUT.base} rows={2}
                  value={createForm.notes}
                  onChange={e => cfield('notes', e.target.value)}
                  placeholder="e.g. Self-certified absence, fit note requested" />
              </div>
            </div>

            <div className={MODAL.footer}>
              <button className={BTN.secondary} onClick={() => setShowCreate(false)} disabled={saving}>
                Cancel
              </button>
              <button
                className={BTN.primary}
                onClick={handleCreate}
                disabled={saving || !createForm.staff_id || !createForm.start_date}
              >
                {saving ? 'Saving...' : 'Record Period'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Update modal */}
      {showUpdate && (
        <div className={MODAL.overlay}>
          <div className={MODAL.panel}>
            <h2 className={MODAL.title}>
              Update Sick Period — {staffMap[showUpdate.staff_id]?.name || showUpdate.staff_id}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Started: {showUpdate.start_date}
              {showUpdate.end_date && ` | Ended: ${showUpdate.end_date}`}
            </p>

            <div className="space-y-4">
              <div>
                <label className={INPUT.label}>End Date (set to close period)</label>
                <input type="date" className={INPUT.base}
                  value={updateForm.end_date}
                  onChange={e => ufield('end_date', e.target.value)} />
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="fit_note"
                  checked={updateForm.fit_note_received}
                  onChange={e => ufield('fit_note_received', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <label htmlFor="fit_note" className="text-sm text-gray-700">Fit note received from GP</label>
              </div>

              {updateForm.fit_note_received && (
                <div>
                  <label className={INPUT.label}>Fit Note Date</label>
                  <input type="date" className={INPUT.base}
                    value={updateForm.fit_note_date}
                    onChange={e => ufield('fit_note_date', e.target.value)} />
                </div>
              )}

              <div>
                <label className={INPUT.label}>Notes</label>
                <textarea className={INPUT.base} rows={2}
                  value={updateForm.notes}
                  onChange={e => ufield('notes', e.target.value)}
                  placeholder="e.g. Fit note received, return to work interview completed" />
              </div>
            </div>

            <div className={MODAL.footer}>
              <button className={BTN.secondary} onClick={() => setShowUpdate(null)} disabled={saving}>
                Cancel
              </button>
              <button
                className={BTN.primary}
                onClick={handleUpdate}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
