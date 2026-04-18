import { useEffect, useState } from 'react';
import { BADGE } from '../../lib/design.js';
import { getMySchedule } from '../../lib/api.js';
import LoadingState from '../../components/LoadingState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import EmptyState from '../../components/EmptyState.jsx';

export default function MySchedule() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    try {
      setLoading(true);
      setError('');
      setData(await getMySchedule());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <LoadingState message="Loading your rota..." className="p-6" />;
  if (error) return <div className="p-6"><ErrorState title="Unable to load your schedule" message={error} onRetry={() => void load()} /></div>;

  return (
    <div className="space-y-6 p-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-2xl font-bold text-slate-900">My Schedule</h2>
        <p className="mt-2 text-sm text-slate-600">Your next 28 days of rota and any overrides applied to you.</p>
      </div>
      {(!data?.days || data.days.length === 0) ? (
        <EmptyState title="No shifts found" description="Your rota will appear here once it's published." className="pb-6" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.days.map((day) => (
            <div key={day.date} className={`rounded-2xl border border-slate-200 bg-white p-5 ${day.isOverride ? 'border-blue-200 bg-blue-50/40' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">{day.date}</p>
                  <p className="text-sm text-slate-500">{day.scheduledShift ? `Scheduled ${day.scheduledShift}` : 'No scheduled shift'}</p>
                </div>
                <span className={day.shift === 'OFF' ? BADGE.gray : day.shift === 'AL' ? BADGE.amber : ['SICK', 'NS'].includes(day.shift) ? BADGE.pink : BADGE.blue}>
                  {day.shift}
                </span>
              </div>
              {day.reason && <p className="mt-3 text-sm text-slate-600">{day.reason}</p>}
              {day.isOverride && <p className="mt-2 text-xs font-medium uppercase tracking-[0.2em] text-blue-700">Override applied</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
