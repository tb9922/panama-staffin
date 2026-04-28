import { useCallback, useId, useState } from 'react';
import { BADGE, BTN, CARD, INPUT, PAGE, TABLE } from '../lib/design.js';
import EmptyState from '../components/EmptyState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { useData } from '../contexts/DataContext.jsx';
import { getInternalBankCandidates } from '../lib/api.js';
import { todayLocalISO } from '../lib/localDates.js';

const SHIFT_CODES = ['AG-E', 'AG-L', 'AG-N'];
const ROLE_OPTIONS = ['', 'Carer', 'Senior Carer', 'Team Lead', 'Night Carer', 'Night Senior'];

function statusBadge(candidate) {
  if (candidate.viable) return BADGE.green;
  if (candidate.availability === 'unavailable') return BADGE.red;
  return BADGE.amber;
}

function trainingBadge(status) {
  if (status === 'ok') return BADGE.green;
  if (status === 'blocked') return BADGE.red;
  return BADGE.gray;
}

export default function InternalBank() {
  const ids = {
    role: useId(),
    date: useId(),
    shift: useId(),
    hours: useId(),
  };
  const { activeHome } = useData();
  const [filters, setFilters] = useState({
    role: '',
    shift_date: todayLocalISO(),
    shift_code: 'AG-E',
    hours: '8',
  });
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function setFilter(key, value) {
    setFilters(current => ({ ...current, [key]: value }));
  }

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getInternalBankCandidates(activeHome, filters);
      setPayload(result || { candidates: [] });
    } catch (e) {
      setError(e.message || 'Failed to load internal bank candidates');
    } finally {
      setLoading(false);
    }
  }, [activeHome, filters]);

  const candidates = payload?.candidates || [];

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Internal Bank</h1>
          <p className={PAGE.subtitle}>Find available staff before approving agency cover.</p>
        </div>
      </div>

      <div className={`${CARD.padded} mb-5`}>
        <div className="grid gap-4 md:grid-cols-5">
          <div>
            <label htmlFor={ids.role} className={INPUT.label}>Role</label>
            <select id={ids.role} className={INPUT.select} value={filters.role} onChange={e => setFilter('role', e.target.value)}>
              {ROLE_OPTIONS.map(role => <option key={role || 'any'} value={role}>{role || 'Any role'}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={ids.date} className={INPUT.label}>Date</label>
            <input id={ids.date} type="date" className={INPUT.base} value={filters.shift_date} onChange={e => setFilter('shift_date', e.target.value)} />
          </div>
          <div>
            <label htmlFor={ids.shift} className={INPUT.label}>Shift</label>
            <select id={ids.shift} className={INPUT.select} value={filters.shift_code} onChange={e => setFilter('shift_code', e.target.value)}>
              {SHIFT_CODES.map(code => <option key={code} value={code}>{code}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={ids.hours} className={INPUT.label}>Hours</label>
            <input id={ids.hours} type="number" min="0.5" step="0.5" inputMode="decimal" className={INPUT.base} value={filters.hours} onChange={e => setFilter('hours', e.target.value)} />
          </div>
          <div className="flex items-end">
            <button type="button" className={BTN.primary} onClick={runSearch} disabled={loading || !activeHome}>
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>
      </div>

      {error && <ErrorState title="Internal bank unavailable" message={error} onRetry={runSearch} />}
      {loading && <LoadingState label="Checking internal bank..." />}

      {!loading && !error && payload && candidates.length === 0 && (
        <EmptyState title="No candidates found" message="No matching internal-bank staff were available for this search." />
      )}

      {!loading && !error && candidates.length > 0 && (
        <div className={CARD.flush}>
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th className={TABLE.th}>Staff</th>
                  <th className={TABLE.th}>Home</th>
                  <th className={TABLE.th}>Role</th>
                  <th className={TABLE.th}>Availability</th>
                  <th className={TABLE.th}>Training</th>
                  <th className={TABLE.th}>Fatigue</th>
                  <th className={TABLE.th}>Warnings</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map(candidate => (
                  <tr key={`${candidate.home_id}:${candidate.id}`} className={TABLE.tr}>
                    <td className={TABLE.td}>
                      <div className="font-semibold text-[var(--ink)]">{candidate.name}</div>
                      <div className="text-xs text-[var(--ink-3)]">{candidate.id}</div>
                    </td>
                    <td className={TABLE.td}>{candidate.home_name}</td>
                    <td className={TABLE.td}>{candidate.role}</td>
                    <td className={TABLE.td}>
                      <span className={statusBadge(candidate)}>{candidate.viable ? 'Viable' : candidate.availability}</span>
                      <div className="mt-1 text-xs text-[var(--ink-3)]">Rostered: {candidate.scheduled_shift}</div>
                    </td>
                    <td className={TABLE.td}><span className={trainingBadge(candidate.training_status)}>{candidate.training_status || 'unknown'}</span></td>
                    <td className={TABLE.td}>{candidate.fatigue_status}</td>
                    <td className={TABLE.td}>
                      {[...(candidate.blockers || []), ...(candidate.warnings || [])].length === 0
                        ? <span className="text-[var(--ink-3)]">None</span>
                        : (
                          <ul className="space-y-1 text-xs text-[var(--ink-2)]">
                            {[...(candidate.blockers || []), ...(candidate.warnings || [])].map((item, index) => (
                              <li key={`${candidate.id}-${index}`}>{item}</li>
                            ))}
                          </ul>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
