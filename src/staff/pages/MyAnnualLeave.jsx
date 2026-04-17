import { useEffect, useState } from 'react';
import { BADGE, BTN, INPUT } from '../../lib/design.js';
import { cancelMyOverrideRequest, createMyLeaveRequest, getMyAccrual, getMyOverrideRequests } from '../../lib/api.js';
import LoadingState from '../../components/LoadingState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import useDirtyGuard from '../../hooks/useDirtyGuard.js';

export default function MyAnnualLeave() {
  const [summary, setSummary] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ date: '', reason: '' });

  useDirtyGuard(Boolean(form.date || form.reason));

  async function load() {
    try {
      setLoading(true);
      setError('');
      const [accrual, nextRequests] = await Promise.all([getMyAccrual(), getMyOverrideRequests()]);
      setSummary(accrual);
      setRequests(nextRequests);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await createMyLeaveRequest(form);
      setForm({ date: '', reason: '' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(item) {
    if (cancellingId) return;     // Prevent double-fire while another cancel is in flight
    setCancellingId(item.id);
    setError('');
    try {
      await cancelMyOverrideRequest(item.id, item.version);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCancellingId(null);
    }
  }

  if (loading) return <LoadingState message="Loading your leave..." className="p-6" />;
  if (error && !summary) return <div className="p-6"><ErrorState title="Unable to load leave details" message={error} onRetry={() => void load()} /></div>;

  return (
    <div className="space-y-6 p-6">
      {error && <ErrorState title="Something needs attention" message={error} />}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Accrued</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{Number(summary?.accruedHours || 0).toFixed(1)}h</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Used</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{Number(summary?.usedHours || 0).toFixed(1)}h</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Remaining</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{Number(summary?.remainingHours || 0).toFixed(1)}h</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Request leave</h2>
          <p className="mt-1 text-sm text-slate-600">Submit a single-day annual leave request for manager approval.</p>
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="leave-date" className={INPUT.label}>Date</label>
              <input id="leave-date" type="date" className={INPUT.base} value={form.date} onChange={(e) => setForm((current) => ({ ...current, date: e.target.value }))} required />
            </div>
            <div>
              <label htmlFor="leave-reason" className={INPUT.label}>Reason</label>
              <textarea id="leave-reason" className={INPUT.base} rows={4} value={form.reason} onChange={(e) => setForm((current) => ({ ...current, reason: e.target.value }))} />
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <button type="submit" className={BTN.primary} disabled={saving || !form.date}>
              {saving ? 'Submitting...' : 'Submit request'}
            </button>
          </div>
        </form>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Your requests</h2>
          <div className="mt-4 space-y-3">
            {requests.length === 0 ? (
              <EmptyState compact title="No requests yet" description="Once you submit leave requests, they'll appear here." />
            ) : requests.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-900">{item.date}</p>
                    <p className="text-sm text-slate-500">{item.reason || 'No reason given'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={item.status === 'approved' ? BADGE.green : item.status === 'rejected' ? BADGE.red : item.status === 'cancelled' ? BADGE.gray : BADGE.amber}>
                      {item.status}
                    </span>
                    {item.status === 'pending' && (
                      <button
                        type="button"
                        className={`${BTN.secondary} ${BTN.sm}`}
                        onClick={() => void handleCancel(item)}
                        disabled={cancellingId === item.id}
                      >
                        {cancellingId === item.id ? 'Cancelling…' : 'Cancel'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
