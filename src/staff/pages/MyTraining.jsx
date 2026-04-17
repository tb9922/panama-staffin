import { useEffect, useState } from 'react';
import { BADGE, BTN } from '../../lib/design.js';
import { acknowledgeMyTraining, getMyTraining } from '../../lib/api.js';
import LoadingState from '../../components/LoadingState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import EmptyState from '../../components/EmptyState.jsx';

export default function MyTraining() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    try {
      setLoading(true);
      setError('');
      setData(await getMyTraining());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleAcknowledge(typeId) {
    try {
      await acknowledgeMyTraining(typeId);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <LoadingState message="Loading training..." className="p-6" />;
  if (error && !data) return <div className="p-6"><ErrorState title="Unable to load training" message={error} onRetry={() => void load()} /></div>;

  return (
    <div className="space-y-6 p-6">
      {error && <ErrorState title="Training update failed" message={error} onRetry={() => void load()} />}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-2xl font-bold text-slate-900">My Training</h2>
        <p className="mt-2 text-sm text-slate-600">Check what's complete, expiring, or still missing.</p>
      </div>
      {(!data?.items || data.items.length === 0) ? (
        <EmptyState title="No training items" description="Training requirements will appear here when they are configured for your role." className="pb-6" />
      ) : (
        <div className="space-y-3">
          {data.items.map((item) => (
            <div key={item.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-slate-900">{item.name}</p>
                  <span className={item.status === 'complete' ? BADGE.green : item.status === 'expired' ? BADGE.red : BADGE.amber}>{item.status}</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {item.expiry ? `Expires ${item.expiry}` : 'No completion recorded yet'}
                  {item.acknowledgedByStaff && item.acknowledgedAt ? ` | Acknowledged ${new Date(item.acknowledgedAt).toLocaleDateString('en-GB')}` : ''}
                </p>
              </div>
              {item.status === 'complete' && !item.acknowledgedByStaff && (
                <button type="button" className={`${BTN.secondary} ${BTN.sm}`} onClick={() => void handleAcknowledge(item.id)}>
                  Acknowledge
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
