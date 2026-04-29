import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BADGE, BTN, CARD, ESC_COLORS, PAGE } from '../lib/design.js';
import EmptyState from '../components/EmptyState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { useData } from '../contexts/DataContext.jsx';
import { getPortfolioBoardPack, getPortfolioKpis } from '../lib/api.js';

const RAG_LABELS = {
  green: 'Green',
  amber: 'Amber',
  red: 'Red',
  unknown: 'Unknown',
};

const RAG_RANK = {
  red: 0,
  amber: 1,
  unknown: 2,
  green: 3,
};

function ragBadge(rag) {
  if (rag === 'green') return BADGE.green;
  if (rag === 'amber') return BADGE.amber;
  if (rag === 'red') return BADGE.red;
  return BADGE.gray;
}

function ragAccent(rag) {
  if (rag === 'red') return ESC_COLORS.red;
  if (rag === 'amber') return ESC_COLORS.amber;
  if (rag === 'green') return ESC_COLORS.green;
  return { card: 'border-[var(--line)] bg-[var(--paper)]', text: 'text-[var(--ink-3)]', bar: 'bg-[var(--line-2)]' };
}

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatPct(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `${Math.round(Number(value))}%`;
}

function RagPill({ value, className = '' }) {
  return <span className={`${ragBadge(value)} whitespace-nowrap ${className}`.trim()}>{RAG_LABELS[value] || 'Unknown'}</span>;
}

function SummaryCard({ label, value, rag, helper }) {
  const accent = ragAccent(rag);
  return (
    <div className={`${CARD.base} overflow-hidden`}>
      <div className={`h-1 ${accent.bar}`} />
      <div className="p-4">
        <div className="flex min-h-6 items-start justify-between gap-3">
          <p className="text-sm font-medium text-[var(--ink-2)]">{label}</p>
          <RagPill value={rag} />
        </div>
        <p className={`mt-3 text-3xl font-semibold ${accent.text}`}>{value}</p>
        {helper && <p className="mt-1 text-xs text-[var(--ink-3)]">{helper}</p>}
      </div>
    </div>
  );
}

function buildMetricCards(home) {
  const plannedSlots = Number(home.staffing?.planned_shift_slots_7d || 0);
  return [
    {
      key: 'staffing',
      label: 'Staffing',
      rag: home.rag?.staffing,
      value: plannedSlots > 0 ? `${formatNumber(home.staffing?.gaps_7d)} gaps` : 'No baseline',
      detail: plannedSlots > 0
        ? `${formatNumber(home.staffing?.gaps_per_100_planned_shifts)} per 100 shifts`
        : 'Set minimum staffing rules',
    },
    {
      key: 'training',
      label: 'Training',
      rag: home.rag?.training,
      value: formatPct(home.training?.compliance_pct),
      detail: `${formatNumber(home.training?.expired)} expired`,
    },
    {
      key: 'manager_actions',
      label: 'Actions',
      rag: home.rag?.manager_actions,
      value: `${formatNumber(home.manager_actions?.open)} open`,
      detail: `${formatNumber(home.manager_actions?.overdue)} overdue`,
    },
    {
      key: 'incidents',
      label: 'Incidents',
      rag: home.rag?.incidents,
      value: `${formatNumber(home.incidents?.open)} open`,
      detail: `${formatNumber(home.incidents?.rate_per_resident_month)} per resident-month`,
    },
    {
      key: 'complaints',
      label: 'Complaints',
      rag: home.rag?.complaints,
      value: `${formatNumber(home.complaints?.open)} open`,
      detail: `${formatNumber(home.complaints?.rate_per_resident_month)} per resident-month`,
    },
    {
      key: 'cqc_evidence',
      label: 'CQC',
      rag: home.rag?.cqc_evidence,
      value: `${formatNumber(home.cqc_evidence?.open_gaps)} gaps`,
      detail: home.cqc_evidence?.overall ? `${home.cqc_evidence.overall} readiness` : 'Readiness pending',
    },
    {
      key: 'maintenance',
      label: 'Maintenance',
      rag: home.rag?.maintenance,
      value: `${formatNumber(home.maintenance?.overdue)} overdue`,
      detail: `${formatNumber(home.maintenance?.due_30d)} due in 30 days`,
    },
    {
      key: 'agency',
      label: 'Agency',
      rag: home.rag?.agency,
      value: `${formatNumber(home.agency?.shifts_28d)} shifts`,
      detail: `${formatPct(home.agency?.emergency_override_pct)} emergency`,
    },
    {
      key: 'occupancy',
      label: 'Occupancy',
      rag: home.rag?.occupancy,
      value: formatPct(home.occupancy?.pct),
      detail: `${formatNumber(home.occupancy?.available)} available / ${formatNumber(home.occupancy?.hospital_hold)} held`,
    },
    {
      key: 'outcomes',
      label: 'Outcomes',
      rag: home.rag?.outcomes,
      value: `${formatNumber(home.outcomes?.falls_28d)} falls`,
      detail: `${formatNumber(home.outcomes?.infections_28d)} infections`,
    },
  ];
}

function MetricTile({ metric }) {
  const accent = ragAccent(metric.rag);
  return (
    <div className="min-h-24 border-t border-[var(--line)] py-3 sm:border-l sm:border-t-0 sm:px-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-[var(--ink-3)]">{metric.label}</p>
        <RagPill value={metric.rag} />
      </div>
      <p className={`text-base font-semibold ${accent.text}`}>{metric.value}</p>
      <p className="mt-1 text-xs text-[var(--ink-3)]">{metric.detail}</p>
    </div>
  );
}

function ExceptionStrip({ metrics }) {
  const exceptions = metrics.filter(metric => metric.rag === 'red' || metric.rag === 'amber');
  if (exceptions.length === 0) {
    return <p className="text-sm text-[var(--ink-3)]">No current red or amber exception signals.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {exceptions.slice(0, 6).map(metric => (
        <span key={metric.key} className={`${ragBadge(metric.rag)} gap-1`}>
          {metric.label}: {metric.value}
        </span>
      ))}
    </div>
  );
}

function HomePanel({ home, onOpen }) {
  const metrics = buildMetricCards(home);
  const overall = home.rag?.overall || 'unknown';
  const accent = ragAccent(overall);
  return (
    <section className={`${CARD.base} overflow-hidden`}>
      <div className={`h-1.5 ${accent.bar}`} />
      <div className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-[var(--ink)]">{home.home_name}</h2>
              <RagPill value={overall} />
            </div>
            <div className="mt-3">
              <ExceptionStrip metrics={metrics} />
            </div>
          </div>
          <button type="button" className={`${BTN.secondary} ${BTN.sm}`} onClick={() => onOpen(home)}>
            Drilldown
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 border-t border-[var(--line)] px-4 sm:grid-cols-2 lg:grid-cols-5">
        {metrics.map(metric => <MetricTile key={metric.key} metric={metric} />)}
      </div>
    </section>
  );
}

export default function PortfolioDashboard() {
  const navigate = useNavigate();
  const { switchHome } = useData();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generatingPack, setGeneratingPack] = useState(false);
  const [error, setError] = useState(null);
  const [packError, setPackError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPortfolioKpis();
      setPayload(result || { homes: [] });
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load portfolio KPIs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const homes = useMemo(() => (Array.isArray(payload?.homes) ? payload.homes : []), [payload]);
  const sortedHomes = useMemo(() => (
    [...homes].sort((a, b) => {
      const aRank = RAG_RANK[a.rag?.overall || 'unknown'] ?? RAG_RANK.unknown;
      const bRank = RAG_RANK[b.rag?.overall || 'unknown'] ?? RAG_RANK.unknown;
      return aRank - bRank || String(a.home_name || '').localeCompare(String(b.home_name || ''));
    })
  ), [homes]);

  const summary = useMemo(() => {
    const counts = { green: 0, amber: 0, red: 0, unknown: 0 };
    for (const home of homes) {
      const rag = home.rag?.overall || 'unknown';
      counts[rag] = (counts[rag] || 0) + 1;
    }
    return counts;
  }, [homes]);

  function drillIntoHome(home) {
    if (home?.home_slug) switchHome(home.home_slug);
    navigate('/');
  }

  async function generateBoardPack() {
    setGeneratingPack(true);
    setPackError(null);
    try {
      const pack = await getPortfolioBoardPack();
      const { generatePortfolioBoardPackPDF } = await import('../lib/pdfReports.js');
      generatePortfolioBoardPackPDF(pack);
    } catch (e) {
      setPackError(e.message || 'Failed to generate portfolio board pack');
    } finally {
      setGeneratingPack(false);
    }
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Portfolio Dashboard</h1>
          <p className={PAGE.subtitle}>Home-by-home RAG, exceptions and accountability signals.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN.secondary} onClick={load}>Refresh</button>
          <button type="button" className={BTN.primary} onClick={generateBoardPack} disabled={generatingPack || loading || homes.length === 0}>
            {generatingPack ? 'Generating...' : 'Board Pack PDF'}
          </button>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={load} className="mb-4" />}
      {packError && <ErrorState message={packError} onRetry={generateBoardPack} className="mb-4" />}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Red homes" value={summary.red} rag={summary.red > 0 ? 'red' : 'green'} helper="Immediate exception load" />
        <SummaryCard label="Amber homes" value={summary.amber} rag={summary.amber > 0 ? 'amber' : 'green'} helper="Watchlist pressure" />
        <SummaryCard label="Green homes" value={summary.green} rag="green" helper="No red/amber overall" />
        <SummaryCard label="Unknown" value={summary.unknown} rag={summary.unknown > 0 ? 'unknown' : 'green'} helper="Missing KPI coverage" />
      </div>

      {loading ? (
        <div className={CARD.flush}><LoadingState message="Loading portfolio KPIs..." /></div>
      ) : homes.length === 0 ? (
        <div className={CARD.flush}><EmptyState title="No homes available" description="No report-visible homes are assigned to this user." /></div>
      ) : (
        <div className="space-y-4">
          {sortedHomes.map(home => <HomePanel key={home.home_id} home={home} onOpen={drillIntoHome} />)}
        </div>
      )}
    </div>
  );
}
