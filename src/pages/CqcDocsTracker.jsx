import { useCallback, useEffect, useState } from 'react';
import { PAGE, CARD, TABLE, BADGE, BTN } from '../lib/design.js';
import { getCurrentHome, getCqcDocs } from '../lib/api.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import ScanDocumentLink from '../components/ScanDocumentLink.jsx';
import { useData } from '../contexts/DataContext.jsx';

function SummaryCard({ label, value, tone = '' }) {
  return (
    <div className={CARD.padded}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone}`}>{value || 0}</div>
    </div>
  );
}

function CountTable({ title, keyLabel, rows }) {
  return (
    <div className={CARD.flush}>
      <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">{title}</div>
      <div className={TABLE.wrapper}>
        <table className={TABLE.table}>
          <thead className={TABLE.thead}>
            <tr>
              <th scope="col" className={TABLE.th}>{keyLabel}</th>
              <th scope="col" className={TABLE.th}>Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={TABLE.tr}>
                <td className={TABLE.td}>{row.key || '-'}</td>
                <td className={TABLE.td}>{row.count}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr className={TABLE.tr}>
                <td className={TABLE.td} colSpan={2}>No rows found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CqcDocsTracker() {
  const storedHome = getCurrentHome();
  const { activeHome, canWrite, isScanTargetEnabled = () => false } = useData();
  const homeSlug = activeHome || storedHome;
  const canWriteCompliance = Boolean(canWrite?.('compliance'));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!homeSlug) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await getCqcDocs(homeSlug));
    } catch (err) {
      setError(err.message || 'Failed to load CQC documents');
    } finally {
      setLoading(false);
    }
  }, [homeSlug]);

  useEffect(() => { load(); }, [load]);

  if (!homeSlug) {
    return (
      <div className={PAGE.container}>
        <ErrorState title="No home selected" message="Select a home before opening the CQC docs center." />
      </div>
    );
  }
  if (loading) return <div className={PAGE.container}><LoadingState message="Loading CQC documents..." card /></div>;
  if (error) return <div className={PAGE.container}><ErrorState title="CQC documents need attention" message={error} onRetry={load} /></div>;

  const summary = data?.summary || {};
  const evidence = data?.evidence || [];
  const byStatement = data?.byStatement || [];
  const byCategory = data?.byCategory || [];
  const byOwner = data?.byOwner || [];

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>CQC Docs Center</h1>
          <p className={PAGE.subtitle}>See document coverage by statement, evidence category, owner, and review status.</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
          <button type="button" className={`${BTN.secondary} w-full sm:w-auto`} onClick={load}>Refresh</button>
          {canWriteCompliance && isScanTargetEnabled('cqc') && <ScanDocumentLink context={{ target: 'cqc' }} label="Scan to CQC" />}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <SummaryCard label="Documents" value={summary.total_documents} />
        <SummaryCard label="Missing Owner" value={summary.missing_owner_count} tone="text-red-600" />
        <SummaryCard label="Overdue Review" value={summary.overdue_review_count} tone="text-amber-600" />
        <SummaryCard label="Missing Attachment" value={summary.missing_attachment_count} tone="text-red-600" />
      </div>

      <div className={CARD.flush}>
        <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">Evidence Items</div>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Statement</th>
                <th scope="col" className={TABLE.th}>Title</th>
                <th scope="col" className={TABLE.th}>Owner</th>
                <th scope="col" className={TABLE.th}>Review Due</th>
                <th scope="col" className={TABLE.th}>Signals</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((item) => (
                <tr key={item.id} className={TABLE.tr}>
                  <td className={TABLE.td}>{item.quality_statement}</td>
                  <td className={TABLE.td}>{item.title}</td>
                  <td className={TABLE.td}>{item.evidence_owner || '-'}</td>
                  <td className={TABLE.td}>{item.review_due || '-'}</td>
                  <td className={TABLE.td}>
                    <div className="flex flex-wrap gap-2">
                      {item.missing_owner && <span className={BADGE.red}>No owner</span>}
                      {item.missing_attachment && <span className={BADGE.red}>No file</span>}
                      {item.overdue_review && <span className={BADGE.amber}>Overdue review</span>}
                      {!item.missing_owner && !item.missing_attachment && !item.overdue_review && <span className={BADGE.green}>Ready</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {evidence.length === 0 && (
                <tr className={TABLE.tr}>
                  <td className={TABLE.td} colSpan={5}>No CQC evidence documents found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <CountTable title="By Statement" keyLabel="Statement" rows={byStatement} />
        <CountTable title="By Category" keyLabel="Category" rows={byCategory} />
        <CountTable title="By Owner" keyLabel="Owner" rows={byOwner} />
      </div>
    </div>
  );
}
