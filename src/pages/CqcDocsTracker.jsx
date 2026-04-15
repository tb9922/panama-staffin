import { useCallback, useEffect, useState } from 'react';
import { PAGE, CARD, TABLE, BADGE } from '../lib/design.js';
import { getCurrentHome, getCqcDocs } from '../lib/api.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';

export default function CqcDocsTracker() {
  const home = getCurrentHome();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getCqcDocs(home));
    } catch (err) {
      setError(err.message || 'Failed to load CQC documents');
    } finally {
      setLoading(false);
    }
  }, [home]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading CQC documents..." card /></div>;
  if (error) return <div className={PAGE.container}><ErrorState title="CQC documents need attention" message={error} onRetry={load} /></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>CQC Docs Center</h1>
          <p className={PAGE.subtitle}>See document coverage by statement, evidence category, owner, and review status.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className={CARD.padded}><div className="text-xs text-gray-500">Documents</div><div className="mt-1 text-2xl font-bold">{data.summary.total_documents}</div></div>
        <div className={CARD.padded}><div className="text-xs text-gray-500">Missing Owner</div><div className="mt-1 text-2xl font-bold text-red-600">{data.summary.missing_owner_count}</div></div>
        <div className={CARD.padded}><div className="text-xs text-gray-500">Overdue Review</div><div className="mt-1 text-2xl font-bold text-amber-600">{data.summary.overdue_review_count}</div></div>
        <div className={CARD.padded}><div className="text-xs text-gray-500">Missing Attachment</div><div className="mt-1 text-2xl font-bold text-red-600">{data.summary.missing_attachment_count}</div></div>
      </div>

      <div className={CARD.flush}>
        <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">Evidence Items</div>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}><tr><th className={TABLE.th}>Statement</th><th className={TABLE.th}>Title</th><th className={TABLE.th}>Owner</th><th className={TABLE.th}>Review Due</th><th className={TABLE.th}>Signals</th></tr></thead>
            <tbody>
              {data.evidence.map((item) => (
                <tr key={item.id} className={TABLE.tr}>
                  <td className={TABLE.td}>{item.quality_statement}</td>
                  <td className={TABLE.td}>{item.title}</td>
                  <td className={TABLE.td}>{item.evidence_owner || '—'}</td>
                  <td className={TABLE.td}>{item.review_due || '—'}</td>
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
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className={CARD.flush}><div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">By Statement</div><div className={TABLE.wrapper}><table className={TABLE.table}><thead className={TABLE.thead}><tr><th className={TABLE.th}>Statement</th><th className={TABLE.th}>Count</th></tr></thead><tbody>{data.byStatement.map((row) => <tr key={row.key} className={TABLE.tr}><td className={TABLE.td}>{row.key}</td><td className={TABLE.td}>{row.count}</td></tr>)}</tbody></table></div></div>
        <div className={CARD.flush}><div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">By Category</div><div className={TABLE.wrapper}><table className={TABLE.table}><thead className={TABLE.thead}><tr><th className={TABLE.th}>Category</th><th className={TABLE.th}>Count</th></tr></thead><tbody>{data.byCategory.map((row) => <tr key={row.key} className={TABLE.tr}><td className={TABLE.td}>{row.key}</td><td className={TABLE.td}>{row.count}</td></tr>)}</tbody></table></div></div>
        <div className={CARD.flush}><div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">By Owner</div><div className={TABLE.wrapper}><table className={TABLE.table}><thead className={TABLE.thead}><tr><th className={TABLE.th}>Owner</th><th className={TABLE.th}>Count</th></tr></thead><tbody>{data.byOwner.map((row) => <tr key={row.key} className={TABLE.tr}><td className={TABLE.td}>{row.key}</td><td className={TABLE.td}>{row.count}</td></tr>)}</tbody></table></div></div>
      </div>
    </div>
  );
}
