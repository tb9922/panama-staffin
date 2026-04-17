import { useState, useEffect } from 'react';
import { loadAuditLog } from '../lib/api.js';
import { CARD, TABLE, BTN, BADGE, PAGE } from '../lib/design.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import useTransientNotice from '../hooks/useTransientNotice.js';

export default function AuditLog() {
  const [log, setLog] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const { notice, showNotice, clearNotice } = useTransientNotice();
  useEffect(() => { loadAuditLog().then(setLog).catch(err => setError(err.message)).finally(() => setLoading(false)); }, []);

  async function handleExport() {
    setExporting(true);
    try {
      const all = await loadAuditLog(10000);
      const { downloadXLSX } = await import('../lib/excel.js');
      await downloadXLSX('audit-log', [{
        name: 'Audit',
        headers: ['Time', 'Action', 'Home', 'User', 'Details'],
        rows: all.map(e => [
          new Date(e.ts).toLocaleString('en-GB'),
          e.action,
          e.home_slug || e.home || '',
          e.user_name || e.user || '',
          e.details || '',
        ]),
      }]);
      showNotice('Audit log exported.');
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={PAGE.container}>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
        <button onClick={handleExport} disabled={exporting} className={`${BTN.secondary} ${BTN.sm} disabled:opacity-50`}>
          {exporting ? 'Exporting\u2026' : 'Export Excel'}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">Last 100 actions — who changed what and when</p>
      {notice && (
        <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">
          {notice.content}
        </InlineNotice>
      )}
      {error && (
        <ErrorState
          title="Unable to load audit log"
          message={error}
          onRetry={() => {
            setLoading(true);
            setError(null);
            loadAuditLog().then(setLog).catch(err => setError(err.message)).finally(() => setLoading(false));
          }}
          className="mb-4"
        />
      )}
      <div className={CARD.flush}>
        <table className={TABLE.table}>
          <thead className={TABLE.thead}>
            <tr>
              <th scope="col" className={TABLE.th}>Time</th>
              <th scope="col" className={TABLE.th}>Action</th>
              <th scope="col" className={TABLE.th}>Home</th>
              <th scope="col" className={TABLE.th}>User</th>
              <th scope="col" className={TABLE.th}>Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className={TABLE.empty}><LoadingState message="Loading audit log..." compact /></td></tr>
            ) : log.length === 0 ? (
              <tr><td colSpan={5} className={TABLE.empty}><EmptyState title="No audit entries yet" description="Recent activity will appear here as people use the system." compact /></td></tr>
            ) : log.map((entry, i) => (
              <tr key={entry.id ?? `${entry.ts}-${i}`} className={TABLE.tr}>
                <td className={`${TABLE.td} text-xs font-mono text-gray-500`}>{new Date(entry.ts).toLocaleString('en-GB')}</td>
                <td className={TABLE.td}>
                  <span className={entry.action === 'login' ? BADGE.blue : BADGE.green}>{entry.action}</span>
                </td>
                <td className={`${TABLE.td} text-xs`}>{entry.home_slug || entry.home || ''}</td>
                <td className={`${TABLE.td} text-xs font-medium`}>{entry.user_name || entry.user || ''}</td>
                <td className={`${TABLE.td} text-xs text-gray-500`}>{entry.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
