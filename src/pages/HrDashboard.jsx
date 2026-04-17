import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, BADGE, PAGE } from '../lib/design.js';
import TabBar from '../components/TabBar.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import { getCurrentHome, getHrStats, getHrWarnings } from '../lib/api.js';
import { WARNING_LEVELS } from '../lib/hr.js';
import useTransientNotice from '../hooks/useTransientNotice.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'warnings', label: 'Warning Register' },
];

export default function HrDashboard() {
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const home = getCurrentHome();

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const [s, w] = await Promise.all([
        getHrStats(home),
        getHrWarnings(home),
      ]);
      setStats(s);
      setWarnings(Array.isArray(w) ? w : []);
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [home]);

  useEffect(() => { load(); }, [load]);

  async function handleExport() {
    const { downloadXLSX } = await import('../lib/excel.js');
    downloadXLSX('hr_warnings', [{
      name: 'Warnings',
      headers: ['Staff ID', 'Staff Name', 'Warning Type', 'Outcome', 'Expiry Date', 'Case ID'],
      rows: warnings.map(w => [
        w.staff_id, w.staff_name, w.case_type, w.outcome,
        w.warning_expiry_date || '', w.case_id || '',
      ]),
    }]);
    showNotice('Warning register exported to Excel.');
  }

  if (loading) return <div className={PAGE.container}><LoadingState card message="Loading HR data..." /></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>HR & People</h1>
          <p className={PAGE.subtitle}>Disciplinary, grievance, performance and warning register</p>
        </div>
      </div>

      {notice && (
        <InlineNotice className="mb-4" variant={notice.variant} onDismiss={clearNotice}>
          {notice.content}
        </InlineNotice>
      )}
      {error && <ErrorState className="mb-4" title="Unable to load HR data" message={error} onRetry={load} />}

      <TabBar tabs={TABS} activeTab={tab} onTabChange={setTab} className="mb-6" />

      {tab === 'overview' && renderOverview()}
      {tab === 'warnings' && renderWarnings()}
    </div>
  );

  function renderOverview() {
    if (!stats) {
      return (
        <div className={CARD.padded}>
          <EmptyState compact title="No stats available" description="HR summary data will appear here once disciplinary, grievance, performance, or flex records are in place." />
        </div>
      );
    }

    const cards = [
      { label: 'Open Disciplinary', value: stats.disciplinary_open ?? 0, color: stats.disciplinary_open > 0 ? 'text-amber-600' : '' },
      { label: 'Open Grievance', value: stats.grievance_open ?? 0, color: stats.grievance_open > 0 ? 'text-amber-600' : '' },
      { label: 'Active Performance', value: stats.performance_open ?? 0, color: stats.performance_open > 0 ? 'text-amber-600' : '' },
      { label: 'Pending Flex Working', value: stats.flex_working_pending ?? 0, color: stats.flex_working_pending > 0 ? 'text-blue-600' : '' },
    ];

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map(c => (
            <div key={c.label} className={CARD.padded}>
              <p className="text-sm text-gray-500">{c.label}</p>
              <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>

        <div className={CARD.padded}>
          <p className="text-sm text-gray-500">Active Warnings</p>
          <p className={`text-2xl font-bold ${(stats.active_warnings ?? 0) > 0 ? 'text-red-600' : ''}`}>
            {stats.active_warnings ?? 0}
          </p>
          {warnings.length > 0 && (
            <p className="text-sm text-gray-400 mt-1">{warnings.length} on register</p>
          )}
        </div>
      </div>
    );
  }

  function renderWarnings() {
    return (
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Warning Register</h2>
          {warnings.length > 0 && (
            <button className={BTN.secondary + ' ' + BTN.sm} onClick={handleExport}>Export Excel</button>
          )}
        </div>
        <div className={CARD.flush}>
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th scope="col" className={TABLE.th}>Staff ID</th>
                  <th scope="col" className={TABLE.th}>Staff Name</th>
                  <th scope="col" className={TABLE.th}>Warning Type</th>
                  <th scope="col" className={TABLE.th}>Outcome</th>
                  <th scope="col" className={TABLE.th}>Expiry Date</th>
                  <th scope="col" className={TABLE.th}>Case ID</th>
                </tr>
              </thead>
              <tbody>
                {warnings.length === 0 && (
                  <tr>
                    <td colSpan={6} className={TABLE.empty}>
                      <EmptyState compact title="No active warnings" description="Current written and final warnings will appear here while they remain live." />
                    </td>
                  </tr>
                )}
                {warnings.map(w => {
                  const level = WARNING_LEVELS.find(l => l.id === w.outcome);
                  return (
                    <tr key={w.case_id || `${w.staff_id}-${w.expiry_date}`} className={TABLE.tr}>
                      <td className={TABLE.tdMono}>{w.staff_id}</td>
                      <td className={TABLE.td}>{w.staff_name || '—'}</td>
                      <td className={TABLE.td}>{w.case_type || '—'}</td>
                      <td className={TABLE.td}>
                        <span className={BADGE[level?.badgeKey || 'gray']}>{level?.name || w.outcome || '—'}</span>
                      </td>
                      <td className={TABLE.td}>{w.warning_expiry_date || '—'}</td>
                      <td className={TABLE.tdMono}>{w.case_id || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }
}
