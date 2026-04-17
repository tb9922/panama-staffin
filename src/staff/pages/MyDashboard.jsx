import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BADGE, BTN } from '../../lib/design.js';
import { downloadAuthenticatedFile, getMyDashboard, getMyPayslipDownloadUrl } from '../../lib/api.js';
import LoadingState from '../../components/LoadingState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ClockInButton from './ClockInButton.jsx';
import { useData } from '../../contexts/DataContext.jsx';

function money(value) {
  if (value == null) return '-';
  return `GBP ${Number(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function MyDashboard() {
  const { staffId } = useData();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    try {
      setLoading(true);
      setError('');
      setData(await getMyDashboard());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <LoadingState message="Loading your dashboard..." className="p-6" />;
  if (error) return <div className="p-6"><ErrorState title="Unable to load your portal" message={error} onRetry={() => void load()} /></div>;

  const upcoming = (data?.schedule?.days || []).slice(0, 7);
  const nextRequest = (data?.requests || []).find((item) => item.status === 'pending');
  const dueTraining = (data?.training?.items || []).filter((item) => item.status !== 'complete');

  return (
    <div className="space-y-6 p-6">
      <div className="rounded-2xl border border-blue-100 bg-blue-50/80 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Overview</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-900">Your staff portal</h2>
        <p className="mt-2 text-sm text-slate-600">
          Check your rota, leave balance, payslips, training, and, where enabled, clock in with GPS.
        </p>
      </div>

      <ClockInButton />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Leave left</p>
          <p className="mt-3 text-2xl font-bold text-slate-900">{Number(data?.accrual?.remainingHours || 0).toFixed(1)}h</p>
          <p className="mt-1 text-sm text-slate-600">Accrued: {Number(data?.accrual?.accruedHours || 0).toFixed(1)}h</p>
          <Link to="/leave" className={`${BTN.secondary} ${BTN.sm} mt-4`}>Manage leave</Link>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Pending requests</p>
          <p className="mt-3 text-2xl font-bold text-slate-900">{data?.requests?.filter((item) => item.status === 'pending').length || 0}</p>
          <p className="mt-1 text-sm text-slate-600">
            {nextRequest ? `Next: ${nextRequest.date}` : 'No requests waiting right now.'}
          </p>
          <Link to="/leave" className={`${BTN.secondary} ${BTN.sm} mt-4`}>Open requests</Link>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Training due</p>
          <p className="mt-3 text-2xl font-bold text-slate-900">{dueTraining.length}</p>
          <p className="mt-1 text-sm text-slate-600">Review your outstanding or expired training items.</p>
          <Link to="/training" className={`${BTN.secondary} ${BTN.sm} mt-4`}>Review training</Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Next 7 days</h3>
            <Link to="/schedule" className="text-sm font-medium text-blue-600 hover:text-blue-700">View full rota</Link>
          </div>
          {upcoming.length === 0 ? (
            <EmptyState compact title="No shifts to show" description="Your next shifts will appear here once they're on the rota." />
          ) : (
            <div className="mt-4 divide-y divide-slate-100">
              {upcoming.map((day) => (
                <div key={day.date} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-slate-900">{day.date}</p>
                    <p className="text-sm text-slate-500">{day.scheduledShift ? `Scheduled ${day.scheduledShift}` : 'No scheduled shift'}</p>
                  </div>
                  <span className={day.shift === 'OFF' ? BADGE.gray : day.shift === 'AL' ? BADGE.amber : day.shift === 'SICK' ? BADGE.red : BADGE.blue}>
                    {day.shift}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Recent payslips</h3>
              <Link to="/payslips" className="text-sm font-medium text-blue-600 hover:text-blue-700">View all</Link>
            </div>
            <div className="mt-4 space-y-3">
              {(data?.payslips || []).slice(0, 3).map((item) => (
                <button
                  key={item.runId}
                  type="button"
                  className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-3 py-3 text-left hover:bg-slate-50"
                  onClick={() => downloadAuthenticatedFile(getMyPayslipDownloadUrl(item.runId, staffId), `payslip_${item.periodStart}.pdf`)}
                >
                  <div>
                    <p className="font-medium text-slate-900">{item.periodStart} to {item.periodEnd}</p>
                    <p className="text-sm text-slate-500">{money(item.netPay)} net</p>
                  </div>
                  <span className={BADGE.green}>PDF</span>
                </button>
              ))}
              {(!data?.payslips || data.payslips.length === 0) && (
                <EmptyState compact title="No payslips yet" description="Approved payroll runs will appear here." />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
