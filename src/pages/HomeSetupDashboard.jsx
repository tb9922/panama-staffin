import React, { useCallback, useEffect, useMemo, useState } from 'react';
import EmptyState from '../components/EmptyState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { BADGE, BTN, CARD, ESC_COLORS, PAGE } from '../lib/design.js';
import { getHomeSetupCompleteness } from '../lib/homeSetupApi.js';

const SCORE_LABELS = {
  complete: 'Complete',
  attention: 'Attention',
  incomplete: 'Incomplete',
};

function scoreState(value) {
  const pct = Number(value || 0);
  if (pct >= 100) return 'complete';
  if (pct >= 75) return 'attention';
  return 'incomplete';
}

function scoreBadge(value) {
  const state = scoreState(value);
  if (state === 'complete') return BADGE.green;
  if (state === 'attention') return BADGE.amber;
  return BADGE.red;
}

function scoreAccent(value) {
  const state = scoreState(value);
  if (state === 'complete') return ESC_COLORS.green;
  if (state === 'attention') return ESC_COLORS.amber;
  return ESC_COLORS.red;
}

function formatPct(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `${Math.round(Number(value))}%`;
}

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString();
}

function StatusPill({ value }) {
  const state = scoreState(value);
  return <span className={`${scoreBadge(value)} whitespace-nowrap`}>{SCORE_LABELS[state]}</span>;
}

function SummaryCard({ label, value, helper, stateValue }) {
  const accent = scoreAccent(stateValue);
  return (
    <div className={`${CARD.base} overflow-hidden`}>
      <div className={`h-1 ${accent.bar}`} />
      <div className="p-4">
        <p className="text-sm font-medium text-[var(--ink-2)]">{label}</p>
        <p className={`mt-2 text-3xl font-semibold ${accent.text}`}>{value}</p>
        <p className="mt-1 text-xs text-[var(--ink-3)]">{helper}</p>
      </div>
    </div>
  );
}

function ProgressBar({ value }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value || 0))));
  const accent = scoreAccent(pct);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--line)]" aria-hidden="true">
      <div className={`h-full ${accent.bar}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function CheckRow({ item }) {
  const score = item?.score_pct ?? 0;
  return (
    <div className="grid gap-2 border-t border-[var(--line)] py-3 md:grid-cols-[minmax(0,1.2fr)_7rem_minmax(0,2fr)] md:items-start">
      <div>
        <p className="font-medium text-[var(--ink)]">{item.label}</p>
        <p className="mt-1 text-xs text-[var(--ink-3)]">{formatPct(score)} complete</p>
      </div>
      <div className="md:pt-1"><StatusPill value={score} /></div>
      <div className="text-sm text-[var(--ink-3)]">
        {item.missing_items?.length > 0 ? item.missing_items.join('; ') : 'No missing setup items.'}
      </div>
    </div>
  );
}

function KeyFacts({ home }) {
  const checks = home.checks || {};
  const occupancy = checks.occupancy_beds?.details || {};
  const training = checks.training_baseline?.details || {};
  const audit = checks.audit_templates_tasks?.details || {};
  const users = checks.users_assigned?.details || {};
  const evidence = checks.evidence_baseline?.details || {};
  const facts = [
    ['Beds', `${formatNumber(occupancy.bed_count)} / ${formatNumber(occupancy.registered_beds)}`],
    ['Staff', formatNumber(training.active_staff_count)],
    ['Training types', formatNumber(training.active_training_types)],
    ['Audit templates', `${formatNumber(audit.configured_template_count)} / ${formatNumber(audit.expected_template_count)}`],
    ['Users', formatNumber(users.assigned_user_count)],
    ['Evidence', formatNumber((evidence.cqc_evidence_count || 0) + (evidence.linked_evidence_count || 0))],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 border-t border-[var(--line)] p-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-semibold uppercase text-[var(--ink-3)]">{label}</dt>
          <dd className="mt-1 font-semibold text-[var(--ink)]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MissingItems({ items }) {
  if (!items?.length) {
    return <p className="text-sm text-[var(--ink-3)]">No missing setup items.</p>;
  }
  return (
    <ul className="grid gap-1 text-sm text-[var(--ink-2)] sm:grid-cols-2">
      {items.slice(0, 8).map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}

function HomePanel({ home }) {
  const checks = Object.values(home.checks || {});
  const accent = scoreAccent(home.completion_pct);
  return (
    <section className={`${CARD.base} overflow-hidden`}>
      <div className={`h-1.5 ${accent.bar}`} />
      <div className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-[var(--ink)]">{home.home_name}</h2>
              <StatusPill value={home.completion_pct} />
            </div>
            <p className="mt-1 text-sm text-[var(--ink-3)]">
              {formatNumber(home.completed_checks)} of {formatNumber(home.total_checks)} checks complete
            </p>
          </div>
          <div className="w-full max-w-sm">
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-[var(--ink-2)]">Setup completeness</span>
              <span className={`font-semibold ${accent.text}`}>{formatPct(home.completion_pct)}</span>
            </div>
            <ProgressBar value={home.completion_pct} />
          </div>
        </div>

        <div className="mt-4">
          <MissingItems items={home.missing_items} />
        </div>
      </div>
      <KeyFacts home={home} />
      <div className="px-4 pb-4">
        {checks.map((item) => <CheckRow key={item.id} item={item} />)}
      </div>
    </section>
  );
}

export default function HomeSetupDashboard() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getHomeSetupCompleteness();
      setPayload(result || { homes: [], summary: {} });
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load home setup completeness');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const homes = useMemo(() => Array.isArray(payload?.homes) ? payload.homes : [], [payload]);
  const sortedHomes = useMemo(() => (
    [...homes].sort((a, b) => (
      Number(a.completion_pct || 0) - Number(b.completion_pct || 0)
      || String(a.home_name || '').localeCompare(String(b.home_name || ''))
    ))
  ), [homes]);
  const summary = payload?.summary || {};

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Home Setup Completeness</h1>
          <p className={PAGE.subtitle}>Read-only setup coverage across assigned homes.</p>
        </div>
        <button type="button" className={BTN.secondary} onClick={load} disabled={loading}>Refresh</button>
      </div>

      {error && !loading && <ErrorState message={error} onRetry={load} className="mb-4" />}

      {!error && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Average completion"
            value={formatPct(summary.average_completion_pct)}
            helper={`${formatNumber(summary.home_count)} active home(s) visible`}
            stateValue={summary.average_completion_pct}
          />
          <SummaryCard
            label="Complete homes"
            value={formatNumber(summary.complete_homes)}
            helper="All setup checks complete"
            stateValue={summary.incomplete_homes > 0 ? 75 : 100}
          />
          <SummaryCard
            label="Incomplete homes"
            value={formatNumber(summary.incomplete_homes)}
            helper="Have missing setup items"
            stateValue={summary.incomplete_homes > 0 ? 60 : 100}
          />
          <SummaryCard
            label="Lowest score"
            value={homes.length > 0 ? formatPct(Math.min(...homes.map((home) => Number(home.completion_pct || 0)))) : '-'}
            helper="First priority for setup work"
            stateValue={homes.length > 0 ? Math.min(...homes.map((home) => Number(home.completion_pct || 0))) : 100}
          />
        </div>
      )}

      {loading ? (
        <div className={CARD.flush}><LoadingState message="Loading setup completeness..." /></div>
      ) : error ? null : homes.length === 0 ? (
        <div className={CARD.flush}><EmptyState title="No homes available" description="No active homes are assigned to this user." /></div>
      ) : (
        <div className="space-y-4">
          {sortedHomes.map((home) => <HomePanel key={home.home_id} home={home} />)}
        </div>
      )}
    </div>
  );
}
