import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BADGE, BTN, CARD, INPUT, PAGE, TABLE } from '../lib/design.js';
import {
  deleteEvidenceHubAttachment,
  getEvidenceHubDownloadUrl,
  listEvidenceHubUploaders,
  searchEvidenceHub,
} from '../lib/api.js';
import { downloadXLSX } from '../lib/excel.js';
import Pagination from '../components/Pagination.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { getReadableEvidenceSources } from '../../shared/evidenceHub.js';
import { useData } from '../contexts/DataContext.jsx';

const PAGE_SIZE = 50;

function formatBytes(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 1024) return `${sizeBytes || 0} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function defaultFilters() {
  return {
    q: '',
    uploadedBy: '',
    dateFrom: '',
    dateTo: '',
    modules: [],
  };
}

export default function EvidenceHub() {
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const { homeRole } = useData();

  const [filters, setFilters] = useState(defaultFilters);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [uploaders, setUploaders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const requestRef = useRef(0);

  const availableSources = getReadableEvidenceSources(homeRole);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(filters.q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [filters.q]);

  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, filters.uploadedBy, filters.dateFrom, filters.dateTo, filters.modules]);

  useEffect(() => {
    let cancelled = false;
    listEvidenceHubUploaders()
      .then((result) => {
        if (!cancelled) setUploaders(result);
      })
      .catch(() => {
        if (!cancelled) setUploaders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPage = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await searchEvidenceHub({
        q: debouncedSearch || undefined,
        uploadedBy: filters.uploadedBy || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        modules: filters.modules.length > 0 ? filters.modules : undefined,
        limit: PAGE_SIZE,
        offset,
      });
      if (requestId !== requestRef.current) return;
      setRows(result.rows);
      setTotal(result.total);
    } catch (err) {
      if (requestId !== requestRef.current) return;
      setError(err.message || 'Failed to load evidence');
      setRows([]);
      setTotal(0);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [debouncedSearch, filters.dateFrom, filters.dateTo, filters.modules, filters.uploadedBy, offset]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  async function loadAllRowsForExport() {
    const collected = [];
    let nextOffset = 0;
    let expectedTotal = null;

    while (expectedTotal == null || collected.length < expectedTotal) {
      const result = await searchEvidenceHub({
        q: debouncedSearch || undefined,
        uploadedBy: filters.uploadedBy || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        modules: filters.modules.length > 0 ? filters.modules : undefined,
        limit: 200,
        offset: nextOffset,
      });
      expectedTotal = result.total;
      collected.push(...result.rows);
      if (result.rows.length === 0) break;
      nextOffset += result.rows.length;
    }

    return collected;
  }

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const exportRows = await loadAllRowsForExport();
      await downloadXLSX('evidence_hub', [{
        name: 'Evidence Hub',
        headers: ['File', 'Source', 'Record', 'Staff', 'Uploaded by', 'Created at', 'Size', 'Description'],
        rows: exportRows.map((row) => [
          row.originalName,
          row.sourceLabel || row.sourceModule,
          row.parentLabel || '',
          row.staffName || '',
          row.uploadedBy || '',
          formatDateTime(row.createdAt),
          formatBytes(row.sizeBytes),
          row.description || '',
        ]),
      }]);
    } catch (err) {
      setError(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete(row) {
    if (!row.canDelete) return;
    const ok = await confirm(`Delete "${row.originalName}" from ${row.sourceLabel}?`);
    if (!ok) return;
    try {
      await deleteEvidenceHubAttachment(row.sourceModule, row.attachmentId);
      await loadPage();
    } catch (err) {
      setError(err.message || 'Delete failed');
    }
  }

  function toggleModule(sourceId) {
    setFilters((current) => ({
      ...current,
      modules: current.modules.includes(sourceId)
        ? current.modules.filter((moduleId) => moduleId !== sourceId)
        : [...current.modules, sourceId],
    }));
  }

  function clearFilters() {
    setFilters(defaultFilters());
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Evidence Hub</h1>
          <p className={PAGE.subtitle}>Search uploaded evidence across every source your role can already read, including HR, CQC, onboarding, training, and operational records.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className={BTN.secondary} onClick={clearFilters} disabled={loading}>Clear Filters</button>
          <button className={BTN.primary} onClick={handleExport} disabled={loading || exporting || total === 0}>
            {exporting ? 'Exporting...' : 'Export XLSX'}
          </button>
        </div>
      </div>

      <div className={`${CARD.padded} mb-4`}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label htmlFor="evidence-search" className={INPUT.label}>Search</label>
            <input
              id="evidence-search"
              className={INPUT.base}
              placeholder="Search filename or description"
              value={filters.q}
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="evidence-uploaded-by" className={INPUT.label}>Uploaded By</label>
            <select
              id="evidence-uploaded-by"
              className={INPUT.select}
              value={filters.uploadedBy}
              onChange={(event) => setFilters((current) => ({ ...current, uploadedBy: event.target.value }))}
            >
              <option value="">All uploaders</option>
              {uploaders.map((uploader) => (
                <option key={uploader} value={uploader}>{uploader}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="evidence-created-from" className={INPUT.label}>Created From</label>
            <input
              id="evidence-created-from"
              type="date"
              className={INPUT.base}
              value={filters.dateFrom}
              onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="evidence-created-to" className={INPUT.label}>Created To</label>
            <input
              id="evidence-created-to"
              type="date"
              className={INPUT.base}
              value={filters.dateTo}
              onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))}
            />
          </div>
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Sources</p>
          <div className="flex flex-wrap gap-2">
            {availableSources.map((source) => {
              const selected = filters.modules.includes(source.id);
              return (
                <button
                  key={source.id}
                  type="button"
                  className={selected ? BADGE.blue : BADGE.gray}
                  onClick={() => toggleModule(source.id)}
                >
                  {source.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className={CARD.flush}>
        {error && (
          <div className="border-b border-gray-100 px-4 py-4">
            <ErrorState
              title="Unable to load evidence"
              message={error}
              onRetry={loadPage}
            />
          </div>
        )}

        {loading ? (
          <div className="px-4 py-8">
            <LoadingState message="Loading evidence..." compact />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              title="No evidence matched the current filters"
              description="Try broadening the search, date range, or source filters."
              actionLabel="Clear Filters"
              onAction={clearFilters}
              compact
            />
          </div>
        ) : (
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th className={TABLE.th}>File</th>
                  <th className={TABLE.th}>Source</th>
                  <th className={TABLE.th}>Record</th>
                  <th className={TABLE.th}>Staff</th>
                  <th className={TABLE.th}>Uploaded By</th>
                  <th className={TABLE.th}>Created</th>
                  <th className={TABLE.th}>Size</th>
                  <th className={TABLE.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.sourceModule}-${row.attachmentId}`} className={TABLE.tr}>
                    <td className={TABLE.td}>
                      <a href={getEvidenceHubDownloadUrl(row.sourceModule, row.attachmentId)} className="text-blue-600 hover:text-blue-700 hover:underline font-medium">
                        {row.originalName}
                      </a>
                      {row.description && (
                        <p className="text-xs text-gray-500 mt-1">{row.description}</p>
                      )}
                    </td>
                    <td className={TABLE.td}>
                      <span className={BADGE.gray}>{row.sourceLabel}</span>
                    </td>
                    <td className={TABLE.td}>
                      {row.ownerPagePath ? (
                        <button
                          type="button"
                          className="text-blue-600 hover:text-blue-700 hover:underline text-left"
                          onClick={() => navigate(row.ownerPagePath)}
                        >
                          {row.parentLabel}
                        </button>
                      ) : (
                        row.parentLabel || '-'
                      )}
                    </td>
                    <td className={TABLE.td}>{row.staffName || '-'}</td>
                    <td className={TABLE.td}>{row.uploadedBy || '-'}</td>
                    <td className={TABLE.td}>{formatDateTime(row.createdAt)}</td>
                    <td className={TABLE.td}>{formatBytes(row.sizeBytes)}</td>
                    <td className={TABLE.td}>
                      {row.canDelete ? (
                        <button className={`${BTN.danger} ${BTN.xs}`} type="button" onClick={() => handleDelete(row)}>
                          Delete
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">Read only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
      </div>

      {ConfirmDialog}
    </div>
  );
}
