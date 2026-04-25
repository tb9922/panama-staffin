import { useState, useEffect, useCallback, useMemo } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { getPensionEnrolments, upsertPensionEnrolment, getPensionConfig, getCurrentHome, getSchedulingData } from '../lib/api.js';
import StaffPicker from '../components/StaffPicker.jsx';
import { useData } from '../contexts/DataContext.jsx';
import { useToast } from '../contexts/useToast.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import useTransientNotice from '../hooks/useTransientNotice.js';

const STATUS_BADGE = {
  eligible_enrolled: BADGE.green,
  opt_in_enrolled: BADGE.green,
  pending_assessment: BADGE.amber,
  postponed: BADGE.amber,
  opted_out: BADGE.gray,
  entitled_not_enrolled: BADGE.gray,
};

const STATUS_LABEL = {
  eligible_enrolled: 'Auto-enrolled',
  opt_in_enrolled: 'Opted in',
  pending_assessment: 'Pending assessment',
  postponed: 'Postponed',
  opted_out: 'Opted out',
  entitled_not_enrolled: 'Entitled (not enrolled)',
};

const STATUSES = [
  'pending_assessment',
  'eligible_enrolled',
  'opt_in_enrolled',
  'postponed',
  'opted_out',
  'entitled_not_enrolled',
];

const EMPTY_FORM = {
  staff_id: '',
  status: 'pending_assessment',
  enrolled_date: '',
  opted_out_date: '',
  postponed_until: '',
  reassessment_date: '',
  contribution_override_employee: '',
  contribution_override_employer: '',
  notes: '',
};

function fmt(n) {
  if (n == null) return '-';
  return `£${parseFloat(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n) {
  if (n == null) return '-';
  return `${(parseFloat(n) * 100).toFixed(1)}%`;
}

export default function PensionManager() {
  const homeSlug = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('payroll');
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const { showToast } = useToast();

  const [schedData, setSchedData] = useState(null);
  const [enrolments, setEnrolments] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editStaffId, setEditStaffId] = useState(null);
  useDirtyGuard(!!showModal);

  useEffect(() => {
    if (!homeSlug) return;
    getSchedulingData(homeSlug).then(setSchedData).catch((e) => setError(e.message || 'Failed to load'));
  }, [homeSlug]);

  const staffMap = useMemo(() => {
    const map = {};
    (schedData?.staff || []).forEach((s) => { map[s.id] = s; });
    return map;
  }, [schedData]);

  const activeStaff = useMemo(() => (schedData?.staff || []).filter((s) => s.active !== false), [schedData]);

  const load = useCallback(async () => {
    if (!homeSlug) return;
    try {
      setLoading(true);
      setError(null);
      const [enrs, cfg] = await Promise.all([
        getPensionEnrolments(homeSlug),
        getPensionConfig(homeSlug),
      ]);
      setEnrolments(enrs);
      setConfig(cfg);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug]);

  useEffect(() => { void load(); }, [load]);

  const enrolled = enrolments.filter((e) => e.status === 'eligible_enrolled' || e.status === 'opt_in_enrolled');
  const pending = enrolments.filter((e) => e.status === 'pending_assessment');
  const optedOut = enrolments.filter((e) => e.status === 'opted_out');

  const enrolmentIds = new Set(enrolments.map((e) => e.staff_id));
  const unrecorded = activeStaff.filter((s) => !enrolmentIds.has(s.id));

  function openNew(preStaffId = '') {
    setEditStaffId(null);
    setForm({ ...EMPTY_FORM, staff_id: preStaffId });
    setShowModal(true);
  }

  function openEdit(enrolment) {
    setEditStaffId(enrolment.staff_id);
    setForm({
      staff_id: enrolment.staff_id,
      status: enrolment.status,
      enrolled_date: enrolment.enrolled_date || '',
      opted_out_date: enrolment.opted_out_date || '',
      postponed_until: enrolment.postponed_until || '',
      reassessment_date: enrolment.reassessment_date || '',
      contribution_override_employee: enrolment.contribution_override_employee != null
        ? String(enrolment.contribution_override_employee * 100)
        : '',
      contribution_override_employer: enrolment.contribution_override_employer != null
        ? String(enrolment.contribution_override_employer * 100)
        : '',
      notes: enrolment.notes || '',
    });
    setShowModal(true);
  }

  function field(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    if (!form.staff_id || !form.status) return;
    if (form.status === 'postponed' && !form.postponed_until) {
      setError('Postponed status requires a postponement end date.');
      return;
    }

    setSaving(true);
    try {
      await upsertPensionEnrolment(homeSlug, {
        ...form,
        contribution_override_employee: form.contribution_override_employee !== ''
          ? parseFloat(form.contribution_override_employee) / 100
          : null,
        contribution_override_employer: form.contribution_override_employer !== ''
          ? parseFloat(form.contribution_override_employer) / 100
          : null,
        enrolled_date: ['eligible_enrolled', 'opt_in_enrolled'].includes(form.status) ? (form.enrolled_date || null) : null,
        opted_out_date: form.status === 'opted_out' ? (form.opted_out_date || null) : null,
        postponed_until: form.status === 'postponed' ? (form.postponed_until || null) : null,
        reassessment_date: form.status === 'opted_out' ? (form.reassessment_date || null) : null,
      });
      showNotice(editStaffId ? 'Pension enrolment updated.' : 'Pension enrolment recorded.');
      showToast({
        title: editStaffId ? 'Pension enrolment updated' : 'Pension enrolment added',
        message: form.staff_id,
      });
      setShowModal(false);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading pension data..." /></div>;

  return (
    <div className={PAGE.container}>
      {notice && (
        <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">
          {notice.content}
        </InlineNotice>
      )}

      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Pension Auto-Enrolment</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage pension enrolment status, track opt-outs, and review upcoming pension dates.
          </p>
        </div>
        {canEdit && (
          <button type="button" className={BTN.primary} onClick={() => openNew()}>
            Add / Update Enrolment
          </button>
        )}
      </div>

      {error && (
        <ErrorState title="Pension action needs attention" message={error} onRetry={() => void load()} className="mb-4" />
      )}

      {unrecorded.length > 0 && (
        <InlineNotice variant="warning" className="mb-4">
          <strong>{unrecorded.length} staff member{unrecorded.length !== 1 ? 's' : ''} have no pension enrolment record:</strong>{' '}
          {unrecorded.map((s) => s.name).join(', ')}. Payroll may auto-assess these staff when a run is calculated,
          but you should still record their enrolment status explicitly.
        </InlineNotice>
      )}

      {config && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            { label: 'Employee contribution', value: fmtPct(config.employee_rate) },
            { label: 'Employer contribution', value: fmtPct(config.employer_rate) },
            { label: 'Lower earnings', value: `${fmt(config.lower_qualifying_weekly)} /wk` },
            { label: 'Upper earnings', value: `${fmt(config.upper_qualifying_weekly)} /wk` },
          ].map(({ label, value }) => (
            <div key={label} className={CARD.padded}>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-4)]">{label}</div>
              <div className="mt-2 font-mono text-xl font-semibold text-[var(--ink)]">{value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <span className={`rounded-full px-3 py-1 ${BADGE.green}`}>{enrolled.length} enrolled</span>
        <span className={`rounded-full px-3 py-1 ${BADGE.amber}`}>{pending.length} pending assessment</span>
        <span className={`rounded-full px-3 py-1 ${BADGE.gray}`}>{optedOut.length} opted out</span>
      </div>

      <div className={CARD.flush}>
        <div className="flex flex-col gap-1 border-b border-[var(--line)] bg-[var(--paper)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--ink)]">Enrolment records</h2>
            <p className="text-xs text-[var(--ink-3)]">Auto-enrolment status, opt-outs, review dates, and contribution overrides.</p>
          </div>
        </div>
        <div className={TABLE.wrapper} tabIndex={0} aria-label="Pension enrolment records table">
          <table className={TABLE.table}>
          <thead className={TABLE.thead}>
            <tr>
              <th scope="col" className={TABLE.th}>Staff Member</th>
              <th scope="col" className={TABLE.th}>Status</th>
              <th scope="col" className={TABLE.th}>Enrolment Date</th>
              <th scope="col" className={TABLE.th}>Opt-Out Date</th>
              <th scope="col" className={TABLE.th}>Review Date</th>
              <th scope="col" className={TABLE.th}>EE Rate</th>
              <th scope="col" className={TABLE.th}>ER Rate</th>
              <th scope="col" className={TABLE.th}>Notes</th>
              {canEdit && <th scope="col" className={TABLE.th}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {enrolments.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 9 : 8} className={TABLE.empty}>
                  <EmptyState
                    compact
                    title="No enrolment records yet"
                    description="Add records for each staff member after assessing eligibility."
                    actionLabel={canEdit ? 'Add / Update Enrolment' : undefined}
                    onAction={canEdit ? () => openNew() : undefined}
                  />
                </td>
              </tr>
            )}
            {enrolments.map((enrolment) => {
              const staff = staffMap[enrolment.staff_id];
              const reviewDate = enrolment.status === 'postponed' ? enrolment.postponed_until : enrolment.reassessment_date;
              const reviewWarning = reviewDate && new Date(reviewDate) <= new Date(Date.now() + 30 * 86400 * 1000);
              const eeRate = enrolment.contribution_override_employee != null
                ? fmtPct(enrolment.contribution_override_employee)
                : config ? fmtPct(config.employee_rate) : '-';
              const erRate = enrolment.contribution_override_employer != null
                ? fmtPct(enrolment.contribution_override_employer)
                : config ? fmtPct(config.employer_rate) : '-';
              return (
                <tr key={enrolment.staff_id} className={TABLE.tr}>
                  <td className={TABLE.td}>
                    <div className="font-medium text-gray-900">{staff?.name || enrolment.staff_id}</div>
                    {staff?.role && <div className="text-xs text-gray-400">{staff.role}</div>}
                  </td>
                  <td className={TABLE.td}>
                    <span className={`rounded px-2 py-0.5 text-xs ${STATUS_BADGE[enrolment.status] || BADGE.gray}`}>
                      {STATUS_LABEL[enrolment.status] || enrolment.status}
                    </span>
                  </td>
                  <td className={TABLE.td}>{enrolment.enrolled_date || <span className="text-gray-400">-</span>}</td>
                  <td className={TABLE.td}>{enrolment.opted_out_date || <span className="text-gray-400">-</span>}</td>
                  <td className={TABLE.td}>
                    {reviewDate ? (
                      <span className={reviewWarning ? 'font-medium text-amber-700' : ''}>
                        {reviewDate}
                        {reviewWarning && ' *'}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className={TABLE.td}>{eeRate}</td>
                  <td className={TABLE.td}>{erRate}</td>
                  <td className={TABLE.td}>
                    <span className="block max-w-[120px] truncate text-xs text-gray-500">{enrolment.notes || '-'}</span>
                  </td>
                  {canEdit && (
                    <td className={TABLE.td}>
                      <button type="button" className={`${BTN.ghost} ${BTN.xs}`} onClick={() => openEdit(enrolment)} title={`Edit pension record for ${staff?.name || enrolment.staff_id}`}>
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>
      </div>

      {unrecorded.length > 0 && (
        <div className={`${CARD.flush} mt-4`}>
          <div className={TABLE.wrapper} tabIndex={0} aria-label="Staff awaiting pension assessment table">
            <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th} colSpan={canEdit ? 9 : 8}>
                  <span className="text-amber-700">Staff awaiting pension assessment</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {unrecorded.map((staff) => (
                <tr key={staff.id} className="bg-amber-50">
                  <td className={TABLE.td}>
                    <div className="font-medium text-gray-900">{staff.name}</div>
                    <div className="text-xs text-gray-400">{staff.role}</div>
                  </td>
                  <td className={TABLE.td} colSpan={canEdit ? 7 : 7}>
                    <span className="text-xs text-amber-700">No enrolment status recorded</span>
                  </td>
                  {canEdit && (
                    <td className={TABLE.td}>
                      <button className={`${BTN.primary} ${BTN.xs}`} onClick={() => openNew(staff.id)}>
                        Assess
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-1 text-xs text-gray-400">
        <p>
          <strong>Auto-enrolment eligibility:</strong> Workers aged 22-SPA earning above the trigger
          (£10,000/yr) must be auto-enrolled. Workers aged 16-74 above the lower threshold can opt in.
        </p>
        <p>
          <strong>Postponement and re-enrolment:</strong> Postponed workers need a postponement end date,
          and opted-out workers should carry a re-enrolment date. Upcoming review dates trigger an amber warning 30 days in advance.
        </p>
        <p>
          <strong>Contribution overrides:</strong> Leave blank to use the scheme default rates
          ({config ? `EE ${fmtPct(config.employee_rate)} / ER ${fmtPct(config.employer_rate)}` : 'loaded from config'}).
          Set an override only if this staff member has a different agreed rate.
        </p>
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editStaffId ? 'Update Pension Enrolment' : 'Add Pension Enrolment'}
      >
        <div className="space-y-4">
          <div>
            {editStaffId && <label className={INPUT.label}>Staff Member</label>}
            {editStaffId ? (
              <div className="py-2 text-sm font-medium text-gray-900">
                {staffMap[editStaffId]?.name || editStaffId}
              </div>
            ) : (
              <StaffPicker id="pension-staff" label="Staff Member" value={form.staff_id} onChange={(v) => field('staff_id', v)} required />
            )}
          </div>

          <div>
            <label htmlFor="pension-status" className={INPUT.label}>Enrolment Status</label>
            <select id="pension-status" className={INPUT.select} value={form.status} onChange={(e) => field('status', e.target.value)}>
              {STATUSES.map((status) => (
                <option key={status} value={status}>{STATUS_LABEL[status]}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pension-enrolled-date" className={INPUT.label}>Enrolment Date</label>
              <input
                id="pension-enrolled-date"
                type="date"
                className={INPUT.base}
                value={form.enrolled_date}
                onChange={(e) => field('enrolled_date', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="pension-opted-out-date" className={INPUT.label}>Opt-Out Date</label>
              <input
                id="pension-opted-out-date"
                type="date"
                className={INPUT.base}
                value={form.opted_out_date}
                onChange={(e) => field('opted_out_date', e.target.value)}
              />
            </div>
          </div>

          {form.status === 'postponed' && (
            <div>
              <label htmlFor="pension-postponed-until" className={INPUT.label}>Postponed Until</label>
              <input
                id="pension-postponed-until"
                type="date"
                className={INPUT.base}
                value={form.postponed_until}
                onChange={(e) => field('postponed_until', e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-400">Required so payroll knows when to reassess postponement.</p>
            </div>
          )}

          {form.status === 'opted_out' && (
            <div>
              <label htmlFor="pension-reassessment-date" className={INPUT.label}>Re-enrolment Date</label>
              <input
                id="pension-reassessment-date"
                type="date"
                className={INPUT.base}
                value={form.reassessment_date}
                onChange={(e) => field('reassessment_date', e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-400">Typically 3 years after opt-out date.</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pension-ee-override" className={INPUT.label}>EE Contribution Override (%)</label>
              <input
                id="pension-ee-override"
                type="number"
                step="0.1"
                min="0"
                max="100"
                className={INPUT.base}
                value={form.contribution_override_employee}
                onChange={(e) => field('contribution_override_employee', e.target.value)}
                placeholder={config ? `${(config.employee_rate * 100).toFixed(1)} (default)` : ''}
              />
            </div>
            <div>
              <label htmlFor="pension-er-override" className={INPUT.label}>ER Contribution Override (%)</label>
              <input
                id="pension-er-override"
                type="number"
                step="0.1"
                min="0"
                max="100"
                className={INPUT.base}
                value={form.contribution_override_employer}
                onChange={(e) => field('contribution_override_employer', e.target.value)}
                placeholder={config ? `${(config.employer_rate * 100).toFixed(1)} (default)` : ''}
              />
            </div>
          </div>

          <div>
            <label htmlFor="pension-notes" className={INPUT.label}>Notes</label>
            <textarea
              id="pension-notes"
              className={INPUT.base}
              rows={2}
              value={form.notes}
              onChange={(e) => field('notes', e.target.value)}
              placeholder="e.g. Opted out by written notice 15 Jan 2026"
            />
          </div>
        </div>

        <div className={MODAL.footer}>
          <button className={BTN.secondary} onClick={() => setShowModal(false)} disabled={saving}>
            Cancel
          </button>
          <button
            className={BTN.primary}
            onClick={handleSave}
            disabled={saving || !form.staff_id || !form.status || (form.status === 'postponed' && !form.postponed_until)}
          >
            {saving ? 'Saving...' : 'Save Enrolment'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
