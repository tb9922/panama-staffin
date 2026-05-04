import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorState from '../components/ErrorState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { BADGE, BTN, CARD, PAGE, TABLE } from '../lib/design.js';
import { getOpsStatus } from '../lib/api.js';

const STATUS_LABEL = {
  ok: 'OK',
  warning: 'Warning',
  error: 'Error',
};

function statusClass(status) {
  if (status === 'ok') return BADGE.green;
  if (status === 'warning') return BADGE.amber;
  if (status === 'error') return BADGE.red;
  return BADGE.gray;
}

function StatusBadge({ status }) {
  return <span className={statusClass(status)}>{STATUS_LABEL[status] || 'Unknown'}</span>;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function formatUptime(seconds) {
  const total = Number(seconds || 0);
  if (!Number.isFinite(total) || total <= 0) return '0m';
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function boolText(value) {
  return value ? 'Yes' : 'No';
}

function InfoRow({ label, value, mono = false }) {
  return (
    <tr className={TABLE.tr}>
      <th className={`${TABLE.th} w-48 normal-case tracking-normal text-[var(--ink-2)]`}>{label}</th>
      <td className={`${TABLE.td} break-words ${mono ? 'font-mono text-xs' : ''}`}>{value ?? '-'}</td>
    </tr>
  );
}

function SignalCard({ label, status, value, helper }) {
  return (
    <div className={`${CARD.base} overflow-hidden`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-[var(--ink-2)]">{label}</p>
          <StatusBadge status={status} />
        </div>
        <p className="mt-3 text-2xl font-semibold text-[var(--ink)]">{value}</p>
        {helper && <p className="mt-1 text-xs text-[var(--ink-3)]">{helper}</p>}
      </div>
    </div>
  );
}

function SectionTable({ title, children }) {
  return (
    <section className={CARD.flush}>
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--ink)]">{title}</h2>
      </div>
      <div className={TABLE.wrapper}>
        <table className={TABLE.table}>
          <tbody>{children}</tbody>
        </table>
      </div>
    </section>
  );
}

export default function OpsConsole() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await getOpsStatus();
      setPayload(result);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load ops status');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const jobSummary = useMemo(() => {
    const byStatus = payload?.jobs?.by_status || {};
    const entries = Object.entries(byStatus);
    if (payload?.jobs?.available === false) return 'Not installed';
    if (entries.length === 0) return 'No queued jobs';
    return entries.map(([status, count]) => `${status}: ${count}`).join(', ');
  }, [payload]);

  if (loading) return <LoadingState message="Loading ops console..." card />;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Ops Console</h1>
          <p className={PAGE.subtitle}>Platform health, release and runtime signals.</p>
        </div>
        <button type="button" className={BTN.secondary} onClick={() => load({ silent: true })} disabled={refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <ErrorState
          className="mb-5"
          title="Unable to load ops console"
          message={error}
          onRetry={() => load()}
        />
      )}

      {payload && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SignalCard
              label="Overall"
              status={payload.overall}
              value={STATUS_LABEL[payload.overall] || 'Unknown'}
              helper={`Generated ${formatDateTime(payload.generated_at)}`}
            />
            <SignalCard
              label="Database"
              status={payload.database?.status}
              value={payload.database?.status === 'ok' ? `${payload.database.latency_ms} ms` : 'Unavailable'}
              helper={`${payload.database?.active_homes ?? '-'} active homes`}
            />
            <SignalCard
              label="Upload Scanner"
              status={payload.upload_scanner?.status}
              value={payload.upload_scanner?.configured ? 'Configured' : 'Missing'}
              helper={payload.upload_scanner?.command || 'No scanner command'}
            />
            <SignalCard
              label="Jobs"
              status={payload.jobs?.status}
              value={payload.jobs?.available ? 'Available' : 'Pending'}
              helper={jobSummary}
            />
          </div>

          <div className={`${PAGE.section} grid gap-5 xl:grid-cols-2`}>
            <SectionTable title="Runtime">
              <InfoRow label="Environment" value={payload.runtime?.environment} />
              <InfoRow label="Git SHA" value={payload.runtime?.git_sha || '-'} mono />
              <InfoRow label="Node" value={payload.runtime?.node_version} />
              <InfoRow label="Platform" value={payload.runtime?.platform} />
              <InfoRow label="Uptime" value={formatUptime(payload.runtime?.uptime_seconds)} />
              <InfoRow label="PID" value={payload.runtime?.pid} />
              <InfoRow label="Memory" value={`${payload.runtime?.memory_mb?.rss ?? '-'} MB RSS / ${payload.runtime?.memory_mb?.heap_used ?? '-'} MB heap`} />
            </SectionTable>

            <SectionTable title="Database">
              <InfoRow label="Status" value={<StatusBadge status={payload.database?.status} />} />
              <InfoRow label="Database" value={payload.database?.database_name || '-'} />
              <InfoRow label="Active homes" value={payload.database?.active_homes} />
              <InfoRow label="Active users" value={payload.database?.active_users} />
              <InfoRow label="Pool" value={`${payload.database?.pool?.total ?? '-'} total / ${payload.database?.pool?.idle ?? '-'} idle / ${payload.database?.pool?.waiting ?? '-'} waiting / ${payload.database?.pool?.max ?? '-'} max`} />
              {payload.database?.error && <InfoRow label="Error" value={payload.database.error} />}
            </SectionTable>

            <SectionTable title="Security">
              <InfoRow label="Allowed origin" value={boolText(payload.security?.allowed_origin_configured)} />
              <InfoRow label="Metrics protected" value={boolText(payload.security?.metrics_endpoint_protected)} />
              <InfoRow label="Trust proxy" value={boolText(payload.security?.trust_proxy)} />
              <InfoRow label="Staff portal" value={boolText(payload.security?.staff_portal_enabled)} />
              <InfoRow label="Sentry" value={boolText(payload.security?.sentry_enabled)} />
            </SectionTable>

            <SectionTable title="Background Work">
              <InfoRow label="Job queue" value={payload.jobs?.available ? 'Installed' : 'Not installed'} />
              <InfoRow label="Job state" value={jobSummary} />
              <InfoRow label="Scanner" value={payload.upload_scanner?.configured ? payload.upload_scanner.command : 'Missing'} />
              <InfoRow label="Scanner timeout" value={`${payload.upload_scanner?.timeout_ms ?? '-'} ms`} />
              <InfoRow label="Fail closed in production" value={boolText(payload.upload_scanner?.fail_closed_in_production)} />
              {payload.jobs?.message && <InfoRow label="Job message" value={payload.jobs.message} />}
            </SectionTable>
          </div>
        </>
      )}
    </div>
  );
}
