import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { BADGE, BTN, CARD, INPUT, MODAL, PAGE, TABLE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import useTransientNotice from '../hooks/useTransientNotice.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import { useData } from '../contexts/DataContext.jsx';
import {
  deleteOutcomeMetric,
  getOutcomeDashboard,
  updateOutcomeMetric,
  upsertOutcomeMetric,
} from '../lib/api.js';
import { todayLocalISO } from '../lib/localDates.js';

const MANUAL_METRICS = [
  'prn_antipsychotic_pct',
  'antibiotic_courses',
  'pressure_sores_new',
  'doc_contact_ratio',
  'staff_turnover_pct',
  'occupancy_pct',
];

const EMPTY_METRIC = {
  metric_key: 'prn_antipsychotic_pct',
  period_start: '',
  period_end: '',
  numerator: '',
  denominator: '',
  notes: '',
};

function titleCase(value) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function defaultPeriod() {
  const end = todayLocalISO();
  const startDate = new Date(`${end}T00:00:00`);
  startDate.setDate(startDate.getDate() - 27);
  return {
    period_start: startDate.toISOString().slice(0, 10),
    period_end: end,
  };
}

function asOptionalNumber(value) {
  if (value === '' || value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function metricPayload(form) {
  return {
    metric_key: form.metric_key,
    period_start: form.period_start,
    period_end: form.period_end,
    numerator: asOptionalNumber(form.numerator),
    denominator: asOptionalNumber(form.denominator),
    notes: form.notes || null,
    _version: form._version,
  };
}

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString();
}

function formatRatio(metric) {
  if (metric.numerator == null && metric.denominator == null) return '-';
  if (metric.denominator == null) return formatNumber(metric.numerator);
  return `${formatNumber(metric.numerator)} / ${formatNumber(metric.denominator)}`;
}

function MetricModal({ isOpen, metric, form, setForm, saveError, canEdit, onClose, onSave, onDelete }) {
  const keyId = useId();
  const startId = useId();
  const endId = useId();
  const numeratorId = useId();
  const denominatorId = useId();
  const notesId = useId();

  const setField = (key, value) => setForm(current => ({ ...current, [key]: value }));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={metric ? 'Edit Outcome Metric' : 'New Outcome Metric'} size="wide">
      {saveError && <InlineNotice variant="error" className="mb-4">{saveError}</InlineNotice>}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor={keyId} className={INPUT.label}>Metric</label>
          <select id={keyId} className={INPUT.select} value={form.metric_key} onChange={e => setField('metric_key', e.target.value)} disabled={!canEdit}>
            {MANUAL_METRICS.map(key => <option key={key} value={key}>{titleCase(key)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={startId} className={INPUT.label}>Period start</label>
          <input id={startId} type="date" className={INPUT.base} value={form.period_start} onChange={e => setField('period_start', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label htmlFor={endId} className={INPUT.label}>Period end</label>
          <input id={endId} type="date" className={INPUT.base} value={form.period_end} onChange={e => setField('period_end', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label htmlFor={numeratorId} className={INPUT.label}>Numerator</label>
          <input id={numeratorId} type="number" step="0.01" inputMode="decimal" className={INPUT.base} value={form.numerator} onChange={e => setField('numerator', e.target.value)} disabled={!canEdit} />
        </div>
        <div>
          <label htmlFor={denominatorId} className={INPUT.label}>Denominator</label>
          <input id={denominatorId} type="number" step="0.01" inputMode="decimal" className={INPUT.base} value={form.denominator} onChange={e => setField('denominator', e.target.value)} disabled={!canEdit} />
        </div>
        <div className="md:col-span-2">
          <label htmlFor={notesId} className={INPUT.label}>Notes</label>
          <textarea id={notesId} className={`${INPUT.base} min-h-24`} value={form.notes} onChange={e => setField('notes', e.target.value)} disabled={!canEdit} />
        </div>
      </div>
      <div className={MODAL.footer}>
        {metric && canEdit && <button type="button" className={`${BTN.danger} mr-auto`} onClick={onDelete}>Delete</button>}
        <button type="button" className={BTN.secondary} onClick={onClose}>Close</button>
        {canEdit && <button type="button" className={BTN.primary} onClick={onSave} disabled={!form.metric_key || !form.period_start || !form.period_end}>Save</button>}
      </div>
    </Modal>
  );
}

function DerivedCard({ label, value }) {
  return (
    <div className={CARD.padded}>
      <p className="text-sm text-[var(--ink-3)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">{formatNumber(value)}</p>
    </div>
  );
}

function MiniTrendTable({ title, rows, columns }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return (
    <div className={CARD.flush}>
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--ink)]">{title}</h2>
      </div>
      {safeRows.length === 0 ? (
        <div className="px-4 py-5 text-sm text-[var(--ink-3)]">No trend signals in this period.</div>
      ) : (
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>{columns.map(column => <th key={column.key} className={TABLE.th}>{column.label}</th>)}</tr>
            </thead>
            <tbody>
              {safeRows.slice(0, 6).map((row, index) => (
                <tr key={`${title}-${index}`} className={TABLE.tr}>
                  {columns.map(column => (
                    <td key={column.key} className={TABLE.td}>{column.render ? column.render(row) : row[column.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function OutcomeMetrics() {
  const { activeHome, canWrite } = useData();
  const canEdit = canWrite('governance');
  const { confirm, ConfirmDialog } = useConfirm();
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_METRIC, ...defaultPeriod() });
  useDirtyGuard(modalOpen);

  const load = useCallback(async () => {
    if (!activeHome) return;
    setLoading(true);
    try {
      setPayload(await getOutcomeDashboard(activeHome));
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load outcome metrics');
    } finally {
      setLoading(false);
    }
  }, [activeHome]);

  useEffect(() => { load(); }, [load]);

  const derived = payload?.derived || {};
  const trends = derived.trends || {};
  const manual = useMemo(() => (Array.isArray(payload?.manual) ? payload.manual : []), [payload]);

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_METRIC, ...defaultPeriod() });
    setSaveError(null);
    setModalOpen(true);
  }

  function openEdit(metric) {
    setEditing(metric);
    setForm({
      ...EMPTY_METRIC,
      ...metric,
      numerator: metric.numerator ?? '',
      denominator: metric.denominator ?? '',
      notes: metric.notes || '',
      _version: metric.version,
    });
    setSaveError(null);
    setModalOpen(true);
  }

  async function saveMetric() {
    const payloadForSave = metricPayload(form);
    try {
      if (editing) await updateOutcomeMetric(activeHome, editing.id, payloadForSave);
      else await upsertOutcomeMetric(activeHome, payloadForSave);
      setModalOpen(false);
      showNotice(editing ? 'Outcome metric updated.' : 'Outcome metric saved.');
      await load();
    } catch (e) {
      setSaveError(e.message || 'Unable to save outcome metric');
    }
  }

  async function removeMetric() {
    if (!editing) return;
    const ok = await confirm({ title: 'Delete Outcome Metric', message: 'Delete this outcome metric?', confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await deleteOutcomeMetric(activeHome, editing.id);
      setModalOpen(false);
      showNotice('Outcome metric deleted.');
      await load();
    } catch (e) {
      setSaveError(e.message || 'Unable to delete outcome metric');
    }
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Outcome Metrics</h1>
          <p className={PAGE.subtitle}>Derived outcome trends and manual governance measures.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN.secondary} onClick={load}>Refresh</button>
          {canEdit && <button type="button" className={BTN.primary} onClick={openNew}>New Metric</button>}
        </div>
      </div>

      {notice && <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">{notice.content}</InlineNotice>}
      {error && <ErrorState title="Outcome metrics unavailable" message={error} onRetry={load} className="mb-4" />}

      {loading ? <LoadingState message="Loading outcome metrics..." /> : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <DerivedCard label="Incidents" value={derived.incidents?.incidents_total} />
            <DerivedCard label="Falls" value={derived.incidents?.falls} />
            <DerivedCard label="Infections" value={derived.incidents?.infections} />
            <DerivedCard label="Pressure sores" value={derived.incidents?.pressure_sores} />
            <DerivedCard label="Complaints" value={derived.complaints?.complaints_total} />
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-2">
            <MiniTrendTable
              title="Incident Categories"
              rows={trends.incidents?.by_category}
              columns={[
                { key: 'label', label: 'Category' },
                { key: 'count', label: 'Count', render: row => formatNumber(row.count) },
              ]}
            />
            <MiniTrendTable
              title="Incident Recurrence"
              rows={trends.incidents?.recurrence}
              columns={[
                { key: 'subject', label: 'Subject' },
                { key: 'category', label: 'Category' },
                { key: 'count', label: 'Count', render: row => formatNumber(row.count) },
              ]}
            />
            <MiniTrendTable
              title="Complaint Categories"
              rows={trends.complaints?.by_category}
              columns={[
                { key: 'label', label: 'Category' },
                { key: 'count', label: 'Count', render: row => formatNumber(row.count) },
              ]}
            />
            <MiniTrendTable
              title="Complaint Recurrence"
              rows={trends.complaints?.recurrence}
              columns={[
                { key: 'subject', label: 'Subject' },
                { key: 'category', label: 'Category' },
                { key: 'count', label: 'Count', render: row => formatNumber(row.count) },
              ]}
            />
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DerivedCard label="Incident investigations overdue" value={trends.incidents?.overdue?.investigation_overdue} />
            <DerivedCard label="CQC notifications pending" value={trends.incidents?.overdue?.cqc_notifiable_pending} />
            <DerivedCard label="Complaint acknowledgements overdue" value={trends.complaints?.overdue?.acknowledgement_overdue} />
            <DerivedCard label="Complaint responses overdue" value={trends.complaints?.overdue?.response_overdue} />
          </div>

          <div className={CARD.flush}>
            {manual.length === 0 ? <EmptyState title="No manual metrics" description="Manual outcome entries will appear here." /> : (
              <div className={TABLE.wrapper}>
                <table className={TABLE.table}>
                  <thead className={TABLE.thead}>
                    <tr>
                      <th className={TABLE.th}>Metric</th>
                      <th className={TABLE.th}>Period</th>
                      <th className={TABLE.th}>Value</th>
                      <th className={TABLE.th}>Recorded</th>
                      <th className={TABLE.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manual.map(metric => (
                      <tr key={metric.id} className={TABLE.tr}>
                        <td className={TABLE.td}>
                          <button type="button" className="text-left font-semibold text-[var(--ink)] hover:text-[var(--accent)]" onClick={() => openEdit(metric)}>
                            {titleCase(metric.metric_key)}
                          </button>
                        </td>
                        <td className={TABLE.td}>{metric.period_start} to {metric.period_end}</td>
                        <td className={TABLE.td}>{formatRatio(metric)}</td>
                        <td className={TABLE.td}>{metric.recorded_at ? new Date(metric.recorded_at).toLocaleDateString('en-GB') : '-'}</td>
                        <td className={TABLE.td}><span className={BADGE.green}>Captured</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <MetricModal
        isOpen={modalOpen}
        metric={editing}
        form={form}
        setForm={setForm}
        saveError={saveError}
        canEdit={canEdit}
        onClose={() => setModalOpen(false)}
        onSave={saveMetric}
        onDelete={removeMetric}
      />
      <ConfirmDialog />
    </div>
  );
}
