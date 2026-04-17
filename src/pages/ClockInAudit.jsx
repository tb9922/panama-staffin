import { useCallback, useEffect, useState } from 'react';
import { BADGE, BTN, INPUT, PAGE } from '../lib/design.js';
import { approveClockIn, createManualClockIn, getClockInUnapproved, getClockInsByDate, getCurrentHome } from '../lib/api.js';
import { useData } from '../contexts/DataContext.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import { todayLocalISO } from '../lib/localDates.js';

const TODAY = todayLocalISO();

export default function ClockInAudit() {
  const { canWrite } = useData();
  const canEdit = canWrite('payroll');
  const homeSlug = getCurrentHome();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState([]);
  const [date, setDate] = useState(TODAY);
  const [daily, setDaily] = useState([]);
  const [manual, setManual] = useState({
    staffId: '',
    clockType: 'in',
    shiftDate: TODAY,
    note: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!homeSlug) return;
    try {
      setLoading(true);
      setError('');
      const [pendingRows, dailyRows] = await Promise.all([
        getClockInUnapproved(homeSlug),
        getClockInsByDate(homeSlug, date),
      ]);
      setPending(pendingRows);
      setDaily(dailyRows);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug, date]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleApprove(item) {
    if (!canEdit) return;
    try {
      await approveClockIn(homeSlug, item.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleManual(event) {
    event.preventDefault();
    if (!canEdit) return;
    setSubmitting(true);
    setError('');
    try {
      await createManualClockIn(homeSlug, manual);
      setManual({
        staffId: '',
        clockType: 'in',
        shiftDate: todayLocalISO(),
        note: '',
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && pending.length === 0 && daily.length === 0) {
    return <LoadingState message="Loading clock-ins..." className={PAGE.container} card />;
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Clock-In Audit</h1>
          <p className={PAGE.subtitle}>Review geofenced clock-ins, approve exceptions, and add manual entries.</p>
        </div>
      </div>

      {error && <ErrorState title="Clock-in audit error" message={error} className="mb-4" />}
      {!canEdit && (
        <InlineNotice variant="info" className="mb-4">
          Read-only — you do not have payroll write access. Approve and manual clock-in actions are disabled.
        </InlineNotice>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Awaiting approval</h2>
          <div className="mt-4 space-y-3">
            {pending.length === 0 ? (
              <EmptyState compact title="No unapproved clock-ins" description="New exceptions will appear here." />
            ) : pending.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-900">Staff {item.staffId}</p>
                      <span className={item.clockType === 'in' ? BADGE.blue : BADGE.purple}>{item.clockType}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{new Date(item.serverTime).toLocaleString('en-GB')}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {item.withinGeofence == null ? 'Manual / no GPS' : item.withinGeofence ? 'Inside geofence' : 'Outside geofence'}
                      {item.distanceM != null ? ` • ${Math.round(item.distanceM)}m` : ''}
                      {item.accuracyM != null ? ` • ±${Math.round(item.accuracyM)}m accuracy` : ''}
                    </p>
                  </div>
                  {canEdit && (
                    <button type="button" className={`${BTN.success} ${BTN.sm}`} onClick={() => void handleApprove(item)}>
                      Approve
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-6">
          {canEdit && (
            <form onSubmit={handleManual} className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-semibold text-slate-900">Manual clock-in</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className={INPUT.label}>Staff ID</label>
                  <input className={INPUT.base} value={manual.staffId} onChange={(e) => setManual((current) => ({ ...current, staffId: e.target.value }))} required />
                </div>
                <div>
                  <label className={INPUT.label}>Type</label>
                  <select className={INPUT.select} value={manual.clockType} onChange={(e) => setManual((current) => ({ ...current, clockType: e.target.value }))}>
                    <option value="in">Clock in</option>
                    <option value="out">Clock out</option>
                  </select>
                </div>
                <div>
                  <label className={INPUT.label}>Shift date</label>
                  <input type="date" className={INPUT.base} value={manual.shiftDate} onChange={(e) => setManual((current) => ({ ...current, shiftDate: e.target.value }))} required />
                </div>
                <div>
                  <label className={INPUT.label}>Note</label>
                  <input className={INPUT.base} value={manual.note} onChange={(e) => setManual((current) => ({ ...current, note: e.target.value }))} />
                </div>
              </div>
              <div className="mt-5 flex justify-end">
                <button type="submit" className={BTN.secondary} disabled={submitting}>
                  {submitting ? 'Saving...' : 'Add manual entry'}
                </button>
              </div>
            </form>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Clock-ins by date</h2>
              <input type="date" className={INPUT.sm} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="mt-4 space-y-3">
              {daily.length === 0 ? (
                <EmptyState compact title="No clock-ins for this date" description="Try a different date." />
              ) : daily.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900">Staff {item.staffId}</p>
                      <p className="text-sm text-slate-500">{new Date(item.serverTime).toLocaleString('en-GB')}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {item.withinGeofence == null ? 'Manual / no GPS' : item.withinGeofence ? 'Inside geofence' : 'Outside geofence'}
                        {item.distanceM != null ? ` • ${Math.round(item.distanceM)}m` : ''}
                        {item.accuracyM != null ? ` • ±${Math.round(item.accuracyM)}m accuracy` : ''}
                      </p>
                    </div>
                    <span className={item.approved ? BADGE.green : BADGE.amber}>{item.approved ? 'approved' : 'pending'}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}
