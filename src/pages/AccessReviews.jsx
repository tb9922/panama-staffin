import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BADGE, BTN, CARD, INPUT, PAGE, TABLE } from '../lib/design.js';
import EmptyState from '../components/EmptyState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import {
  completeAccessReview,
  getAccessReview,
  listAccessReviews,
  startAccessReview,
  updateAccessReviewAssignment,
} from '../lib/accessReviewApi.js';

const CADENCE_OPTIONS = [
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'monthly', label: 'Monthly' },
];

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'needs_change', label: 'Needs change' },
  { value: 'revoked_requested', label: 'Revoke requested' },
];

function reviewStatusBadge(status) {
  if (status === 'completed') return BADGE.green;
  return BADGE.blue;
}

function assignmentStatusBadge(status) {
  if (status === 'reviewed') return BADGE.green;
  if (status === 'needs_change') return BADGE.amber;
  if (status === 'revoked_requested') return BADGE.red;
  return BADGE.gray;
}

function humanize(value) {
  return String(value || '').replace(/_/g, ' ');
}

function formatDate(value) {
  if (!value) return '-';
  return String(value).slice(0, 10);
}

function Metric({ label, value, tone = 'neutral' }) {
  const toneClass = {
    alert: 'text-[var(--alert)]',
    warn: 'text-[var(--warn)]',
    ok: 'text-[var(--ok)]',
    neutral: 'text-[var(--ink)]',
  }[tone] || 'text-[var(--ink)]';
  return (
    <div className={CARD.padded}>
      <p className="text-sm text-[var(--ink-3)]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value || 0}</p>
    </div>
  );
}

function ReviewList({ reviews, activeId, onSelect }) {
  if (reviews.length === 0) {
    return (
      <EmptyState
        title="No access reviews yet"
        description="Start a monthly or quarterly platform review to snapshot current access."
      />
    );
  }
  return (
    <div className={TABLE.wrapper}>
      <table className={TABLE.table}>
        <thead className={TABLE.thead}>
          <tr>
            <th className={TABLE.th}>Period</th>
            <th className={TABLE.th}>Cadence</th>
            <th className={TABLE.th}>Status</th>
            <th className={TABLE.th}>Assignments</th>
            <th className={TABLE.th}>Open</th>
          </tr>
        </thead>
        <tbody>
          {reviews.map(review => (
            <tr key={review.id} className={TABLE.tr}>
              <td className={TABLE.td}>
                <p className="font-medium text-[var(--ink)]">{formatDate(review.period_start)} to {formatDate(review.period_end)}</p>
                <p className="text-xs text-[var(--ink-3)]">{review.started_by_username}</p>
              </td>
              <td className={TABLE.td}>{humanize(review.cadence)}</td>
              <td className={TABLE.td}>
                <span className={reviewStatusBadge(review.status)}>{humanize(review.status)}</span>
              </td>
              <td className={TABLE.td}>
                <span>{review.assignment_counts?.pending || 0} pending</span>
                <span className="ml-2 text-[var(--ink-3)]">{review.assignment_counts?.needs_change || 0} changes</span>
              </td>
              <td className={TABLE.td}>
                <button
                  type="button"
                  className={`${activeId === review.id ? BTN.primary : BTN.secondary} ${BTN.xs}`}
                  onClick={() => onSelect(review.id)}
                >
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExceptionFlags({ flags }) {
  if (!Array.isArray(flags) || flags.length === 0) {
    return <span className={BADGE.green}>Clear</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map(flag => (
        <span key={flag} className={flag === 'platform_admin' ? BADGE.purple : BADGE.amber}>{humanize(flag)}</span>
      ))}
    </div>
  );
}

function AssignmentRows({ assignments, onStatusChange }) {
  if (assignments.length === 0) {
    return <div className={TABLE.empty}>No assignments match this filter.</div>;
  }
  return (
    <div className={TABLE.wrapper}>
      <table className={TABLE.table}>
        <thead className={TABLE.thead}>
          <tr>
            <th className={TABLE.th}>User</th>
            <th className={TABLE.th}>Access</th>
            <th className={TABLE.th}>Exceptions</th>
            <th className={TABLE.th}>Decision</th>
            <th className={TABLE.th}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map(item => (
            <tr key={item.id} className={TABLE.tr}>
              <td className={TABLE.td}>
                <p className="font-medium text-[var(--ink)]">{item.display_name || item.username}</p>
                <p className="text-xs text-[var(--ink-3)]">{item.username}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {!item.active && <span className={BADGE.red}>Inactive</span>}
                  {item.is_platform_admin && <span className={BADGE.purple}>Platform admin</span>}
                </div>
              </td>
              <td className={TABLE.td}>
                <p>{item.home_name || 'No home assignment'}</p>
                <p className="text-xs text-[var(--ink-3)]">{item.role_id ? humanize(item.role_id) : humanize(item.assignment_type)}</p>
              </td>
              <td className={TABLE.td}><ExceptionFlags flags={item.exception_flags} /></td>
              <td className={TABLE.td}>
                <div className="flex flex-col gap-2">
                  <span className={assignmentStatusBadge(item.status)}>{humanize(item.status)}</span>
                  <select
                    className={INPUT.inlineSelect}
                    value={item.status}
                    aria-label={`Decision for ${item.username}`}
                    onChange={event => onStatusChange(item, event.target.value, item.notes || '')}
                  >
                    {STATUS_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </td>
              <td className={TABLE.td}>
                <input
                  className={INPUT.inline}
                  aria-label={`Notes for ${item.username}`}
                  defaultValue={item.notes || ''}
                  onBlur={event => {
                    if (event.target.value !== (item.notes || '')) {
                      onStatusChange(item, item.status, event.target.value);
                    }
                  }}
                />
                {item.reviewed_by_username && (
                  <p className="mt-1 text-xs text-[var(--ink-3)]">Reviewed by {item.reviewed_by_username}</p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AccessReviews() {
  const [cadence, setCadence] = useState('quarterly');
  const [reviews, setReviews] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [exceptionOnly, setExceptionOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadReviews = useCallback(async (signal) => {
    setLoading(true);
    try {
      const payload = await listAccessReviews({ limit: 50 }, { signal });
      const rows = Array.isArray(payload?.reviews) ? payload.reviews : [];
      setReviews(rows);
      setSelectedId(prev => prev || rows[0]?.id || null);
      setError(null);
    } catch (err) {
      if (!signal?.aborted) setError(err.message || 'Failed to load access reviews');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (reviewId, signal) => {
    if (!reviewId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const payload = await getAccessReview(reviewId, {
        status: statusFilter,
        exception_only: exceptionOnly,
        limit: 250,
      }, { signal });
      setDetail(payload || null);
      setError(null);
    } catch (err) {
      if (!signal?.aborted) setError(err.message || 'Failed to load access review');
    } finally {
      if (!signal?.aborted) setDetailLoading(false);
    }
  }, [exceptionOnly, statusFilter]);

  useEffect(() => {
    const controller = new AbortController();
    loadReviews(controller.signal);
    return () => controller.abort();
  }, [loadReviews]);

  useEffect(() => {
    const controller = new AbortController();
    loadDetail(selectedId, controller.signal);
    return () => controller.abort();
  }, [loadDetail, selectedId]);

  const snapshot = detail?.review?.snapshot || {};
  const counts = snapshot.counts || {};
  const assignments = useMemo(() => (Array.isArray(detail?.assignments) ? detail.assignments : []), [detail]);

  async function handleStartReview() {
    setBusy(true);
    try {
      const payload = await startAccessReview({ cadence });
      const review = payload?.review;
      await loadReviews();
      if (review?.id) setSelectedId(review.id);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to start access review');
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusChange(item, status, notes) {
    const previous = detail;
    setDetail(current => ({
      ...current,
      assignments: (current?.assignments || []).map(row => (
        row.id === item.id ? { ...row, status, notes } : row
      )),
    }));
    try {
      const updated = await updateAccessReviewAssignment(detail.review.id, item.id, { status, notes });
      setDetail(current => {
        const assignments = (current?.assignments || []).map(row => (row.id === item.id ? updated : row));
        const assignmentCounts = assignments.reduce((counts, row) => ({
          ...counts,
          [row.status]: Number(counts[row.status] || 0) + 1,
        }), {});
        return {
          ...current,
          review: {
            ...current?.review,
            assignment_counts: {
              ...(current?.review?.assignment_counts || {}),
              pending: Number(assignmentCounts.pending || 0),
              needs_change: Number(assignmentCounts.needs_change || 0),
              reviewed: Number(assignmentCounts.reviewed || 0),
              revoked_requested: Number(assignmentCounts.revoked_requested || 0),
            },
          },
          assignments,
        };
      });
      setError(null);
    } catch (err) {
      setDetail(previous);
      setError(err.message || 'Failed to update assignment');
    }
  }

  async function handleCompleteReview() {
    if (!detail?.review?.id) return;
    setBusy(true);
    try {
      await completeAccessReview(detail.review.id);
      await loadReviews();
      await loadDetail(detail.review.id);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to complete access review');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Access Reviews</h1>
          <p className={PAGE.subtitle}>Platform role certification and exception review.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className={INPUT.select}
            value={cadence}
            aria-label="Review cadence"
            onChange={event => setCadence(event.target.value)}
          >
            {CADENCE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button type="button" className={BTN.primary} onClick={handleStartReview} disabled={busy}>
            Start review
          </button>
        </div>
      </div>

      {error && <ErrorState message={error} />}

      {loading ? (
        <LoadingState message="Loading access reviews" />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.4fr)]">
          <section className={CARD.padded}>
            <h2 className="mb-3 text-lg font-semibold text-[var(--ink)]">Review periods</h2>
            <ReviewList reviews={reviews} activeId={selectedId} onSelect={setSelectedId} />
          </section>

          <section className="min-w-0">
            {detailLoading ? (
              <LoadingState message="Loading review detail" />
            ) : detail?.review ? (
              <div className="space-y-5">
                <div className="grid gap-3 md:grid-cols-5">
                  <Metric label="Users" value={counts.users} />
                  <Metric label="Platform admins" value={counts.platform_admins} tone="warn" />
                  <Metric label="Inactive" value={counts.inactive_users} tone="alert" />
                  <Metric label="No home" value={counts.no_home_users} tone="warn" />
                  <Metric label="Stale login" value={counts.stale_users} tone="warn" />
                </div>

                <div className={CARD.padded}>
                  <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-[var(--ink)]">
                        {formatDate(detail.review.period_start)} to {formatDate(detail.review.period_end)}
                      </h2>
                      <p className="text-sm text-[var(--ink-3)]">
                        {counts.home_assignments || 0} home assignments, generated {formatDate(snapshot.generated_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={`${BTN.primary} ${BTN.sm}`}
                        onClick={handleCompleteReview}
                        disabled={busy || detail.review.status === 'completed' || Number(detail.review.assignment_counts?.pending || 0) > 0}
                      >
                        Complete review
                      </button>
                      <label className="inline-flex items-center gap-2 text-sm text-[var(--ink-2)]">
                        <input
                          type="checkbox"
                          checked={exceptionOnly}
                          onChange={event => setExceptionOnly(event.target.checked)}
                        />
                        Exceptions only
                      </label>
                      <select
                        className={INPUT.select}
                        value={statusFilter}
                        aria-label="Filter by decision"
                        onChange={event => setStatusFilter(event.target.value)}
                      >
                        <option value="">All decisions</option>
                        {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <AssignmentRows assignments={assignments} onStatusChange={handleStatusChange} />
                </div>
              </div>
            ) : (
              <EmptyState title="Select a review" description="Choose a review period to inspect user access decisions." />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
