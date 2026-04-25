import { useState, useEffect } from 'react';
import { loadAuditLog } from '../lib/api.js';
import { CARD, TABLE, BTN, BADGE, PAGE } from '../lib/design.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import useTransientNotice from '../hooks/useTransientNotice.js';

function formatValue(value) {
  if (value == null || value === '') return 'empty';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatAuditDetails(details) {
  if (!details) return '-';
  try {
    const parsed = typeof details === 'string' ? JSON.parse(details) : details;
    if (Array.isArray(parsed?.changes)) {
      const target = parsed.id != null ? `#${parsed.id} ` : '';
      return `${target}${parsed.changes.map(change => {
        const field = change.field || 'field';
        return `${field}: ${formatValue(change.old)} -> ${formatValue(change.new)}`;
      }).join('; ')}`;
    }
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed)
        .map(([key, value]) => `${key}: ${formatValue(value)}`)
        .join('; ');
    }
  } catch {
    // Fall through to a lightly cleaned plain-text display.
  }
  return String(details)
    .replace(/\bnull\b/g, 'empty')
    .replace(/\bundefined\b/g, 'empty');
}

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
          formatAuditDetails(e.details),
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
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Audit Log</h1>
          <p className={PAGE.subtitle}>Last 100 actions, who changed what and when</p>
        </div>
        <button onClick={handleExport} disabled={exporting} className={`${BTN.secondary} ${BTN.sm} w-full whitespace-nowrap disabled:opacity-50 sm:w-auto`}>
          {exporting ? 'Exporting...' : 'Export Excel'}
        </button>
      </div>
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
      <div className={`${CARD.flush} max-w-full`}>
        <div className={TABLE.wrapper}>
        <table className={`${TABLE.table} min-w-[900px]`}>
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
                <td className={`${TABLE.td} text-xs font-mono text-[var(--ink-3)]`}>{new Date(entry.ts).toLocaleString('en-GB')}</td>
                <td className={TABLE.td}>
                  <span className={entry.action === 'login' ? BADGE.blue : BADGE.green}>{entry.action}</span>
                </td>
                <td className={`${TABLE.td} text-xs`}>{entry.home_slug || entry.home || ''}</td>
                <td className={`${TABLE.td} text-xs font-medium`}>{entry.user_name || entry.user || ''}</td>
                <td className={`${TABLE.td} max-w-[32rem] text-xs text-[var(--ink-3)]`}>{formatAuditDetails(entry.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
