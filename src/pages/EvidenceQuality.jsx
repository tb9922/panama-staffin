import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import ErrorState from '../components/ErrorState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { BADGE, BTN, CARD, INPUT, PAGE, TABLE } from '../lib/design.js';
import { QUALITY_STATEMENTS } from '../lib/cqc.js';
import { getEvidenceQuality } from '../lib/evidenceQualityApi.js';
import { useData } from '../contexts/DataContext.jsx';

const DOMAIN_OPTIONS = [
  { value: 'safe', label: 'Safe' },
  { value: 'effective', label: 'Effective' },
  { value: 'caring', label: 'Caring' },
  { value: 'responsive', label: 'Responsive' },
  { value: 'well-led', label: 'Well-Led' },
];

function badgeForRag(rag) {
  if (rag === 'green') return BADGE.green;
  if (rag === 'amber') return BADGE.amber;
  return BADGE.red;
}

function ragLabel(rag) {
  if (rag === 'green') return 'Green';
  if (rag === 'amber') return 'Amber';
  return 'Red';
}

function formatGeneratedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function ScoreCard({ label, score, rag, helper }) {
  return (
    <div className={CARD.padded}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-[var(--ink-2)]">{label}</p>
        <span className={badgeForRag(rag)}>{ragLabel(rag)}</span>
      </div>
      <p className="mt-3 text-3xl font-semibold text-[var(--ink)]">{score ?? 0}</p>
      {helper && <p className="mt-1 text-xs text-[var(--ink-3)]">{helper}</p>}
    </div>
  );
}

function DomainGrid({ domains }) {
  return (
    <section className={`${PAGE.section} grid gap-4 lg:grid-cols-5`} aria-label="Evidence quality by domain">
      {domains.map((domain) => (
        <ScoreCard
          key={domain.domain}
          label={domain.domain_label}
          score={domain.score}
          rag={domain.rag}
          helper={`${domain.red_count} red, ${domain.amber_count} amber`}
        />
      ))}
    </section>
  );
}

function WeakestStatementsTable({ statements }) {
  if (!statements.length) return <EmptyState title="No statements found" description="No CQC quality statements match the current filter." />;
  return (
    <section className={`${PAGE.section} ${CARD.flush}`}>
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Weakest Statements</h2>
      </div>
      <div className={TABLE.wrapper}>
        <table className={TABLE.table}>
          <thead className={TABLE.thead}>
            <tr>
              <th scope="col" className={TABLE.th}>Statement</th>
              <th scope="col" className={TABLE.th}>Domain</th>
              <th scope="col" className={TABLE.th}>Score</th>
              <th scope="col" className={TABLE.th}>RAG</th>
              <th scope="col" className={TABLE.th}>Practical gaps</th>
            </tr>
          </thead>
          <tbody>
            {statements.map((statement) => (
              <tr key={statement.statement_id} className={TABLE.tr}>
                <td className={TABLE.td}>
                  <p className="font-medium text-[var(--ink)]">{statement.statement_id} - {statement.statement_name}</p>
                  <p className="mt-1 text-xs text-[var(--ink-3)]">{statement.evidence_count} evidence item{statement.evidence_count === 1 ? '' : 's'}</p>
                </td>
                <td className={TABLE.td}>{statement.domain_label}</td>
                <td className={TABLE.td}>{statement.score}</td>
                <td className={TABLE.td}><span className={badgeForRag(statement.rag)}>{ragLabel(statement.rag)}</span></td>
                <td className={TABLE.td}>
                  {(statement.weakest_reasons || []).slice(0, 3).map((reason) => (
                    <span key={reason} className="mr-1 mt-1 inline-flex rounded-full bg-[var(--paper-2)] px-2 py-0.5 text-xs text-[var(--ink-2)]">
                      {reason}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GapsList({ gaps }) {
  if (!gaps.length) return null;
  return (
    <section className={`${PAGE.section} ${CARD.padded}`} aria-labelledby="evidence-quality-gaps">
      <h2 id="evidence-quality-gaps" className="text-sm font-semibold text-[var(--ink)]">Practical Gaps</h2>
      <ul className="mt-3 grid gap-3 md:grid-cols-2">
        {gaps.slice(0, 8).map((gap) => (
          <li key={`${gap.statement_id}-${gap.reason}`} className="border-l-4 border-[var(--alert)] pl-3">
            <p className="text-sm font-medium text-[var(--ink)]">{gap.statement_id} - {gap.statement_name}</p>
            <p className="text-sm text-[var(--ink-2)]">{gap.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function EvidenceQuality() {
  const { activeHome, canRead } = useData();
  const domainFilterId = useId();
  const statementFilterId = useId();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ domain: '', statement: '' });
  const canReadCompliance = canRead ? canRead('compliance') : true;
  const hasActiveHome = Boolean(activeHome);

  const statementOptions = useMemo(
    () => QUALITY_STATEMENTS.filter((statement) => !filters.domain || statement.category === filters.domain),
    [filters.domain]
  );

  const load = useCallback(async ({ silent = false, signal } = {}) => {
    if (!canReadCompliance) {
      setLoading(false);
      return;
    }
    if (!hasActiveHome) {
      setPayload(null);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await getEvidenceQuality({ ...filters, home: activeHome }, { signal });
      setPayload(result);
      setError(null);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err.message || 'Failed to load evidence quality');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [activeHome, canReadCompliance, filters, hasActiveHome]);

  useEffect(() => {
    const controller = new AbortController();
    void load({ signal: controller.signal });
    return () => controller.abort();
  }, [load]);

  function setFilter(key, value) {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
      statement: key === 'domain' ? '' : value,
    }));
  }

  if (!canReadCompliance) {
    return <ErrorState title="Compliance access required" message="Your role cannot read CQC evidence quality for this home." />;
  }
  if (!hasActiveHome) {
    return (
      <div className={PAGE.container}>
        <ErrorState title="No home selected" message="Select a home before opening the evidence quality dashboard." />
      </div>
    );
  }
  if (loading) return <LoadingState message="Scoring evidence quality..." card />;

  const summary = payload?.summary || {};
  const generatedAt = formatGeneratedAt(payload?.generated_at);

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Evidence Quality</h1>
          <p className={PAGE.subtitle}>Deterministic CQC evidence scoring by domain and quality statement.</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto lg:flex-wrap lg:justify-end">
          <label htmlFor={domainFilterId} className="sr-only">Filter by CQC domain</label>
          <select
            id={domainFilterId}
            className={`${INPUT.select} w-full sm:w-auto`}
            value={filters.domain}
            onChange={(event) => setFilter('domain', event.target.value)}
            aria-label="Filter by CQC domain"
          >
            <option value="">All domains</option>
            {DOMAIN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <label htmlFor={statementFilterId} className="sr-only">Filter by quality statement</label>
          <select
            id={statementFilterId}
            className={`${INPUT.select} w-full sm:w-auto`}
            value={filters.statement}
            onChange={(event) => setFilter('statement', event.target.value)}
            aria-label="Filter by quality statement"
          >
            <option value="">All statements</option>
            {statementOptions.map((statement) => <option key={statement.id} value={statement.id}>{statement.id} - {statement.name}</option>)}
          </select>
          <button type="button" className={`${BTN.secondary} w-full sm:w-auto`} onClick={() => load({ silent: true })} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <ErrorState
          className="mb-5"
          title="Unable to load evidence quality"
          message={error}
          onRetry={() => load()}
        />
      )}

      {payload && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <ScoreCard label="Overall quality" score={summary.score} rag={summary.rag} helper={generatedAt ? `Generated ${generatedAt}` : ''} />
            <ScoreCard label="Red statements" score={summary.red_statement_count} rag={summary.red_statement_count > 0 ? 'red' : 'green'} helper={`${summary.statement_count || 0} statements scored`} />
            <ScoreCard label="Amber statements" score={summary.amber_statement_count} rag={summary.amber_statement_count > 0 ? 'amber' : 'green'} helper="Needs manager review" />
            <ScoreCard label="Evidence items" score={summary.evidence_count} rag={summary.evidence_count > 0 ? 'green' : 'red'} helper={payload.heuristic?.label} />
          </div>

          <DomainGrid domains={payload.domains || []} />
          <GapsList gaps={payload.practical_gaps || []} />
          <WeakestStatementsTable statements={payload.weakest_statements || []} />
        </>
      )}
    </div>
  );
}
