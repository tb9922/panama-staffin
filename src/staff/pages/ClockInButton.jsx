import { useEffect, useState } from 'react';
import { BTN } from '../../lib/design.js';
import { getClockInState, recordClockIn } from '../../lib/api.js';
import LoadingState from '../../components/LoadingState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import { useData } from '../../contexts/DataContext.jsx';

export default function ClockInButton() {
  const { activeHomeObj } = useData();
  const clockInRequired = Boolean(activeHomeObj?.clockInRequired ?? activeHomeObj?.config?.clock_in_required);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      setLoading(true);
      setError('');
      setState(await getClockInState());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!clockInRequired) {
      setLoading(false);
      setState(null);
      return;
    }
    void load();
  }, [clockInRequired]);

  function geolocationErrorMessage(err) {
    // Browsers expose GeolocationPositionError with code 1/2/3. The plain
    // err.message is too cryptic for staff ("User denied Geolocation"). Branch
    // here so we can give actionable copy + offer the manager-fallback hint.
    const code = err?.code;
    if (code === 1 /* PERMISSION_DENIED */) {
      return 'Location permission was denied. Enable location access in your browser settings, or ask your manager to record this clock-in manually.';
    }
    if (code === 2 /* POSITION_UNAVAILABLE */) {
      return 'Cannot get a location fix right now. If you are inside the building, try moving near a window — or ask your manager to record this clock-in manually.';
    }
    if (code === 3 /* TIMEOUT */) {
      return 'Location is taking too long. Check that location services are on for this browser, then try again.';
    }
    return err?.message || 'Clock-in failed.';
  }

  async function handleClock() {
    if (!navigator.geolocation) {
      setError('This device does not support location-based clock-in. Ask your manager to record this clock-in manually.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });
      });
      await recordClockIn({
        clockType: state?.nextAction || 'in',
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracyM: position.coords.accuracy,
        clientTime: new Date().toISOString(),
      });
      await load();
    } catch (err) {
      // GeolocationPositionError has `code` but not always `message`; API errors have `message`.
      setError(typeof err?.code === 'number' ? geolocationErrorMessage(err) : (err?.message || 'Clock-in failed.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (!clockInRequired) return null;
  if (loading) return <LoadingState message="Checking clock-in status..." compact />;
  if (error && !state) return <ErrorState title="Clock-in unavailable" message={error} />;

  return (
    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Clock-in</p>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">
            {state?.nextAction === 'out' ? 'Ready to clock out?' : 'Ready to clock in?'}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {state?.lastClock
              ? `Last clock ${state.lastClock.clockType} at ${new Date(state.lastClock.serverTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`
              : "Use your device location to clock against today's shift."}
          </p>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
        <button type="button" className={`${BTN.success} min-w-40`} disabled={submitting} onClick={handleClock}>
          {submitting ? 'Checking location...' : state?.nextAction === 'out' ? 'Clock out' : 'Clock in'}
        </button>
      </div>
    </div>
  );
}
