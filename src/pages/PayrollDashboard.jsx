import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import { getPayrollRuns, createPayrollRun, getCurrentHome, getLoggedInUser } from '../lib/api.js';
import { suggestNextPeriod } from '../lib/payroll.js';

const STATUS_BADGE = {
  draft:      BADGE.gray,
  calculated: BADGE.blue,
  approved:   BADGE.green,
  exported:   BADGE.purple,
  locked:     BADGE.gray,
};

const STATUS_LABEL = {
  draft:      'Draft',
  calculated: 'Calculated',
  approved:   'Approved',
  exported:   'Exported',
  locked:     'Locked',
};

const FREQ_LABEL = {
  weekly:       'Weekly',
  fortnightly:  'Fortnightly',
  monthly:      'Monthly',
};

export default function PayrollDashboard() {
  const homeSlug = getCurrentHome();
  const isAdmin  = getLoggedInUser()?.role === 'admin';
  const navigate = useNavigate();

  const [runs, setRuns]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]         = useState({ period_start: '', period_end: '', pay_frequency: 'monthly', notes: '' });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!homeSlug) return;
    try {
      setLoading(true);
      setError(null);
      const res = await getPayrollRuns(homeSlug);
      const r = Array.isArray(res) ? res : (res.rows || []);
      setRuns(r);
      // Pre-fill next period on first load
      if (r.length > 0) {
        const next = suggestNextPeriod(r[0], r[0].pay_frequency || 'monthly');
        setForm(f => ({ ...f, period_start: next.start, period_end: next.end, pay_frequency: r[0].pay_frequency || 'monthly' }));
      } else {
        const next = suggestNextPeriod(null, 'monthly');
        setForm(f => ({ ...f, period_start: next.start, period_end: next.end }));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug]);

  useEffect(() => { load(); }, [load]);

  function handleFreqChange(freq) {
    const lastRun = runs.length > 0 ? runs[0] : null;
    const next = suggestNextPeriod(lastRun, freq);
    setForm(f => ({ ...f, pay_frequency: freq, period_start: next.start, period_end: next.end }));
  }

  async function handleCreate() {
    if (!form.period_start || !form.period_end) return;
    setCreating(true);
    try {
      const run = await createPayrollRun(homeSlug, form);
      setShowCreate(false);
      navigate(`/payroll/${run.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  // Summary from most recent run
  const latest = runs[0];
  const _nmwFlags = runs.filter(r => r.status === 'calculated').length; // proxy

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Payroll Runs</h1>
          <p className={PAGE.subtitle}>Gross pay calculation, approval, and export to Sage/Xero</p>
        </div>
        {isAdmin && (
          <button className={BTN.primary} onClick={() => setShowCreate(true)}>+ New Payroll Run</button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Summary Cards */}
      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className={CARD.padded}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Latest Period</p>
            <p className="text-sm font-semibold text-gray-900 mt-1">{latest.period_start}</p>
            <p className="text-sm font-semibold text-gray-900">to {latest.period_end}</p>
          </div>
          <div className={CARD.padded}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Total Gross</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {latest.total_gross != null ? `£${parseFloat(latest.total_gross).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '—'}
            </p>
          </div>
          <div className={CARD.padded}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Enhancements</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">
              {latest.total_enhancements != null ? `£${parseFloat(latest.total_enhancements).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '—'}
            </p>
          </div>
          <div className={CARD.padded}>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Staff</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{latest.staff_count ?? '—'}</p>
          </div>
        </div>
      )}

      {/* Runs Table */}
      <div className={CARD.flush}>
        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">Loading payroll runs…</div>
        ) : (
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th scope="col" className={TABLE.th}>Period</th>
                  <th scope="col" className={TABLE.th}>Frequency</th>
                  <th scope="col" className={TABLE.th}>Status</th>
                  <th scope="col" className={TABLE.th}>Staff</th>
                  <th scope="col" className={TABLE.th}>Total Gross</th>
                  <th scope="col" className={TABLE.th}>Enhancements</th>
                  <th scope="col" className={TABLE.th}>Exported</th>
                  <th scope="col" className={TABLE.th}></th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 ? (
                  <tr><td colSpan={8} className={TABLE.empty}>No payroll runs yet. Create your first run to get started.</td></tr>
                ) : runs.map(run => (
                  <tr key={run.id} className={TABLE.tr}>
                    <td className={TABLE.td}>
                      <p className="font-medium">{run.period_start}</p>
                      <p className="text-xs text-gray-400">to {run.period_end}</p>
                    </td>
                    <td className={TABLE.td + ' text-gray-500'}>{FREQ_LABEL[run.pay_frequency] || run.pay_frequency}</td>
                    <td className={TABLE.td}>
                      <span className={STATUS_BADGE[run.status] || BADGE.gray}>{STATUS_LABEL[run.status] || run.status}</span>
                    </td>
                    <td className={TABLE.td}>{run.staff_count ?? '—'}</td>
                    <td className={`${TABLE.td} font-mono`}>
                      {run.total_gross != null ? `£${parseFloat(run.total_gross).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className={`${TABLE.td} font-mono`}>
                      {run.total_enhancements != null ? `£${parseFloat(run.total_enhancements).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className={TABLE.td + ' text-gray-500 text-xs'}>{run.exported_at ? run.exported_at.slice(0, 10) : '—'}</td>
                    <td className={TABLE.td}>
                      <button className={`${BTN.secondary} ${BTN.sm}`} onClick={() => navigate(`/payroll/${run.id}`)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Payroll Run" size="lg">
        <div className="space-y-4">
          <div>
            <label className={INPUT.label}>Pay Frequency</label>
            <select className={INPUT.select} value={form.pay_frequency}
              onChange={e => handleFreqChange(e.target.value)}>
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Fortnightly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Period Start</label>
              <input type="date" className={INPUT.base} value={form.period_start}
                onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))} />
            </div>
            <div>
              <label className={INPUT.label}>Period End</label>
              <input type="date" className={INPUT.base} value={form.period_end}
                onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className={INPUT.label}>Notes (optional)</label>
            <input className={INPUT.sm} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="e.g. May 2026 monthly payroll" />
          </div>
        </div>
        <div className={MODAL.footer}>
          <button className={BTN.secondary} onClick={() => setShowCreate(false)}>Cancel</button>
          <button className={BTN.primary} onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating…' : 'Create Run'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
