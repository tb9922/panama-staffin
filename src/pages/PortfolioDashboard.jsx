import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BADGE, BTN, CARD, PAGE, TABLE } from '../lib/design.js';
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

function ragBadge(rag) {
  if (rag === 'green') return BADGE.green;
  if (rag === 'amber') return BADGE.amber;
  if (rag === 'red') return BADGE.red;
  return BADGE.gray;
}

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString();
}

function formatPct(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `${Math.round(Number(value))}%`;
}

function RagPill({ value }) {
  return <span className={ragBadge(value)}>{RAG_LABELS[value] || 'Unknown'}</span>;
}

function StatCard({ label, value, rag }) {
  return (
    <div className={CARD.padded}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-[var(--ink-3)]">{label}</p>
        <RagPill value={rag} />
      </div>
      <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">{value}</p>
    </div>
  );
}

function metricParts(home) {
  return {
    staffing: `${formatNumber(home.staffing?.gaps_7d)} gaps / ${formatNumber(home.staffing?.gaps_per_100_planned_shifts)} per 100`,
    training: `${formatPct(home.training?.compliance_pct)} compliant`,
    actions: `${formatNumber(home.manager_actions?.open)} open / ${formatNumber(home.manager_actions?.overdue)} overdue`,
    incidents: `${formatNumber(home.incidents?.open)} open`,
    complaints: `${formatNumber(home.complaints?.open)} open`,
    cqc: `${formatNumber(home.cqc_evidence?.open_gaps)} gaps`,
    maintenance: `${formatNumber(home.maintenance?.overdue)} overdue`,
    agency: `${formatNumber(home.agency?.shifts_28d)} shifts`,
    occupancy: formatPct(home.occupancy?.pct),
    outcomes: `Falls ${formatNumber(home.outcomes?.falls_28d)} / infections ${formatNumber(home.outcomes?.infections_28d)}`,
  };
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

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Red homes" value={summary.red} rag={summary.red > 0 ? 'red' : 'green'} />
        <StatCard label="Amber homes" value={summary.amber} rag={summary.amber > 0 ? 'amber' : 'green'} />
        <StatCard label="Green homes" value={summary.green} rag="green" />
        <StatCard label="Unknown" value={summary.unknown} rag={summary.unknown > 0 ? 'unknown' : 'green'} />
      </div>

      <div className={CARD.flush}>
        {loading ? <LoadingState message="Loading portfolio KPIs..." /> : (
          homes.length === 0 ? (
            <EmptyState title="No homes available" description="No report-visible homes are assigned to this user." />
          ) : (
            <div className={TABLE.wrapper}>
              <table className={TABLE.table}>
                <thead className={TABLE.thead}>
                  <tr>
                    <th className={TABLE.th}>Home</th>
                    <th className={TABLE.th}>Overall</th>
                    <th className={TABLE.th}>Staffing</th>
                    <th className={TABLE.th}>Training</th>
                    <th className={TABLE.th}>Actions</th>
                    <th className={TABLE.th}>Incidents</th>
                    <th className={TABLE.th}>Complaints</th>
                    <th className={TABLE.th}>CQC</th>
                    <th className={TABLE.th}>Maintenance</th>
                    <th className={TABLE.th}>Agency</th>
                    <th className={TABLE.th}>Occupancy</th>
                    <th className={TABLE.th}>Outcomes</th>
                    <th className={TABLE.th}>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {homes.map(home => {
                    const parts = metricParts(home);
                    return (
                      <tr key={home.home_id} className={TABLE.tr}>
                        <td className={TABLE.td}>
                          <button type="button" className="text-left font-medium text-[var(--ink)] hover:text-[var(--accent)]" onClick={() => drillIntoHome(home)}>
                            {home.home_name}
                          </button>
                        </td>
                        <td className={TABLE.td}><RagPill value={home.rag?.overall} /></td>
                        <td className={TABLE.td}><RagPill value={home.rag?.staffing} /> <span className="ml-2 text-[var(--ink-3)]">{parts.staffing}</span></td>
                        <td className={TABLE.td}><RagPill value={home.rag?.training} /> <span className="ml-2 text-[var(--ink-3)]">{parts.training}</span></td>
                        <td className={TABLE.td}><RagPill value={home.rag?.manager_actions} /> <span className="ml-2 text-[var(--ink-3)]">{parts.actions}</span></td>
                        <td className={TABLE.td}><RagPill value={home.rag?.incidents} /> <span className="ml-2 text-[var(--ink-3)]">{parts.incidents}</span></td>
                        <td className={TABLE.td}><RagPill value={home.rag?.complaints} /> <span className="ml-2 text-[var(--ink-3)]">{parts.complaints}</span></td>
                        <td className={TABLE.td}><RagPill value={home.rag?.cqc_evidence} /> <span className="ml-2 text-[var(--ink-3)]">{parts.cqc}</span></td>
                        <td className={TABLE.td}><RagPill value={home.rag?.maintenance} /> <span className="ml-2 text-[var(--ink-3)]">{parts.maintenance}</span></td>
                        <td className={TABLE.td}><RagPill value={home.rag?.agency} /> <span className="ml-2 text-[var(--ink-3)]">{parts.agency}</span></td>
                        <td className={TABLE.td}><RagPill value={home.rag?.occupancy} /> <span className="ml-2 text-[var(--ink-3)]">{parts.occupancy}</span></td>
                        <td className={TABLE.td}><RagPill value={home.rag?.outcomes} /> <span className="ml-2 text-[var(--ink-3)]">{parts.outcomes}</span></td>
                        <td className={TABLE.td}>
                          <button type="button" className={`${BTN.ghost} ${BTN.xs}`} onClick={() => drillIntoHome(home)}>Drilldown</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
