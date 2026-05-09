import { useCallback, useEffect, useMemo, useState } from 'react';
import { BADGE, BTN } from '../../lib/design.js';
import { getMySchedule } from '../../lib/api.js';
import LoadingState from '../../components/LoadingState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { endOfLocalMonthISO, parseLocalDate, startOfLocalMonthISO } from '../../lib/localDates.js';

function monthWindow(offset) {
  return {
    from: startOfLocalMonthISO(new Date(), offset),
    to: endOfLocalMonthISO(new Date(), offset),
  };
}

function monthLabel(from) {
  const date = parseLocalDate(from);
  if (!date) return 'Selected month';
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(date);
}

function badgeForShift(shift) {
  if (shift === 'OFF') return BADGE.gray;
  if (shift === 'AL') return BADGE.amber;
  if (['SICK', 'NS'].includes(shift)) return BADGE.pink;
  return BADGE.blue;
}

export default function MySchedule() {
  const [data, setData] = useState(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const windowRange = useMemo(() => monthWindow(monthOffset), [monthOffset]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setData(await getMySchedule(windowRange));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [windowRange]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <LoadingState message="Loading your rota..." className="p-6" />;
  if (error && !data) {
    return (
      <div className="p-6">
        <ErrorState title="Unable to load your schedule" message={error} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">My Schedule</h2>
            <p className="mt-2 text-sm text-slate-600">Your rota and overrides for {monthLabel(windowRange.from)}.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${BTN.secondary} ${BTN.sm}`} onClick={() => setMonthOffset((value) => value - 1)}>
              Previous month
            </button>
            <button type="button" className={`${BTN.ghost} ${BTN.sm}`} onClick={() => setMonthOffset(0)} disabled={monthOffset === 0}>
              Current month
            </button>
            <button type="button" className={`${BTN.secondary} ${BTN.sm}`} onClick={() => setMonthOffset((value) => value + 1)}>
              Next month
            </button>
          </div>
        </div>
        {loading && <LoadingState message="Refreshing schedule..." compact />}
        {error && <ErrorState title="Unable to refresh your schedule" message={error} onRetry={() => void load()} className="mt-4" />}
      </div>
      {(!data?.days || data.days.length === 0) ? (
        <EmptyState title="No shifts found" description="Your rota will appear here once it's published." className="pb-6" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.days.map((day) => {
            const shift = day.shift || 'OFF';
            return (
              <div key={day.date} className={`rounded-2xl border border-slate-200 bg-white p-5 ${day.isOverride ? 'border-blue-200 bg-blue-50/40' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{day.date}</p>
                    <p className="text-sm text-slate-500">{day.scheduledShift ? `Scheduled ${day.scheduledShift}` : 'No scheduled shift'}</p>
                  </div>
                  <span className={badgeForShift(shift)}>{shift}</span>
                </div>
                {day.reason && <p className="mt-3 text-sm text-slate-600">{day.reason}</p>}
                {day.isOverride && <p className="mt-2 text-xs font-medium uppercase tracking-[0.2em] text-blue-700">Override applied</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
