import { useState, useEffect } from 'react';
import { loadAuditLog } from '../lib/api.js';
import { CARD, TABLE, BTN, BADGE } from '../lib/design.js';

export default function AuditLog() {
  const [log, setLog] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
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
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
        <button onClick={handleExport} disabled={exporting} className={`${BTN.secondary} ${BTN.sm} disabled:opacity-50`}>
          {exporting ? 'Exporting\u2026' : 'Export Excel'}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">Last 100 actions — who changed what and when</p>
      {error && <p className="text-red-600 mb-4" role="alert">Failed to load audit log: {error}</p>}
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
              <tr><td colSpan={5} className={TABLE.empty} role="status">Loading audit log…</td></tr>
            ) : log.length === 0 ? (
              <tr><td colSpan={5} className={TABLE.empty}>No audit entries yet</td></tr>
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
