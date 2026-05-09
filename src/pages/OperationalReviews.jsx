import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BADGE, BTN, CARD, INPUT, PAGE, TAB, TABLE } from '../lib/design.js';
import EmptyState from '../components/EmptyState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { useData } from '../contexts/DataContext.jsx';
import { getOperationalReviews } from '../lib/operationalReviewApi.js';

const TYPE_OPTIONS = [
  { value: 'overdue_escalation', label: 'Overdue escalations' },
  { value: 'emergency_agency_override', label: 'Emergency agency' },
  { value: 'unverified_completed_action', label: 'Unverified actions' },
  { value: 'evidence_missing', label: 'Evidence missing' },
  { value: 'manager_sign_off_required', label: 'Manager sign-off' },
];

const SEVERITY_OPTIONS = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

function badgeForSeverity(severity) {
  if (severity === 'critical') return BADGE.red;
  if (severity === 'high') return BADGE.orange;
  if (severity === 'medium') return BADGE.amber;
  return BADGE.gray;
}

function labelForType(type) {
  return TYPE_OPTIONS.find(option => option.value === type)?.label || String(type || '').replace(/_/g, ' ');
}

function formatDate(value) {
  if (!value) return '-';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toISOString().slice(0, 10);
}

function formatGeneratedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildTargetPath(target) {
  if (!target?.path) return null;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(target.query || {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return `${target.path}${qs ? `?${qs}` : ''}`;
}

function SummaryTile({ label, value, tone = 'neutral' }) {
  const toneClass = {
    critical: 'text-[var(--alert)]',
    high: 'text-[var(--warn)]',
    medium: 'text-[var(--caution)]',
    neutral: 'text-[var(--ink)]',
  }[tone] || 'text-[var(--ink)]';
  return (
    <div className={CARD.padded}>
      <p className="text-sm text-[var(--ink-3)]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value || 0}</p>
    </div>
  );
}

function TypeTabs({ activeType, counts, onChange }) {
  return (
    <div className={TAB.bar} role="tablist" aria-label="Operational review queue type">
      <button
        type="button"
        role="tab"
        aria-selected={!activeType}
        className={`${TAB.button} ${!activeType ? TAB.active : TAB.inactive}`}
        onClick={() => onChange('')}
      >
        All
      </button>
      {TYPE_OPTIONS.map(option => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={activeType === option.value}
          className={`${TAB.button} ${activeType === option.value ? TAB.active : TAB.inactive}`}
          onClick={() => onChange(option.value)}
        >
          {option.label} ({counts?.[option.value] || 0})
        </button>
      ))}
    </div>
  );
}

function ReviewTable({ items, onOpen }) {
  return (
    <div className={TABLE.wrapper}>
      <table className={TABLE.table}>
        <thead className={TABLE.thead}>
          <tr>
            <th className={TABLE.th}>Home</th>
            <th className={TABLE.th}>Exception</th>
            <th className={TABLE.th}>Owner</th>
            <th className={TABLE.th}>Due / review</th>
            <th className={TABLE.th}>Severity</th>
            <th className={TABLE.th}>Target</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} className={TABLE.tr}>
              <td className={TABLE.td}>
                <p className="font-medium text-[var(--ink)]">{item.home?.name || item.home?.slug || '-'}</p>
                <p className="text-xs text-[var(--ink-3)]">{item.home?.slug || ''}</p>
              </td>
              <td className={TABLE.td}>
                <p className="font-medium text-[var(--ink)]">{item.title}</p>
                <p className="mt-1 text-xs text-[var(--ink-3)]">{item.type_label || labelForType(item.type)}</p>
              </td>
              <td className={TABLE.td}>
                <p>{item.owner_label || '-'}</p>
                <p className="mt-1 text-xs text-[var(--ink-3)]">{item.actionable_label || '-'}</p>
              </td>
              <td className={TABLE.td}>{formatDate(item.display_date || item.review_date || item.due_date)}</td>
              <td className={TABLE.td}>
                <span className={badgeForSeverity(item.severity)}>{SEVERITY_OPTIONS.find(option => option.value === item.severity)?.label || item.severity}</span>
              </td>
              <td className={`${TABLE.td} whitespace-nowrap`}>
                <button
                  type="button"
                  className={`${BTN.secondary} ${BTN.xs}`}
                  onClick={() => onOpen(item)}
                  disabled={!buildTargetPath(item.link_target)}
                >
                  Open
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function OperationalReviews() {
  const navigate = useNavigate();
  const { switchHome } = useData();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ type: '', severity: '' });

  const load = useCallback(async (signal) => {
    setLoading(true);
    try {
      const result = await getOperationalReviews({ ...filters, limit: 250 }, { signal });
      setPayload(result || { items: [], summary: { by_type: {}, by_severity: {} } });
      setError(null);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err.message || 'Failed to load operational reviews');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const items = useMemo(() => (Array.isArray(payload?.items) ? payload.items : []), [payload]);
  const summary = payload?.summary || { by_type: {}, by_severity: {}, total: 0 };
  const generatedAt = formatGeneratedAt(payload?.generated_at);

  function setFilter(key, value) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }

  function openTarget(item) {
    const targetPath = buildTargetPath(item.link_target);
    if (!targetPath) return;
    if (item.link_target?.home_slug) switchHome(item.link_target.home_slug);
    navigate(targetPath);
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Operational Reviews</h1>
          <p className={PAGE.subtitle}>Exception queues across assigned homes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className={INPUT.select}
            value={filters.severity}
            onChange={event => setFilter('severity', event.target.value)}
            aria-label="Filter by severity"
          >
            <option value="">All severities</option>
            {SEVERITY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button type="button" className={BTN.secondary} onClick={() => load()} disabled={loading}>Refresh</button>
        </div>
      </div>

      {error && !loading && <ErrorState message={error} onRetry={() => load()} className="mb-4" />}

      {!loading && !error && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryTile label="Total" value={summary.total} />
          <SummaryTile label="Critical" value={summary.by_severity?.critical} tone="critical" />
          <SummaryTile label="High" value={summary.by_severity?.high} tone="high" />
          <SummaryTile label="Medium" value={summary.by_severity?.medium} tone="medium" />
        </div>
      )}

      <TypeTabs
        activeType={filters.type}
        counts={summary.by_type}
        onChange={value => setFilter('type', value)}
      />

      <div className={CARD.flush}>
        {loading ? (
          <LoadingState message="Loading operational reviews..." />
        ) : error ? null : items.length === 0 ? (
          <EmptyState title="No review items" description="No exceptions match the current filters." />
        ) : (
          <>
            <div className="border-b border-[var(--line)] px-4 py-3 text-sm text-[var(--ink-3)]">
              {items.length} item{items.length === 1 ? '' : 's'}{generatedAt ? ` - refreshed ${generatedAt}` : ''}
            </div>
            <ReviewTable items={items} onOpen={openTarget} />
          </>
        )}
      </div>
    </div>
  );
}
