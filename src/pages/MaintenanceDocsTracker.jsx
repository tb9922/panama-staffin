import { useCallback, useEffect, useState } from 'react';
import { PAGE, CARD, TABLE, BADGE } from '../lib/design.js';
import { getCurrentHome, getMaintenanceDocs } from '../lib/api.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import ScanDocumentLink from '../components/ScanDocumentLink.jsx';
import { useData } from '../contexts/DataContext.jsx';

function SignalBadge({ value, goodLabel = 'OK', badLabel }) {
  return value > 0 ? <span className={BADGE.red}>{badLabel || value}</span> : <span className={BADGE.green}>{goodLabel}</span>;
}

export default function MaintenanceDocsTracker() {
  const home = getCurrentHome();
  const { canWrite, isScanTargetEnabled = () => false } = useData();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getMaintenanceDocs(home));
    } catch (err) {
      setError(err.message || 'Failed to load maintenance documents');
    } finally {
      setLoading(false);
    }
  }, [home]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading maintenance documents..." card /></div>;
  if (error) return <div className={PAGE.container}><ErrorState title="Maintenance documents need attention" message={error} onRetry={load} /></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Maintenance Docs Center</h1>
          <p className={PAGE.subtitle}>Certificates, service sheets, contractor evidence, and missing-proof gaps.</p>
        </div>
        {canWrite('compliance') && isScanTargetEnabled('maintenance') && <ScanDocumentLink context={{ target: 'maintenance' }} label="Scan to Maintenance" />}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className={CARD.padded}><div className="text-xs text-gray-500">Checks</div><div className="mt-1 text-2xl font-bold">{data.summary.total_checks}</div></div>
        <div className={CARD.padded}><div className="text-xs text-gray-500">Missing Evidence</div><div className="mt-1 text-2xl font-bold text-red-600">{data.summary.missing_evidence_count}</div></div>
        <div className={CARD.padded}><div className="text-xs text-gray-500">Certificate Expiring</div><div className="mt-1 text-2xl font-bold text-amber-600">{data.summary.expiring_count}</div></div>
        <div className={CARD.padded}><div className="text-xs text-gray-500">Overdue</div><div className="mt-1 text-2xl font-bold text-red-600">{data.summary.overdue_count}</div></div>
      </div>

      <div className={CARD.flush}>
        <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">By Check</div>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th className={TABLE.th}>Check</th>
                <th className={TABLE.th}>Contractor</th>
                <th className={TABLE.th}>Status</th>
                <th className={TABLE.th}>Docs</th>
                <th className={TABLE.th}>Signals</th>
              </tr>
            </thead>
            <tbody>
              {data.checks.map((check) => (
                <tr key={check.id} className={TABLE.tr}>
                  <td className={TABLE.td}>
                    <div className="font-medium">{check.category_name}</div>
                    <div className="text-xs text-gray-500">{check.description || 'No description'}</div>
                  </td>
                  <td className={TABLE.td}>{check.contractor || '—'}</td>
                  <td className={TABLE.td}><span className={BADGE[check.status.status === 'overdue' ? 'red' : check.status.status === 'due_soon' ? 'amber' : 'green']}>{check.status.label}</span></td>
                  <td className={TABLE.td}>{check.attachment_count}</td>
                  <td className={TABLE.td}>
                    <div className="flex flex-wrap gap-2">
                      {check.missing_evidence && <span className={BADGE.red}>Missing evidence</span>}
                      {check.certificate_expiring && <span className={BADGE.amber}>Certificate expiring</span>}
                      {!check.missing_evidence && !check.certificate_expiring && <span className={BADGE.green}>Covered</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className={CARD.flush}>
          <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">By Category</div>
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}><tr><th className={TABLE.th}>Category</th><th className={TABLE.th}>Checks</th><th className={TABLE.th}>Docs</th><th className={TABLE.th}>Signals</th></tr></thead>
              <tbody>
                {data.byCategory.map((row) => (
                  <tr key={row.id} className={TABLE.tr}>
                    <td className={TABLE.td}>{row.name}</td>
                    <td className={TABLE.td}>{row.checks}</td>
                    <td className={TABLE.td}>{row.attachment_count}</td>
                    <td className={TABLE.td}>
                      <div className="flex flex-wrap gap-2">
                        <SignalBadge value={row.missing_evidence_count} badLabel={`${row.missing_evidence_count} missing`} />
                        <SignalBadge value={row.expiring_count} badLabel={`${row.expiring_count} expiring`} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={CARD.flush}>
          <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">By Contractor</div>
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}><tr><th className={TABLE.th}>Contractor</th><th className={TABLE.th}>Checks</th><th className={TABLE.th}>Docs</th><th className={TABLE.th}>Coverage</th></tr></thead>
              <tbody>
                {data.byContractor.map((row) => (
                  <tr key={row.contractor} className={TABLE.tr}>
                    <td className={TABLE.td}>{row.contractor}</td>
                    <td className={TABLE.td}>{row.checks}</td>
                    <td className={TABLE.td}>{row.attachment_count}</td>
                    <td className={TABLE.td}>{row.evidence_gap ? <span className={BADGE.red}>Gap</span> : <span className={BADGE.green}>Covered</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
