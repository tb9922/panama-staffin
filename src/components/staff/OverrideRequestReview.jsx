import { useCallback, useEffect, useState } from 'react';
import { BADGE, BTN, INPUT } from '../../lib/design.js';
import { decideOverrideRequest, getPendingOverrideRequests, getCurrentHome } from '../../lib/api.js';
import LoadingState from '../LoadingState.jsx';
import ErrorState from '../ErrorState.jsx';
import EmptyState from '../EmptyState.jsx';

export default function OverrideRequestReview() {
  const homeSlug = getCurrentHome();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [decisionNotes, setDecisionNotes] = useState({});  // { [requestId]: note }
  const [busyId, setBusyId] = useState(null);

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
    setBusyId(item.id);
    try {
      setError('');
      await decideOverrideRequest(homeSlug, item.id, {
        status,
        expectedVersion: item.version,
        decisionNote: decisionNotes[item.id] || '',
      });
      // Clean up local state for this request
      setDecisionNotes((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setExpandedId(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function setNote(id, value) {
    setDecisionNotes((current) => ({ ...current, [id]: value }));
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
          {rows.map((item) => {
            const expanded = expandedId === item.id;
            const note = decisionNotes[item.id] || '';
            return (
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
                    <button
                      type="button"
                      className={`${BTN.ghost} ${BTN.sm}`}
                      onClick={() => setExpandedId(expanded ? null : item.id)}
                      aria-expanded={expanded}
                    >
                      {expanded ? 'Cancel' : 'Review'}
                    </button>
                  </div>
                </div>
                {expanded && (
                  <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                    <div>
                      <label htmlFor={`note-${item.id}`} className={INPUT.label}>
                        Decision note (shown to staff — required for rejection)
                      </label>
                      <textarea
                        id={`note-${item.id}`}
                        rows={2}
                        maxLength={500}
                        value={note}
                        onChange={(e) => setNote(item.id, e.target.value)}
                        className={INPUT.base}
                        placeholder="e.g. 'Coverage gap — try a different week' or 'Approved, enjoy.'"
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        className={`${BTN.danger} ${BTN.sm}`}
                        disabled={busyId === item.id || !note.trim()}
                        title={!note.trim() ? 'Please add a note explaining the rejection' : ''}
                        onClick={() => void handleDecision(item, 'rejected')}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className={`${BTN.success} ${BTN.sm}`}
                        disabled={busyId === item.id}
                        onClick={() => void handleDecision(item, 'approved')}
                      >
                        Approve
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
