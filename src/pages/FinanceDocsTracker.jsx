import { useCallback, useEffect, useState } from 'react';
import { PAGE, CARD, TABLE, BADGE } from '../lib/design.js';
import { formatCurrency } from '../lib/finance.js';
import { getCurrentHome, getFinanceDocs } from '../lib/api.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';

export default function FinanceDocsTracker() {
  const home = getCurrentHome();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getFinanceDocs(home));
    } catch (err) {
      setError(err.message || 'Failed to load finance documents');
    } finally {
      setLoading(false);
    }
  }, [home]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading finance documents..." card /></div>;
  if (error) return <div className={PAGE.container}><ErrorState title="Finance documents need attention" message={error} onRetry={load} /></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Finance Docs Center</h1>
          <p className={PAGE.subtitle}>Accounts payable documents grouped by month, supplier, category, and status.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className={CARD.padded}><div className="text-xs text-gray-500">Documents</div><div className="mt-1 text-2xl font-bold">{data.summary.total_documents}</div></div>
        <div className={CARD.padded}><div className="text-xs text-gray-500">Approved Without Document</div><div className="mt-1 text-2xl font-bold text-red-600">{data.summary.approved_without_document}</div></div>
        <div className={CARD.padded}><div className="text-xs text-gray-500">Pending Too Long</div><div className="mt-1 text-2xl font-bold text-amber-600">{data.summary.pending_too_long}</div></div>
        <div className={CARD.padded}><div className="text-xs text-gray-500">Processed Without Source</div><div className="mt-1 text-2xl font-bold text-red-600">{data.summary.processed_without_source}</div></div>
      </div>

      <div className={CARD.flush}>
        <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">Documents</div>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th className={TABLE.th}>Type</th>
                <th className={TABLE.th}>Supplier</th>
                <th className={TABLE.th}>Month</th>
                <th className={TABLE.th}>Category</th>
                <th className={TABLE.th}>Status</th>
                <th className={TABLE.th}>File</th>
              </tr>
            </thead>
            <tbody>
              {data.documents.map((doc) => (
                <tr key={`${doc.type}:${doc.parent_id}:${doc.attachment.id}`} className={TABLE.tr}>
                  <td className={TABLE.td}>{doc.type === 'expense' ? 'Expense' : 'Schedule'}</td>
                  <td className={TABLE.td}>{doc.supplier}</td>
                  <td className={TABLE.td}>{doc.month}</td>
                  <td className={TABLE.td}>{doc.category}</td>
                  <td className={TABLE.td}><span className={BADGE.gray}>{doc.status}</span></td>
                  <td className={TABLE.td}>{doc.attachment.original_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={CARD.flush}>
        <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">Expense Gaps</div>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}><tr><th className={TABLE.th}>Date</th><th className={TABLE.th}>Supplier</th><th className={TABLE.th}>Description</th><th className={TABLE.th}>Gross</th><th className={TABLE.th}>Signals</th></tr></thead>
            <tbody>
              {data.expenses.map((expense) => (
                <tr key={expense.id} className={TABLE.tr}>
                  <td className={TABLE.td}>{expense.expense_date}</td>
                  <td className={TABLE.td}>{expense.supplier_name || '—'}</td>
                  <td className={TABLE.td}>{expense.description}</td>
                  <td className={TABLE.td}>{formatCurrency(expense.gross_amount)}</td>
                  <td className={TABLE.td}>
                    <div className="flex flex-wrap gap-2">
                      {expense.approved_without_document && <span className={BADGE.red}>Approved no doc</span>}
                      {expense.pending_too_long && <span className={BADGE.amber}>Pending 14+ days</span>}
                      {!expense.approved_without_document && !expense.pending_too_long && <span className={BADGE.green}>OK</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className={CARD.flush}>
          <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">By Month</div>
          <div className={TABLE.wrapper}><table className={TABLE.table}><thead className={TABLE.thead}><tr><th className={TABLE.th}>Month</th><th className={TABLE.th}>Count</th></tr></thead><tbody>{data.byMonth.map((row) => <tr key={row.key} className={TABLE.tr}><td className={TABLE.td}>{row.key}</td><td className={TABLE.td}>{row.count}</td></tr>)}</tbody></table></div>
        </div>
        <div className={CARD.flush}>
          <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">By Supplier</div>
          <div className={TABLE.wrapper}><table className={TABLE.table}><thead className={TABLE.thead}><tr><th className={TABLE.th}>Supplier</th><th className={TABLE.th}>Count</th></tr></thead><tbody>{data.bySupplier.map((row) => <tr key={row.key} className={TABLE.tr}><td className={TABLE.td}>{row.key}</td><td className={TABLE.td}>{row.count}</td></tr>)}</tbody></table></div>
        </div>
      </div>
    </div>
  );
}
