import { useCallback, useEffect, useState } from 'react';
import { BADGE, BTN } from '../../lib/design.js';
import { decideOverrideRequest, getPendingOverrideRequests } from '../../lib/api.js';
import { getCurrentHome } from '../../lib/api.js';
import LoadingState from '../LoadingState.jsx';
import ErrorState from '../ErrorState.jsx';
import EmptyState from '../EmptyState.jsx';

export default function OverrideRequestReview() {
  const homeSlug = getCurrentHome();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setRows(await getPendingOverrideRequests(homeSlug));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug]);

  useEffect(() => {
    if (homeSlug) void load();
  }, [homeSlug, load]);

  async function handleDecision(item, status) {
    try {
      setError('');
      await decideOverrideRequest(homeSlug, item.id, {
        status,
        expectedVersion: item.version,
        decisionNote: '',
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Pending leave requests</h2>
          <p className="mt-1 text-sm text-slate-600">Approve or reject staff self-service annual leave requests.</p>
        </div>
        {loading && <LoadingState message="Refreshing..." compact />}
      </div>

      {error && <ErrorState title="Unable to load requests" message={error} className="mt-4" />}

      {loading && rows.length === 0 ? (
        <LoadingState message="Loading requests..." className="mt-4" />
      ) : rows.length === 0 ? (
        <EmptyState compact title="Nothing waiting" description="New leave requests will appear here." className="mt-4" />
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900">{item.date}</p>
                    <span className={BADGE.amber}>{item.requestType}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">Staff ID: {item.staffId}</p>
                  <p className="mt-1 text-sm text-slate-500">{item.reason || 'No reason provided'}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={`${BTN.secondary} ${BTN.sm}`} onClick={() => void handleDecision(item, 'rejected')}>
                    Reject
                  </button>
                  <button type="button" className={`${BTN.primary} ${BTN.sm}`} onClick={() => void handleDecision(item, 'approved')}>
                    Approve
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
