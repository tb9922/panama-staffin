import { useCallback, useEffect, useState } from 'react';
import { loadAuditLog } from '../lib/api.js';
import { BTN, CARD, INPUT, PAGE, TABLE, BADGE } from '../lib/design.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Pagination from '../components/Pagination.jsx';
import { useToast } from '../contexts/ToastContext.jsx';

const PAGE_SIZE = 50;

function formatAuditDetails(details) {
  if (!details) return { summary: '—', full: '' };
  try {
    const parsed = JSON.parse(details);
    const full = JSON.stringify(parsed, null, 2);
    const summary = JSON.stringify(parsed).slice(0, 120);
    return { summary: summary.length < JSON.stringify(parsed).length ? `${summary}…` : summary, full };
  } catch {
    return { summary: details.length > 120 ? `${details.slice(0, 120)}…` : details, full: details };
  }
}

export default function AuditLog() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [homeFilter, setHomeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const { showToast } = useToast();

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    loadAuditLog({ limit: PAGE_SIZE, offset, action: actionFilter, user: userFilter, home: homeFilter, dateFrom, dateTo })
      .then((result) => {
        setRows(result.rows || []);
        setTotal(result.total || 0);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [offset, actionFilter, userFilter, homeFilter, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  function updateFilter(setter, value) {
    setter(value);
    setOffset(0);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const result = await loadAuditLog({ limit: 10000, offset: 0, action: actionFilter, user: userFilter, home: homeFilter, dateFrom, dateTo });
      const { downloadXLSX } = await import('../lib/excel.js');
      await downloadXLSX('audit-log', [{
        name: 'Audit',
        headers: ['Time', 'Action', 'Home', 'User', 'Details'],
        rows: (result.rows || []).map((entry) => [
          new Date(entry.ts).toLocaleString('en-GB'),
          entry.action,
          entry.home_slug || entry.home || '',
          entry.user_name || entry.user || '',
          formatAuditDetails(entry.details).full || '',
        ]),
      }]);
      showToast({
        title: 'Audit log exported',
        message: result.total > 10000 ? 'The first 10,000 matching rows were exported.' : 'Excel workbook downloaded.',
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  const hasFilters = Boolean(actionFilter || userFilter || homeFilter || dateFrom || dateTo);

  if (loading && rows.length === 0) return <div className={PAGE.container}><LoadingState message="Loading audit log..." /></div>;
  if (error && rows.length === 0) return <div className={PAGE.container}><ErrorState title="Audit log needs attention" message={error} onRetry={load} /></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Audit Log</h1>
          <p className="text-sm text-gray-500">Search who changed what, when, and in which home without exporting first.</p>
        </div>
        <button type="button" onClick={handleExport} disabled={exporting} className={`${BTN.secondary} ${BTN.sm} disabled:opacity-50`}>
          {exporting ? 'Exporting...' : 'Export Excel'}
        </button>
      </div>

      <div className={`${CARD.padded} mb-4`}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label>
            <span className={INPUT.label}>Action</span>
            <input value={actionFilter} onChange={(e) => updateFilter(setActionFilter, e.target.value)} className={INPUT.base} placeholder="login, payroll_update…" />
          </label>
          <label>
            <span className={INPUT.label}>User</span>
            <input value={userFilter} onChange={(e) => updateFilter(setUserFilter, e.target.value)} className={INPUT.base} placeholder="Username" />
          </label>
          <label>
            <span className={INPUT.label}>Home</span>
            <input value={homeFilter} onChange={(e) => updateFilter(setHomeFilter, e.target.value)} className={INPUT.base} placeholder="home-slug" />
          </label>
          <label>
            <span className={INPUT.label}>From</span>
            <input type="date" value={dateFrom} onChange={(e) => updateFilter(setDateFrom, e.target.value)} className={INPUT.base} />
          </label>
          <label>
            <span className={INPUT.label}>To</span>
            <input type="date" value={dateTo} onChange={(e) => updateFilter(setDateTo, e.target.value)} className={INPUT.base} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={BADGE.blue}>{total} matching row{total === 1 ? '' : 's'}</span>
          {hasFilters && (
            <button type="button" onClick={() => { setActionFilter(''); setUserFilter(''); setHomeFilter(''); setDateFrom(''); setDateTo(''); setOffset(0); }} className={`${BTN.ghost} ${BTN.sm}`}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {error && <ErrorState title="Audit query needs attention" message={error} onRetry={load} className="mb-4" />}

      <div className={CARD.flush}>
        {rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No audit rows match these filters' : 'No audit entries yet'}
            description={hasFilters ? 'Try broadening the filters or clearing the date range.' : 'Audit history will appear here as users sign in and make changes.'}
            compact
            className="px-4"
          />
        ) : (
          <>
            <div className={TABLE.wrapper}>
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
                  {rows.map((entry, index) => {
                    const details = formatAuditDetails(entry.details);
                    return (
                      <tr key={entry.id ?? `${entry.ts}-${index}`} className={TABLE.tr}>
                        <td className={`${TABLE.td} text-xs font-mono text-gray-500`}>{new Date(entry.ts).toLocaleString('en-GB')}</td>
                        <td className={TABLE.td}><span className={entry.action === 'login' ? BADGE.blue : BADGE.green}>{entry.action}</span></td>
                        <td className={`${TABLE.td} text-xs`}>{entry.home_slug || entry.home || '—'}</td>
                        <td className={`${TABLE.td} text-xs font-medium`}>{entry.user_name || entry.user || '—'}</td>
                        <td className={`${TABLE.td} text-xs text-gray-500`}>
                          {details.full && details.full !== details.summary ? (
                            <details>
                              <summary className="cursor-pointer text-blue-600 hover:text-blue-800">{details.summary}</summary>
                              <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-gray-600">{details.full}</pre>
                            </details>
                          ) : details.summary}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
          </>
        )}
      </div>
    </div>
  );
}
