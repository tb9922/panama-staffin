import { useEffect, useState } from 'react';
import { BADGE, BTN } from '../../lib/design.js';
import { downloadAuthenticatedFile, getMyPayslipDownloadUrl, getMyPayslips } from '../../lib/api.js';
import LoadingState from '../../components/LoadingState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { useData } from '../../contexts/DataContext.jsx';

function money(value) {
  if (value == null) return '-';
  return `GBP ${Number(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function MyPayslips() {
  const { staffId } = useData();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    try {
      setLoading(true);
      setError('');
      setRows(await getMyPayslips());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <LoadingState message="Loading payslips..." className="p-6" />;
  if (error && rows.length === 0) return <div className="p-6"><ErrorState title="Unable to load payslips" message={error} onRetry={() => void load()} /></div>;

  return (
    <div className="space-y-6 p-6">
      {error && <ErrorState title="Some payslip data could not be loaded" message={error} onRetry={() => void load()} />}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-2xl font-bold text-slate-900">My Payslips</h2>
        <p className="mt-2 text-sm text-slate-600">Download your own payslip PDFs from approved payroll runs.</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No payslips yet" description="Once payroll is approved for you, your payslips will appear here." className="pb-6" />
      ) : (
        <div className="space-y-3">
          {rows.map((item) => (
            <div key={item.runId} className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-slate-900">{item.periodStart} to {item.periodEnd}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <span>{money(item.grossPay)} gross</span>
                  <span>|</span>
                  <span>{money(item.netPay)} net</span>
                  <span>|</span>
                  <span className={BADGE.green}>{item.status}</span>
                </div>
              </div>
              <button
                type="button"
                className={BTN.primary}
                onClick={() => downloadAuthenticatedFile(getMyPayslipDownloadUrl(item.runId, staffId), `payslip_${item.periodStart}.pdf`)}
              >
                Download PDF
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
