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

const METRIC_META = {
  staffing: { label: 'Staffing', route: '/day', actionLabel: 'Open rota' },
  training: { label: 'Training', route: '/training', actionLabel: 'Open matrix' },
  manager_actions: { label: 'Actions', route: '/actions', actionLabel: 'Open actions' },
  incidents: { label: 'Incidents', route: '/incidents', actionLabel: 'Open incidents' },
  complaints: { label: 'Complaints', route: '/complaints', actionLabel: 'Open complaints' },
  cqc_evidence: { label: 'CQC', route: '/cqc', actionLabel: 'Open evidence' },
  maintenance: { label: 'Maintenance', route: '/maintenance', actionLabel: 'Open checks' },
  agency: { label: 'Agency', route: '/payroll/agency', actionLabel: 'Open agency' },
  occupancy: { label: 'Occupancy', route: '/beds', actionLabel: 'Open beds' },
  outcomes: { label: 'Outcomes', route: '/outcomes', actionLabel: 'Open outcomes' },
};

const ROUTE_ALIASES = {
  '/agency': '/payroll/agency',
};

function normalizeRag(rag) {
  return RAG_LABELS[rag] ? rag : 'unknown';
}

function ragBadge(rag) {
  const value = normalizeRag(rag);
  if (value === 'green') return BADGE.green;
  if (value === 'amber') return BADGE.amber;
  if (value === 'red') return BADGE.red;
  return BADGE.gray;
}

function ragAccent(rag) {
  const value = normalizeRag(rag);
  if (value === 'red') return ESC_COLORS.red;
  if (value === 'amber') return ESC_COLORS.amber;
  if (value === 'green') return ESC_COLORS.green;
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

function formatCqcReadiness(overall) {
  if (!overall) return 'Readiness pending';
  if (typeof overall === 'string') {
    return `${overall.replace(/_/g, ' ')} readiness`;
  }
  const label = overall.label || overall.band || overall.badge;
  if (!label) return 'Readiness pending';
  return `${String(label).replace(/^Heuristic:\s*/i, '').replace(/_/g, ' ')} readiness`;
}

function existingRoute(route) {
  return ROUTE_ALIASES[route] || route || null;
}

function dataQualitySignals(home) {
  return Array.isArray(home.data_quality?.unknown_signals) ? home.data_quality.unknown_signals : [];
}

function signalForMetric(home, key) {
  return dataQualitySignals(home).find(signal => signal.key === key) || null;
}

function RagPill({ value, className = '' }) {
  const rag = normalizeRag(value);
  return <span className={`${ragBadge(rag)} whitespace-nowrap ${className}`.trim()}>{RAG_LABELS[rag]}</span>;
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

function withSignal(home, metric) {
  const signal = signalForMetric(home, metric.key);
  if (!signal) return metric;
  return {
    ...metric,
    label: signal.label || metric.label,
    detail: signal.reason || metric.detail,
    fix: signal.fix || null,
    route: existingRoute(signal.route || metric.route),
  };
}

function buildMetricCards(home) {
  const plannedSlots = Number(home.staffing?.planned_shift_slots_7d || 0);
  const metrics = [
    {
      key: 'staffing',
      ...METRIC_META.staffing,
      rag: normalizeRag(home.rag?.staffing),
      value: plannedSlots > 0 ? `${formatNumber(home.staffing?.gaps_7d)} gaps` : 'No baseline',
      detail: plannedSlots > 0
        ? `${formatNumber(home.staffing?.gaps_per_100_planned_shifts)} per 100 shifts`
        : 'Set minimum staffing rules',
    },
    {
      key: 'training',
      ...METRIC_META.training,
      rag: normalizeRag(home.rag?.training),
      value: formatPct(home.training?.compliance_pct),
      detail: home.training?.baseline_configured === false
        ? 'Configure mandatory training'
        : `${formatNumber(home.training?.expired)} expired`,
    },
    {
      key: 'manager_actions',
      ...METRIC_META.manager_actions,
      rag: normalizeRag(home.rag?.manager_actions),
      value: `${formatNumber(home.manager_actions?.open)} open`,
      detail: `${formatNumber(home.manager_actions?.overdue)} overdue`,
    },
    {
      key: 'incidents',
      ...METRIC_META.incidents,
      rag: normalizeRag(home.rag?.incidents),
      value: `${formatNumber(home.incidents?.open)} open`,
      detail: `${formatNumber(home.incidents?.rate_per_resident_month)} per resident-month`,
    },
    {
      key: 'complaints',
      ...METRIC_META.complaints,
      rag: normalizeRag(home.rag?.complaints),
      value: `${formatNumber(home.complaints?.open)} open`,
      detail: `${formatNumber(home.complaints?.rate_per_resident_month)} per resident-month`,
    },
    {
      key: 'cqc_evidence',
      ...METRIC_META.cqc_evidence,
      rag: normalizeRag(home.rag?.cqc_evidence),
      value: `${formatNumber(home.cqc_evidence?.open_gaps)} gaps`,
      detail: formatCqcReadiness(home.cqc_evidence?.overall),
    },
    {
      key: 'maintenance',
      ...METRIC_META.maintenance,
      rag: normalizeRag(home.rag?.maintenance),
      value: `${formatNumber(home.maintenance?.overdue)} overdue`,
      detail: `${formatNumber(home.maintenance?.due_30d)} due in 30 days`,
    },
    {
      key: 'agency',
      ...METRIC_META.agency,
      rag: normalizeRag(home.rag?.agency),
      value: `${formatNumber(home.agency?.shifts_28d)} shifts`,
      detail: `${formatPct(home.agency?.emergency_override_pct)} emergency`,
    },
    {
      key: 'occupancy',
      ...METRIC_META.occupancy,
      rag: normalizeRag(home.rag?.occupancy),
      value: formatPct(home.occupancy?.pct),
      detail: `${formatNumber(home.occupancy?.available)} available / ${formatNumber(home.occupancy?.hospital_hold)} held`,
    },
    {
      key: 'outcomes',
      ...METRIC_META.outcomes,
      rag: normalizeRag(home.rag?.outcomes),
      value: `${formatNumber(home.outcomes?.falls_28d)} falls`,
      detail: `${formatNumber(home.outcomes?.infections_28d)} infections`,
    },
  ];
  return metrics.map(metric => withSignal(home, metric));
}

function actionLabelForMetric(metric) {
  return metric.rag === 'unknown' ? 'Fix coverage' : metric.actionLabel;
}

function MetricTile({ metric, home, onOpenMetric }) {
  const accent = ragAccent(metric.rag);
  const showAction = metric.route && (metric.rag === 'red' || metric.rag === 'unknown');
  return (
    <div className="flex min-h-32 flex-col border-t border-[var(--line)] py-3 sm:border-l sm:px-3 sm:[&:nth-child(-n+2)]:border-t-0 sm:[&:nth-child(2n+1)]:border-l-0 lg:[&:nth-child(-n+5)]:border-t-0 lg:[&:nth-child(5n+1)]:border-l-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-[var(--ink-3)]">{metric.label}</p>
        <RagPill value={metric.rag} />
      </div>
      <p className={`text-base font-semibold ${accent.text}`}>{metric.value}</p>
      <p className="mt-1 text-xs text-[var(--ink-3)]">{metric.detail}</p>
      {metric.fix && <p className="mt-1 text-xs font-medium text-[var(--ink-2)]">{metric.fix}</p>}
      {showAction && (
        <button
          type="button"
          className={`${BTN.ghost} ${BTN.xs} mt-auto self-start`}
          onClick={() => onOpenMetric(home, metric)}
          aria-label={`${actionLabelForMetric(metric)} for ${home.home_name} ${metric.label}${metric.fix ? `: ${metric.fix}` : ''}`}
        >
          {actionLabelForMetric(metric)}
        </button>
      )}
    </div>
  );
}

function ExceptionStrip({ metrics }) {
  const exceptions = metrics.filter(metric => metric.rag === 'red' || metric.rag === 'amber' || metric.rag === 'unknown');
  if (exceptions.length === 0) {
    return <p className="text-sm text-[var(--ink-3)]">No current red, amber or unknown exception signals.</p>;
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

function CoveragePanel({ unknownSignals, onOpenMetric }) {
  const unknownCount = unknownSignals.length;
  const grouped = unknownSignals.reduce((acc, item) => {
    const key = item.home.home_id || item.home.home_slug || item.home.home_name;
    const existing = acc.get(key) || { home: item.home, metrics: [] };
    existing.metrics.push(item.signal);
    acc.set(key, existing);
    return acc;
  }, new Map());
  const groups = [...grouped.values()];

  return (
    <section className={`${CARD.base} mb-5 overflow-hidden`}>
      <div className="border-b border-[var(--line)] p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--ink)]">Unknown KPI coverage</h2>
            <p className="mt-1 text-sm text-[var(--ink-3)]">
              {unknownCount > 0
                ? `${unknownCount} missing KPI signal${unknownCount === 1 ? '' : 's'} need owner review before board sign-off.`
                : 'KPI coverage is complete across all visible homes.'}
            </p>
          </div>
          <RagPill value={unknownCount > 0 ? 'unknown' : 'green'} />
        </div>
      </div>
      {unknownCount > 0 && (
        <div className="divide-y divide-[var(--line)]">
          {groups.map(group => (
            <div key={group.home.home_id || group.home.home_slug || group.home.home_name} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-center">
              <div>
                <p className="font-medium text-[var(--ink)]">{group.home.home_name}</p>
                <p className="text-xs text-[var(--ink-3)]">{group.metrics.length} unknown domain{group.metrics.length === 1 ? '' : 's'}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {group.metrics.map(metric => (
                  <div key={metric.key} className="rounded-lg border border-[var(--line)] bg-[var(--paper-2)] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-[var(--ink)]">{metric.label}</p>
                      <RagPill value="unknown" />
                    </div>
                    <p className="mt-2 text-xs text-[var(--ink-3)]">{metric.reason}</p>
                    <p className="mt-1 text-xs font-medium text-[var(--ink-2)]">{metric.fix}</p>
                    {metric.route && (
                      <button
                        type="button"
                        className={`${BTN.secondary} ${BTN.xs} mt-3`}
                        onClick={() => onOpenMetric(group.home, metric)}
                        aria-label={`Fix ${metric.label} coverage for ${group.home.home_name}: ${metric.fix}`}
                      >
                        Fix coverage
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function HomePanel({ home, onOpen, onOpenMetric }) {
  const metrics = buildMetricCards(home);
  const overall = normalizeRag(home.rag?.overall);
  const accent = ragAccent(overall);
  const counts = metrics.reduce((acc, metric) => {
    acc[metric.rag] = (acc[metric.rag] || 0) + 1;
    return acc;
  }, { red: 0, amber: 0, unknown: 0 });
  return (
    <section className={`${CARD.base} overflow-hidden`}>
      <div className={`h-1.5 ${accent.bar}`} />
      <div className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-[var(--ink)]">{home.home_name}</h2>
              <RagPill value={overall} />
              <span className={BADGE.gray}>{counts.red} red</span>
              <span className={BADGE.gray}>{counts.amber} amber</span>
              <span className={BADGE.gray}>{counts.unknown} unknown</span>
            </div>
            <div className="mt-3">
              <ExceptionStrip metrics={metrics} />
            </div>
          </div>
          <button type="button" className={`${BTN.secondary} ${BTN.sm}`} onClick={() => onOpen(home)} aria-label={`Drill into ${home.home_name}`}>
            Drilldown
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 border-t border-[var(--line)] px-4 sm:grid-cols-2 lg:grid-cols-5">
        {metrics.map(metric => (
          <MetricTile key={metric.key} metric={metric} home={home} onOpenMetric={onOpenMetric} />
        ))}
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
      const rag = normalizeRag(home.rag?.overall);
      counts[rag] = (counts[rag] || 0) + 1;
    }
    return counts;
  }, [homes]);

  const unknownSignals = useMemo(() => (
    sortedHomes.flatMap(home => dataQualitySignals(home)
      .map(signal => ({
        home,
        signal: {
          ...signal,
          route: existingRoute(signal.route),
        },
      })))
  ), [sortedHomes]);

  function drillIntoHome(home) {
    if (home?.home_slug) switchHome(home.home_slug);
    navigate('/');
  }

  function openMetric(home, metric) {
    if (home?.home_slug) switchHome(home.home_slug);
    navigate(metric.route || '/');
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

      {error && !loading && <ErrorState message={error} onRetry={load} className="mb-4" />}
      {!error && packError && (
        <ErrorState
          title="Unable to generate board pack"
          message={packError}
          onRetry={generateBoardPack}
          retryLabel="Try again"
          className="mb-4"
        />
      )}

      {!error && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Red homes" value={summary.red} rag={summary.red > 0 ? 'red' : 'green'} helper="Immediate exception load" />
          <SummaryCard label="Amber homes" value={summary.amber} rag={summary.amber > 0 ? 'amber' : 'green'} helper="Watchlist pressure" />
          <SummaryCard label="Green homes" value={summary.green} rag="green" helper="No red/amber overall" />
          <SummaryCard label="Unknown coverage" value={unknownSignals.length} rag={unknownSignals.length > 0 ? 'unknown' : 'green'} helper={`${summary.unknown} homes unknown overall`} />
        </div>
      )}

      {loading ? (
        <div className={CARD.flush}><LoadingState message="Loading portfolio KPIs..." /></div>
      ) : error ? null : homes.length === 0 ? (
        <div className={CARD.flush}><EmptyState title="No homes available" description="No report-visible homes are assigned to this user." /></div>
      ) : (
        <div className="space-y-5">
          <div className="space-y-4">
            {sortedHomes.map(home => (
              <HomePanel key={home.home_id} home={home} onOpen={drillIntoHome} onOpenMetric={openMetric} />
            ))}
          </div>
          <CoveragePanel unknownSignals={unknownSignals} onOpenMetric={openMetric} />
        </div>
      )}
    </div>
  );
}
