import { useCallback, useEffect, useState } from 'react';
import { PAGE, CARD, TABLE, BADGE, BTN } from '../lib/design.js';
import { formatCurrency } from '../lib/finance.js';
import { getCurrentHome, getFinanceDocs, downloadRecordAttachment } from '../lib/api.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import ScanDocumentLink from '../components/ScanDocumentLink.jsx';
import { useData } from '../contexts/DataContext.jsx';

const EMPTY_DOCS = {
  summary: {
    total_documents: 0,
    approved_without_document: 0,
    pending_too_long: 0,
    processed_without_source: 0,
  },
  documents: [],
  expenses: [],
  schedules: [],
  byMonth: [],
  bySupplier: [],
  byCategory: [],
  byStatus: [],
};

function normalizeDocsPayload(payload) {
  return {
    ...EMPTY_DOCS,
    ...(payload || {}),
    summary: { ...EMPTY_DOCS.summary, ...(payload?.summary || {}) },
    documents: Array.isArray(payload?.documents) ? payload.documents : [],
    expenses: Array.isArray(payload?.expenses) ? payload.expenses : [],
    schedules: Array.isArray(payload?.schedules) ? payload.schedules : [],
    byMonth: Array.isArray(payload?.byMonth) ? payload.byMonth : [],
    bySupplier: Array.isArray(payload?.bySupplier) ? payload.bySupplier : [],
    byCategory: Array.isArray(payload?.byCategory) ? payload.byCategory : [],
    byStatus: Array.isArray(payload?.byStatus) ? payload.byStatus : [],
  };
}

export default function FinanceDocsTracker() {
  const home = getCurrentHome();
  const { canWrite, isScanTargetEnabled = () => false } = useData();
  const [data, setData] = useState(EMPTY_DOCS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  const load = useCallback(async () => {
    if (!home) {
      setData(EMPTY_DOCS);
      setError(null);
      setActionError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setActionError(null);
    try {
      setData(normalizeDocsPayload(await getFinanceDocs(home)));
    } catch (err) {
      setError(err.message || 'Failed to load finance documents');
    } finally {
      setLoading(false);
    }
  }, [home]);

  useEffect(() => { load(); }, [load]);

  async function handleDownload(doc) {
    const attachment = doc?.attachment;
    if (!attachment?.id) return;
    setActionError(null);
    setDownloadingId(attachment.id);
    try {
      await downloadRecordAttachment(attachment.id, attachment.original_name || 'finance_document');
    } catch (err) {
      setActionError(err.message || 'Unable to download this finance document right now.');
    } finally {
      setDownloadingId(null);
    }
  }

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading finance documents..." card /></div>;
  if (error) return <div className={PAGE.container}><ErrorState title="Finance documents need attention" message={error} onRetry={load} /></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Finance Docs Center</h1>
          <p className={PAGE.subtitle}>Accounts payable documents grouped by month, supplier, category, and status.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load()} className={BTN.secondary}>Refresh</button>
          {canWrite('finance') && isScanTargetEnabled('finance_ap') && <ScanDocumentLink context={{ target: 'finance_ap' }} label="Scan to Finance AP" />}
        </div>
      </div>

      {actionError && <InlineNotice variant="error" onDismiss={() => setActionError(null)} className="mb-4">{actionError}</InlineNotice>}

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
                <th scope="col" className={TABLE.th}>Type</th>
                <th scope="col" className={TABLE.th}>Supplier</th>
                <th scope="col" className={TABLE.th}>Month</th>
                <th scope="col" className={TABLE.th}>Category</th>
                <th scope="col" className={TABLE.th}>Status</th>
                <th scope="col" className={TABLE.th}>File</th>
              </tr>
            </thead>
            <tbody>
              {data.documents.length === 0 ? (
                <tr className={TABLE.tr}>
                  <td className={`${TABLE.td} text-gray-500`} colSpan={6}>No finance documents have been attached yet.</td>
                </tr>
              ) : data.documents.map((doc) => (
                <tr key={`${doc.type}:${doc.parent_id}:${doc.attachment.id}`} className={TABLE.tr}>
                  <td className={TABLE.td}>{doc.type === 'expense' ? 'Expense' : 'Schedule'}</td>
                  <td className={TABLE.td}>{doc.supplier || '-'}</td>
                  <td className={TABLE.td}>{doc.month}</td>
                  <td className={TABLE.td}>{doc.category}</td>
                  <td className={TABLE.td}><span className={BADGE.gray}>{doc.status}</span></td>
                  <td className={TABLE.td}>
                    <button
                      type="button"
                      onClick={() => void handleDownload(doc)}
                      disabled={downloadingId === doc.attachment.id}
                      className="text-sm font-medium text-blue-600 hover:underline disabled:text-gray-400"
                    >
                      {downloadingId === doc.attachment.id ? 'Downloading...' : doc.attachment.original_name}
                    </button>
                  </td>
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
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Date</th>
                <th scope="col" className={TABLE.th}>Supplier</th>
                <th scope="col" className={TABLE.th}>Description</th>
                <th scope="col" className={TABLE.th}>Gross</th>
                <th scope="col" className={TABLE.th}>Signals</th>
              </tr>
            </thead>
            <tbody>
              {data.expenses.length === 0 ? (
                <tr className={TABLE.tr}>
                  <td className={`${TABLE.td} text-gray-500`} colSpan={5}>No expense gaps to review.</td>
                </tr>
              ) : data.expenses.map((expense) => (
                <tr key={expense.id} className={TABLE.tr}>
                  <td className={TABLE.td}>{expense.expense_date}</td>
                  <td className={TABLE.td}>{expense.supplier_name || '-'}</td>
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
          {data.byMonth.length === 0 ? (
            <EmptyState title="No monthly document data" description="Attached finance documents will appear here by month." />
          ) : (
            <div className={TABLE.wrapper}>
              <table className={TABLE.table}>
                <thead className={TABLE.thead}>
                  <tr><th scope="col" className={TABLE.th}>Month</th><th scope="col" className={TABLE.th}>Count</th></tr>
                </thead>
                <tbody>{data.byMonth.map((row) => <tr key={row.key} className={TABLE.tr}><td className={TABLE.td}>{row.key}</td><td className={TABLE.td}>{row.count}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
        <div className={CARD.flush}>
          <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">By Supplier</div>
          {data.bySupplier.length === 0 ? (
            <EmptyState title="No supplier document data" description="Attached finance documents will appear here by supplier." />
          ) : (
            <div className={TABLE.wrapper}>
              <table className={TABLE.table}>
                <thead className={TABLE.thead}>
                  <tr><th scope="col" className={TABLE.th}>Supplier</th><th scope="col" className={TABLE.th}>Count</th></tr>
                </thead>
                <tbody>{data.bySupplier.map((row) => <tr key={row.key} className={TABLE.tr}><td className={TABLE.td}>{row.key || '-'}</td><td className={TABLE.td}>{row.count}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
