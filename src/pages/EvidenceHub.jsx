import { useEffect, useState } from 'react';
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
import { useConfirm } from '../hooks/useConfirm.jsx';
import { getReadableEvidenceSources } from '../../shared/evidenceHub.js';
import { getRecordAttachmentModule } from '../../shared/recordAttachmentModules.js';
import { QUALITY_STATEMENTS } from '../lib/cqc.js';
import { getEvidenceCategoryLabel } from '../lib/cqcEvidenceCategories.js';
import { ONBOARDING_SECTIONS } from '../lib/onboarding.js';
import { getTrainingTypes } from '../lib/training.js';
import { useData } from '../contexts/DataContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';

const PAGE_SIZE = 50;
const BULK_FETCH_SIZE = 200;
const SOURCE_ORDER = ['cqc_evidence', 'hr', 'onboarding', 'training', 'record'];
const EVIDENCE_HUB_PREFS_KEY = 'evidenceHubPreferences:v1';

const CQC_STATEMENT_MAP = Object.fromEntries(
  QUALITY_STATEMENTS.map((statement) => [statement.id, statement])
);
const ONBOARDING_SECTION_MAP = Object.fromEntries(
  ONBOARDING_SECTIONS.map((section) => [section.id, section])
);
const TRAINING_TYPE_MAP = Object.fromEntries(
  getTrainingTypes({})
    .filter((type) => type.active !== false)
    .map((type) => [type.id, type])
);

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

function formatDateOnly(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function getEmptyStateMessage(hasFilters) {
  return hasFilters
    ? 'No evidence matched the current filters.'
    : 'No evidence has been uploaded yet.';
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

function getStoredPreferences() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(EVIDENCE_HUB_PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      filters: { ...defaultFilters(), ...(parsed.filters || {}) },
      view: parsed.view === 'folders' ? 'folders' : 'list',
      sortBy: typeof parsed.sortBy === 'string' ? parsed.sortBy : 'newest',
    };
  } catch {
    return null;
  }
}

function compareEvidenceRows(a, b, sortBy) {
  if (sortBy === 'oldest') {
    return Date.parse(a.createdAt) - Date.parse(b.createdAt)
      || a.originalName.localeCompare(b.originalName, 'en-GB', { sensitivity: 'base' });
  }
  if (sortBy === 'name') {
    return a.originalName.localeCompare(b.originalName, 'en-GB', { sensitivity: 'base' })
      || Date.parse(b.createdAt) - Date.parse(a.createdAt);
  }
  if (sortBy === 'size') {
    return (b.sizeBytes || 0) - (a.sizeBytes || 0)
      || a.originalName.localeCompare(b.originalName, 'en-GB', { sensitivity: 'base' });
  }
  if (sortBy === 'review_due') {
    const aDue = a.reviewDueAt ? Date.parse(a.reviewDueAt) : Number.POSITIVE_INFINITY;
    const bDue = b.reviewDueAt ? Date.parse(b.reviewDueAt) : Number.POSITIVE_INFINITY;
    return aDue - bDue
      || Date.parse(b.createdAt) - Date.parse(a.createdAt);
  }
  return Date.parse(b.createdAt) - Date.parse(a.createdAt)
    || a.originalName.localeCompare(b.originalName, 'en-GB', { sensitivity: 'base' });
}

function sourceSort(a, b) {
  return SOURCE_ORDER.indexOf(a.id) - SOURCE_ORDER.indexOf(b.id);
}

function formatFolderLabel(value) {
  return String(value || '')
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getFileTypeLabel(mimeType, fileName) {
  const lowerName = String(fileName || '').toLowerCase();
  if (mimeType?.startsWith('image/')) return 'IMG';
  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) return 'PDF';
  if (
    mimeType?.includes('spreadsheet')
    || mimeType?.includes('excel')
    || lowerName.endsWith('.xls')
    || lowerName.endsWith('.xlsx')
    || lowerName.endsWith('.csv')
  ) {
    return 'SHEET';
  }
  if (
    mimeType?.includes('word')
    || mimeType?.includes('document')
    || lowerName.endsWith('.doc')
    || lowerName.endsWith('.docx')
    || lowerName.endsWith('.rtf')
  ) {
    return 'DOC';
  }
  return 'FILE';
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function freshnessBadge(freshness) {
  if (freshness === 'overdue') return BADGE.red;
  if (freshness === 'due_soon') return BADGE.amber;
  if (freshness === 'stale') return BADGE.gray;
  if (freshness === 'fresh') return BADGE.green;
  return BADGE.gray;
}

function freshnessLabel(freshness) {
  if (freshness === 'overdue') return 'Review overdue';
  if (freshness === 'due_soon') return 'Review due soon';
  if (freshness === 'stale') return 'Aged evidence';
  if (freshness === 'fresh') return 'Current';
  return '';
}

function getCqcStatementId(row) {
  const match = String(row.parentLabel || '').match(/^([A-Z]+\d+)\s*[-:]/);
  return match ? match[1].toUpperCase() : 'other';
}

function createCategory(id, label, rows = [], sortBy = 'newest') {
  const recordMap = {};

  for (const row of rows) {
    const recordKey = `${row.sourceRecordId || ''}::${row.parentLabel || ''}::${row.ownerPagePath || ''}`;
    if (!recordMap[recordKey]) {
      recordMap[recordKey] = {
        id: recordKey,
        label: row.parentLabel || row.sourceRecordId || row.originalName,
        staffName: row.staffName || null,
        ownerPagePath: row.ownerPagePath || null,
        files: [],
      };
    }
    recordMap[recordKey].files.push(row);
  }

  const records = Object.values(recordMap)
    .map((record) => ({
      ...record,
      files: record.files.sort((a, b) => compareEvidenceRows(a, b, sortBy)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    id,
    label,
    totalCount: rows.length,
    records,
  };
}

function buildHrCategories(rows, sortBy) {
  const byType = {};
  for (const row of rows) {
    const key = row.sourceSubType || 'other';
    (byType[key] ||= []).push(row);
  }

  return Object.entries(byType)
    .map(([key, categoryRows]) => createCategory(key, formatFolderLabel(key), categoryRows, sortBy))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildCqcCategories(rows, sortBy) {
  const byStatement = {};
  for (const row of rows) {
    const statementId = getCqcStatementId(row);
    (byStatement[statementId] ||= []).push(row);
  }

  const categories = QUALITY_STATEMENTS.map((statement) => createCategory(
    statement.id,
    `${statement.id} - ${statement.name}`,
    byStatement[statement.id] || [],
    sortBy,
  ));

  if (byStatement.other?.length) {
    categories.push(createCategory('other', 'Other', byStatement.other, sortBy));
  }

  return categories.filter((category) => category.totalCount > 0);
}

function buildOnboardingCategories(rows, sortBy) {
  const bySection = {};
  for (const row of rows) {
    const key = row.sourceSubType || 'other';
    (bySection[key] ||= []).push(row);
  }

  const categories = ONBOARDING_SECTIONS.map((section) => createCategory(
    section.id,
    section.name,
    bySection[section.id] || [],
    sortBy,
  ));

  if (bySection.other?.length) {
    categories.push(createCategory('other', 'Other', bySection.other, sortBy));
  }

  return categories.filter((category) => category.totalCount > 0);
}

function buildTrainingCategories(rows, sortBy) {
  const byType = {};
  for (const row of rows) {
    const key = row.sourceSubType || 'other';
    (byType[key] ||= []).push(row);
  }

  return Object.entries(byType)
    .map(([key, categoryRows]) => createCategory(
      key,
      TRAINING_TYPE_MAP[key]?.name || formatFolderLabel(key),
      categoryRows,
      sortBy
    ))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildRecordCategories(rows, sortBy) {
  const byModule = {};
  for (const row of rows) {
    const key = row.sourceSubType || 'other';
    (byModule[key] ||= []).push(row);
  }

  return Object.entries(byModule)
    .map(([key, categoryRows]) => createCategory(
      key,
      getRecordAttachmentModule(key)?.label || formatFolderLabel(key),
      categoryRows,
      sortBy
    ))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildFolderTree(rows, sources, sortBy) {
  const bySource = {};
  for (const row of rows) {
    (bySource[row.sourceModule] ||= []).push(row);
  }

  return [...sources]
    .sort(sourceSort)
    .map((source) => {
      const sourceRows = bySource[source.id] || [];
      let categories = [];

      if (source.id === 'hr') categories = buildHrCategories(sourceRows, sortBy);
      if (source.id === 'cqc_evidence') categories = buildCqcCategories(sourceRows, sortBy);
      if (source.id === 'onboarding') categories = buildOnboardingCategories(sourceRows, sortBy);
      if (source.id === 'training') categories = buildTrainingCategories(sourceRows, sortBy);
      if (source.id === 'record') categories = buildRecordCategories(sourceRows, sortBy);

      return {
        id: source.id,
        label: source.label,
        totalCount: sourceRows.length,
        categories,
      };
    });
}

export default function EvidenceHub() {
  const navigate = useNavigate();
  const { confirm, ConfirmDialog } = useConfirm();
  const { homeRole } = useData();
  const { showToast } = useToast();

  const [view, setView] = useState('list');
  const [filters, setFilters] = useState(defaultFilters);
  const [sortBy, setSortBy] = useState('newest');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [folderRows, setFolderRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [uploaders, setUploaders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [folderLoading, setFolderLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const [expandedSources, setExpandedSources] = useState(() => new Set());
  const [expandedCategories, setExpandedCategories] = useState(() => new Set());
  const [hasSavedPreferences, setHasSavedPreferences] = useState(() => Boolean(getStoredPreferences()));

  const availableSources = getReadableEvidenceSources(homeRole);
  const sortedRows = rows.slice().sort((a, b) => compareEvidenceRows(a, b, sortBy));
  const sortedFolderRows = folderRows.slice().sort((a, b) => compareEvidenceRows(a, b, sortBy));
  const folderTree = buildFolderTree(sortedFolderRows, availableSources, sortBy);
  const activeLoading = view === 'folders' ? folderLoading : loading;
  const exportCount = view === 'folders' ? folderRows.length : total;
  const hasFilters = Boolean(debouncedSearch || filters.uploadedBy || filters.dateFrom || filters.dateTo || filters.modules.length > 0);
  const dateRangeError = filters.dateFrom && filters.dateTo && filters.dateTo < filters.dateFrom
    ? 'Created To cannot be before Created From.'
    : null;

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

  useEffect(() => {
    let cancelled = false;
    if (view !== 'list') return () => { cancelled = true; };
    if (dateRangeError) {
      setError(dateRangeError);
      setRows([]);
      setTotal(0);
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    setError(null);

    searchEvidenceHub({
      q: debouncedSearch || undefined,
      uploadedBy: filters.uploadedBy || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      modules: filters.modules.length > 0 ? filters.modules : undefined,
      limit: PAGE_SIZE,
      offset,
    })
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setTotal(result.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Failed to load evidence');
        setRows([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [view, debouncedSearch, filters.uploadedBy, filters.dateFrom, filters.dateTo, filters.modules, offset, dateRangeError]);

  useEffect(() => {
    let cancelled = false;
    if (view !== 'folders') return () => { cancelled = true; };
    if (dateRangeError) {
      setError(dateRangeError);
      setFolderRows([]);
      setFolderLoading(false);
      return () => { cancelled = true; };
    }

    setFolderLoading(true);
    setError(null);

    (async () => {
      try {
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
            limit: BULK_FETCH_SIZE,
            offset: nextOffset,
          });

          expectedTotal = result.total;
          collected.push(...result.rows);
          if (result.rows.length === 0) break;
          nextOffset += result.rows.length;
        }

        if (!cancelled) setFolderRows(collected);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Failed to load folder view');
        setFolderRows([]);
      } finally {
        if (!cancelled) setFolderLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [view, debouncedSearch, filters.uploadedBy, filters.dateFrom, filters.dateTo, filters.modules, dateRangeError]);

  useEffect(() => {
    if (view !== 'folders') return;
    setExpandedSources((current) => {
      if (current.size > 0) return current;
      return new Set(availableSources.map((source) => source.id));
    });
  }, [view, availableSources]);

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
        limit: BULK_FETCH_SIZE,
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
    if (dateRangeError) {
      setError(dateRangeError);
      return;
    }
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
      showToast({
        title: 'Evidence Hub exported',
        message: 'The current evidence export has been prepared as an XLSX file.',
      });
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
      if (view === 'folders') {
        const refreshed = await loadAllRowsForExport();
        setFolderRows(refreshed);
      } else {
        const refreshed = await searchEvidenceHub({
          q: debouncedSearch || undefined,
          uploadedBy: filters.uploadedBy || undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
          modules: filters.modules.length > 0 ? filters.modules : undefined,
          limit: PAGE_SIZE,
          offset,
        });
        setRows(refreshed.rows);
        setTotal(refreshed.total);
      }
      showToast({
        title: 'Attachment deleted',
        message: `${row.originalName} was removed from ${row.sourceLabel}.`,
      });
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
    setView('list');
    setSortBy('newest');
  }

  function saveCurrentPreferences() {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(EVIDENCE_HUB_PREFS_KEY, JSON.stringify({
        filters,
        view,
        sortBy,
      }));
      setHasSavedPreferences(true);
      showToast({ title: 'Evidence Hub filters saved' });
    } catch {
      setError('Unable to save Evidence Hub filters on this browser.');
    }
  }

  function applySavedPreferences() {
    const saved = getStoredPreferences();
    if (!saved) {
      setHasSavedPreferences(false);
      return;
    }
    setFilters(saved.filters);
    setView(saved.view);
    setSortBy(saved.sortBy);
    setOffset(0);
    showToast({ title: 'Saved Evidence Hub filters applied' });
  }

  function clearSavedPreferences() {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(EVIDENCE_HUB_PREFS_KEY);
    setHasSavedPreferences(false);
    showToast({ title: 'Saved Evidence Hub filters cleared' });
  }

  function toggleSource(sourceId) {
    setExpandedSources((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }

  function toggleCategory(sourceId, categoryId) {
    const key = `${sourceId}:${categoryId}`;
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expandAllFolders() {
    setExpandedSources(new Set(folderTree.map((source) => source.id)));
    setExpandedCategories(new Set(
      folderTree.flatMap((source) => source.categories.map((category) => `${source.id}:${category.id}`))
    ));
  }

  function collapseAllFolders() {
    setExpandedSources(new Set());
    setExpandedCategories(new Set());
  }

  function renderFolderView() {
    if (folderRows.length === 0) {
      return <div className="px-4 py-10 text-sm text-gray-500">{getEmptyStateMessage(hasFilters)}</div>;
    }

    return (
      <div className="divide-y divide-gray-100">
        {folderTree.map((source) => {
          const sourceExpanded = expandedSources.has(source.id);
          return (
            <div key={source.id} className="px-4 py-4">
              <button
                type="button"
                className="w-full flex items-center justify-between gap-3 text-left"
                aria-expanded={sourceExpanded}
                aria-label={`Toggle source ${source.label}`}
                onClick={() => toggleSource(source.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 text-xs">{sourceExpanded ? 'v' : '>'}</span>
                  <div>
                    <div className="font-semibold text-gray-900">{source.label}</div>
                    <div className="text-xs text-gray-500">{countLabel(source.totalCount, 'file')}</div>
                  </div>
                </div>
                <span className={BADGE.gray}>{source.totalCount}</span>
              </button>

              {sourceExpanded && (
                <div className="mt-4 pl-4 border-l border-gray-200 space-y-3">
                  {source.categories.length === 0 ? (
                    <div className="text-sm text-gray-500">No folders currently match this source.</div>
                  ) : (
                    source.categories.map((category) => {
                      const categoryKey = `${source.id}:${category.id}`;
                      const categoryExpanded = expandedCategories.has(categoryKey);
                      return (
                        <div key={categoryKey} className="rounded-lg border border-gray-200 bg-gray-50/50">
                          <button
                            type="button"
                            className="w-full flex items-center justify-between gap-3 px-3 py-3 text-left"
                            aria-expanded={categoryExpanded}
                            aria-label={`Toggle category ${category.label}`}
                            onClick={() => toggleCategory(source.id, category.id)}
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-gray-400 text-xs">{categoryExpanded ? 'v' : '>'}</span>
                              <span className="font-medium text-gray-900">{category.label}</span>
                            </div>
                            <span className={BADGE.gray}>{category.totalCount}</span>
                          </button>

                          {categoryExpanded && (
                            <div className="px-3 pb-3">
                              {category.totalCount === 0 ? (
                                <div className="rounded-md border border-dashed border-gray-200 bg-white px-3 py-4 text-sm text-gray-500">
                                  No evidence in this folder yet.
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  {category.records.map((record) => (
                                    <div key={record.id} className="rounded-md border border-gray-200 bg-white p-3">
                                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0">
                                          {record.ownerPagePath ? (
                                            <button
                                              type="button"
                                              className="text-left text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
                                              onClick={() => navigate(record.ownerPagePath)}
                                            >
                                              {record.label}
                                            </button>
                                          ) : (
                                            <div className="text-sm font-medium text-gray-900">{record.label}</div>
                                          )}
                                          {record.staffName && (
                                            <div className="text-xs text-gray-500 mt-1">{record.staffName}</div>
                                          )}
                                        </div>
                                        <span className={BADGE.gray}>{countLabel(record.files.length, 'file')}</span>
                                      </div>

                                      <div className="mt-3 space-y-2">
                                        {record.files.map((file) => (
                                          <div
                                            key={`${file.sourceModule}-${file.attachmentId}`}
                                            className="flex flex-col gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 lg:flex-row lg:items-center lg:justify-between"
                                          >
                                            <div className="min-w-0 flex items-start gap-2">
                                              <span className={BADGE.gray}>{getFileTypeLabel(file.mimeType, file.originalName)}</span>
                                              <div className="min-w-0">
                                                <a
                                                  href={getEvidenceHubDownloadUrl(file.sourceModule, file.attachmentId)}
                                                  download={file.originalName}
                                                  className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline break-all"
                                                >
                                                  {file.originalName}
                                                </a>
                                                {file.sourceModule === 'cqc_evidence' && (
                                                  <div className="mt-1 flex flex-wrap gap-1">
                                                    {file.qualityStatementId && (
                                                      <span className={BADGE.gray}>{file.qualityStatementId}</span>
                                                    )}
                                                    {file.evidenceCategory && (
                                                      <span className={BADGE.gray}>{getEvidenceCategoryLabel(file.evidenceCategory)}</span>
                                                    )}
                                                    {file.freshness && (
                                                      <span className={freshnessBadge(file.freshness)}>{freshnessLabel(file.freshness)}</span>
                                                    )}
                                                  </div>
                                                )}
                                                {file.description && (
                                                  <div className="text-xs text-gray-500 mt-1">{file.description}</div>
                                                )}
                                                {file.sourceModule === 'cqc_evidence' && (file.evidenceOwner || file.reviewDueAt) && (
                                                  <div className="text-xs text-gray-500 mt-1">
                                                    {file.evidenceOwner ? `Owner ${file.evidenceOwner}` : null}
                                                    {file.evidenceOwner && file.reviewDueAt ? ' | ' : null}
                                                    {file.reviewDueAt ? `Review due ${formatDateOnly(file.reviewDueAt)}` : null}
                                                  </div>
                                                )}
                                              </div>
                                            </div>

                                            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                              <span>{formatBytes(file.sizeBytes)}</span>
                                              <span>{formatDateTime(file.createdAt)}</span>
                                              {file.canDelete ? (
                                                <button
                                                  className={`${BTN.danger} ${BTN.xs}`}
                                                  type="button"
                                                  onClick={() => handleDelete(file)}
                                                >
                                                  Delete
                                                </button>
                                              ) : (
                                                <span className="text-xs text-gray-400">Read only</span>
                                              )}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Evidence Hub</h1>
          <p className={PAGE.subtitle}>Search uploaded evidence across every source your role can already read, including HR, CQC, onboarding, training, and operational records.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className={BTN.secondary} onClick={clearFilters} disabled={activeLoading}>Clear Filters</button>
          <button className={BTN.secondary} onClick={saveCurrentPreferences} disabled={activeLoading}>Save Filters</button>
          {hasSavedPreferences && (
            <>
              <button className={BTN.secondary} onClick={applySavedPreferences} disabled={activeLoading}>Use Saved</button>
              <button className={BTN.secondary} onClick={clearSavedPreferences} disabled={activeLoading}>Clear Saved</button>
            </>
          )}
          <button className={BTN.primary} onClick={handleExport} disabled={activeLoading || exporting || exportCount === 0}>
            {exporting ? 'Exporting XLSX...' : 'Export XLSX'}
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Evidence view">
        <button
          type="button"
          className={view === 'list' ? `${BTN.primary} ${BTN.sm}` : `${BTN.ghost} ${BTN.sm}`}
          onClick={() => setView('list')}
          role="tab"
          aria-selected={view === 'list'}
          aria-pressed={view === 'list'}
        >
          List
        </button>
        <button
          type="button"
          className={view === 'folders' ? `${BTN.primary} ${BTN.sm}` : `${BTN.ghost} ${BTN.sm}`}
          onClick={() => setView('folders')}
          role="tab"
          aria-selected={view === 'folders'}
          aria-pressed={view === 'folders'}
        >
          Folders
        </button>
        {view === 'folders' && (
          <>
            <button type="button" className={`${BTN.secondary} ${BTN.sm}`} onClick={expandAllFolders}>
              Expand All
            </button>
            <button type="button" className={`${BTN.secondary} ${BTN.sm}`} onClick={collapseAllFolders}>
              Collapse All
            </button>
          </>
        )}
      </div>

      <div className={`${CARD.padded} mb-4`}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4 xl:grid-cols-5">
          <div className="md:col-span-2">
            <label htmlFor="evidence-hub-search" className={INPUT.label}>Search</label>
            <input
              id="evidence-hub-search"
              className={INPUT.base}
              placeholder="Search filename or description"
              value={filters.q}
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="evidence-hub-uploaded-by" className={INPUT.label}>Uploaded By</label>
            <select
              id="evidence-hub-uploaded-by"
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
            <label htmlFor="evidence-hub-date-from" className={INPUT.label}>Created From</label>
            <input
              id="evidence-hub-date-from"
              type="date"
              className={INPUT.base}
              value={filters.dateFrom}
              onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="evidence-hub-date-to" className={INPUT.label}>Created To</label>
            <input
              id="evidence-hub-date-to"
              type="date"
              className={INPUT.base}
              value={filters.dateTo}
              onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="evidence-hub-sort" className={INPUT.label}>Sort by</label>
            <select
              id="evidence-hub-sort"
              className={INPUT.select}
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="name">Filename A-Z</option>
              <option value="size">Largest first</option>
              <option value="review_due">Review due soonest</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Sources</p>
          <p className="text-xs text-gray-500 mb-2">No source selected means every readable source is included.</p>
          <div className="flex flex-wrap gap-2">
            {availableSources.map((source) => {
              const selected = filters.modules.includes(source.id);
              return (
                <button
                  key={source.id}
                  type="button"
                  className={selected ? BADGE.blue : BADGE.gray}
                  onClick={() => toggleModule(source.id)}
                  aria-pressed={selected}
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
          <div className="px-4 py-3 border-b border-red-100 bg-red-50 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        {activeLoading ? (
          <div className="px-4 py-10 text-sm text-gray-500" role="status">
            {view === 'folders' ? 'Loading folders...' : 'Loading evidence...'}
          </div>
        ) : view === 'folders' ? (
          renderFolderView()
        ) : sortedRows.length === 0 ? (
          <div className="px-4 py-10 text-sm text-gray-500">{getEmptyStateMessage(hasFilters)}</div>
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
                {sortedRows.map((row) => (
                  <tr key={`${row.sourceModule}-${row.attachmentId}`} className={TABLE.tr}>
                    <td className={TABLE.td}>
                      <a href={getEvidenceHubDownloadUrl(row.sourceModule, row.attachmentId)} download={row.originalName} className="text-blue-600 hover:text-blue-700 hover:underline font-medium">
                        {row.originalName}
                      </a>
                      {row.sourceModule === 'cqc_evidence' && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {row.qualityStatementId && <span className={BADGE.gray}>{row.qualityStatementId}</span>}
                          {row.evidenceCategory && (
                            <span className={BADGE.gray}>{getEvidenceCategoryLabel(row.evidenceCategory)}</span>
                          )}
                          {row.freshness && (
                            <span className={freshnessBadge(row.freshness)}>{freshnessLabel(row.freshness)}</span>
                          )}
                        </div>
                      )}
                      {row.description && (
                        <p className="text-xs text-gray-500 mt-1">{row.description}</p>
                      )}
                      {row.sourceModule === 'cqc_evidence' && (row.evidenceOwner || row.reviewDueAt) && (
                        <p className="text-xs text-gray-500 mt-1">
                          {row.evidenceOwner ? `Owner ${row.evidenceOwner}` : null}
                          {row.evidenceOwner && row.reviewDueAt ? ' | ' : null}
                          {row.reviewDueAt ? `Review due ${formatDateOnly(row.reviewDueAt)}` : null}
                        </p>
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

        {view === 'list' && (
          <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
        )}
      </div>

      {ConfirmDialog}
    </div>
  );
}
