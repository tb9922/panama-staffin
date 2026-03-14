import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import { getPensionEnrolments, upsertPensionEnrolment, getPensionConfig, getCurrentHome, getSchedulingData } from '../lib/api.js';
import StaffPicker from '../components/StaffPicker.jsx';
import { useData } from '../contexts/DataContext.jsx';

const STATUS_BADGE = {
  eligible_enrolled:       BADGE.green,
  opt_in_enrolled:         BADGE.green,
  pending_assessment:      BADGE.amber,
  postponed:               BADGE.amber,
  opted_out:               BADGE.gray,
  entitled_not_enrolled:   BADGE.gray,
};

const STATUS_LABEL = {
  eligible_enrolled:       'Auto-enrolled',
  opt_in_enrolled:         'Opted in',
  pending_assessment:      'Pending assessment',
  postponed:               'Postponed',
  opted_out:               'Opted out',
  entitled_not_enrolled:   'Entitled (not enrolled)',
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
  staff_id: '', status: 'pending_assessment',
  enrolled_date: '', opt_out_date: '', re_enrolled_date: '',
  contribution_override_employee: '', contribution_override_employer: '',
  notes: '',
};

function fmt(n) {
  if (n == null) return '—';
  return `£${parseFloat(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n) {
  if (n == null) return '—';
  return `${(parseFloat(n) * 100).toFixed(1)}%`;
}

export default function PensionManager() {
  const homeSlug = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('payroll');

  const [schedData, setSchedData]   = useState(null);
  const [enrolments, setEnrolments] = useState([]);
  const [config, setConfig]         = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [saving, setSaving]         = useState(false);
  const [showModal, setShowModal]   = useState(false);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [editStaffId, setEditStaffId] = useState(null);

  useEffect(() => {
    const h = getCurrentHome();
    if (!h) return;
    getSchedulingData(h).then(setSchedData).catch(e => setError(e.message || 'Failed to load'));
  }, []);

  const staffMap = {};
  (schedData?.staff || []).forEach(s => { staffMap[s.id] = s; });

  const activeStaff = (schedData?.staff || []).filter(s => s.active !== false);

  const load = useCallback(async () => {
    if (!homeSlug) return;
    try {
      setLoading(true);
      setError(null);
      const [enrs, cfg] = await Promise.all([
        getPensionEnrolments(homeSlug),
        getPensionConfig(),
      ]);
      setEnrolments(enrs);
      setConfig(cfg);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug]);

  useEffect(() => { load(); }, [load]);

  const enrolled = enrolments.filter(e =>
    e.status === 'eligible_enrolled' || e.status === 'opt_in_enrolled'
  );
  const pending  = enrolments.filter(e => e.status === 'pending_assessment');
  const optedOut = enrolments.filter(e => e.status === 'opted_out');

  // Staff with no enrolment record
  const enrolledIds = new Set(enrolments.map(e => e.staff_id));
  const unrecorded  = activeStaff.filter(s => !enrolledIds.has(s.id));

  function openNew(preStaffId = '') {
    setEditStaffId(null);
    setForm({ ...EMPTY_FORM, staff_id: preStaffId });
    setShowModal(true);
  }

  function openEdit(enr) {
    setEditStaffId(enr.staff_id);
    setForm({
      staff_id:                       enr.staff_id,
      status:                         enr.status,
      enrolled_date:                 enr.enrolled_date || '',
      opt_out_date:                   enr.opt_out_date || '',
      re_enrolled_date:              enr.re_enrolled_date || '',
      contribution_override_employee: enr.contribution_override_employee != null
        ? String(enr.contribution_override_employee * 100) : '',
      contribution_override_employer: enr.contribution_override_employer != null
        ? String(enr.contribution_override_employer * 100) : '',
      notes:                          enr.notes || '',
    });
    setShowModal(true);
  }

  function field(k, v) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function handleSave() {
    if (!form.staff_id || !form.status) return;
    setSaving(true);
    try {
      await upsertPensionEnrolment(homeSlug, {
        ...form,
        contribution_override_employee: form.contribution_override_employee !== ''
          ? parseFloat(form.contribution_override_employee) / 100 : null,
        contribution_override_employer: form.contribution_override_employer !== ''
          ? parseFloat(form.contribution_override_employer) / 100 : null,
        enrolled_date:    form.enrolled_date    || null,
        opt_out_date:      form.opt_out_date      || null,
        re_enrolled_date: form.re_enrolled_date || null,
      });
      setShowModal(false);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className={PAGE.container} role="status"><p className="text-gray-500">Loading...</p></div>;

  return (
    <div className={PAGE.container}>
      {/* Header */}
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Pension Auto-Enrolment</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage pension enrolment status, track opt-outs, and review upcoming re-enrolment dates.
          </p>
        </div>
        {canEdit && (
          <button className={BTN.primary} onClick={() => openNew()}>Add / Update Enrolment</button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700" role="alert">{error}</div>
      )}

      {/* Unrecorded alert */}
      {unrecorded.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
          <strong>{unrecorded.length} staff member{unrecorded.length !== 1 ? 's' : ''} have no pension enrolment record:</strong>{' '}
          {unrecorded.map(s => s.name).join(', ')}.{' '}
          These staff will not have pension deductions calculated during payroll. Add their enrolment status.
        </div>
      )}

      {/* Pension config summary */}
      {config && (
        <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Employee contribution', value: fmtPct(config.employee_rate) },
            { label: 'Employer contribution', value: fmtPct(config.employer_rate) },
            { label: 'Lower earnings', value: `${fmt(config.lower_weekly)} /wk` },
            { label: 'Upper earnings', value: `${fmt(config.upper_weekly)} /wk` },
          ].map(({ label, value }) => (
            <div key={label} className={`${CARD.padded} text-center`}>
              <div className="text-xs text-gray-500 mb-1">{label}</div>
              <div className="text-lg font-semibold text-gray-900">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Summary pills */}
      <div className="mb-4 flex gap-3 flex-wrap text-sm">
        <span className={`px-3 py-1 rounded-full ${BADGE.green}`}>
          {enrolled.length} enrolled
        </span>
        <span className={`px-3 py-1 rounded-full ${BADGE.amber}`}>
          {pending.length} pending assessment
        </span>
        <span className={`px-3 py-1 rounded-full ${BADGE.gray}`}>
          {optedOut.length} opted out
        </span>
      </div>

      {/* Enrolments table */}
      <div className={CARD.flush}>
        <table className={TABLE.table}>
          <thead className={TABLE.thead}>
            <tr>
              <th scope="col" className={TABLE.th}>Staff Member</th>
              <th scope="col" className={TABLE.th}>Status</th>
              <th scope="col" className={TABLE.th}>Enrolment Date</th>
              <th scope="col" className={TABLE.th}>Opt-Out Date</th>
              <th scope="col" className={TABLE.th}>Re-enrolment Due</th>
              <th scope="col" className={TABLE.th}>EE Rate</th>
              <th scope="col" className={TABLE.th}>ER Rate</th>
              <th scope="col" className={TABLE.th}>Notes</th>
              {canEdit && <th scope="col" className={TABLE.th}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {enrolments.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 9 : 8} className="px-4 py-8 text-center text-gray-400 text-sm">
                  No enrolment records. Add records for each staff member after assessing eligibility.
                </td>
              </tr>
            )}
            {enrolments.map(enr => {
              const staff = staffMap[enr.staff_id];
              const reEnrolmentWarning = enr.re_enrolled_date &&
                new Date(enr.re_enrolled_date) <= new Date(Date.now() + 30 * 86400 * 1000);
              const eeRate = enr.contribution_override_employee != null
                ? fmtPct(enr.contribution_override_employee)
                : config ? fmtPct(config.employee_rate) : '—';
              const erRate = enr.contribution_override_employer != null
                ? fmtPct(enr.contribution_override_employer)
                : config ? fmtPct(config.employer_rate) : '—';
              return (
                <tr key={enr.staff_id} className={TABLE.tr}>
                  <td className={TABLE.td}>
                    <div className="font-medium text-gray-900">{staff?.name || enr.staff_id}</div>
                    {staff?.role && <div className="text-xs text-gray-400">{staff.role}</div>}
                  </td>
                  <td className={TABLE.td}>
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_BADGE[enr.status] || BADGE.gray}`}>
                      {STATUS_LABEL[enr.status] || enr.status}
                    </span>
                  </td>
                  <td className={TABLE.td}>{enr.enrolled_date || <span className="text-gray-400">—</span>}</td>
                  <td className={TABLE.td}>{enr.opt_out_date || <span className="text-gray-400">—</span>}</td>
                  <td className={TABLE.td}>
                    {enr.re_enrolled_date ? (
                      <span className={reEnrolmentWarning ? 'text-amber-700 font-medium' : ''}>
                        {enr.re_enrolled_date}
                        {reEnrolmentWarning && ' ⚠'}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className={TABLE.td}>{eeRate}</td>
                  <td className={TABLE.td}>{erRate}</td>
                  <td className={TABLE.td}>
                    <span className="text-xs text-gray-500 truncate max-w-[120px] block">{enr.notes || '—'}</span>
                  </td>
                  {canEdit && (
                    <td className={TABLE.td}>
                      <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => openEdit(enr)}>
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

      {/* Unrecorded staff footer */}
      {unrecorded.length > 0 && (
        <div className={`${CARD.flush} mt-4`}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th} colSpan={canEdit ? 9 : 8}>
                  <span className="text-amber-700">Staff awaiting pension assessment</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {unrecorded.map(s => (
                <tr key={s.id} className="bg-amber-50">
                  <td className={TABLE.td}>
                    <div className="font-medium text-gray-900">{s.name}</div>
                    <div className="text-xs text-gray-400">{s.role}</div>
                  </td>
                  <td className={TABLE.td} colSpan={canEdit ? 7 : 7}>
                    <span className="text-amber-700 text-xs">No enrolment status recorded</span>
                  </td>
                  {canEdit && (
                    <td className={TABLE.td}>
                      <button
                        className={BTN.primary + ' ' + BTN.xs}
                        onClick={() => openNew(s.id)}
                      >
                        Assess
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Notes */}
      <div className="mt-4 text-xs text-gray-400 space-y-1">
        <p>
          <strong>Auto-enrolment eligibility:</strong> Workers aged 22-SPA earning above the trigger
          (£10,000/yr) must be auto-enrolled. Workers aged 16-74 above the lower threshold can opt in.
        </p>
        <p>
          <strong>Re-enrolment:</strong> Opted-out workers must be re-enrolled every 3 years. The
          re-enrolment date triggers an amber warning 30 days in advance.
        </p>
        <p>
          <strong>Contribution overrides:</strong> Leave blank to use the scheme default rates
          ({config ? `EE ${fmtPct(config.employee_rate)} / ER ${fmtPct(config.employer_rate)}` : 'loaded from config'}).
          Set an override only if this staff member has a different agreed rate.
        </p>
      </div>

      {/* Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editStaffId ? 'Update Pension Enrolment' : 'Add Pension Enrolment'}>
        <div className="space-y-4">
          {/* Staff */}
          <div>
            <label className={INPUT.label}>Staff Member</label>
            {editStaffId ? (
              <div className="text-sm font-medium text-gray-900 py-2">
                {staffMap[editStaffId]?.name || editStaffId}
              </div>
            ) : (
              <StaffPicker
                value={form.staff_id}
                onChange={v => field('staff_id', v)}
                required
              />
            )}
          </div>

          {/* Status */}
          <div>
            <label className={INPUT.label}>Enrolment Status</label>
            <select className={INPUT.select} value={form.status} onChange={e => field('status', e.target.value)}>
              {STATUSES.map(s => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Enrolment Date</label>
              <input type="date" className={INPUT.base}
                value={form.enrolled_date}
                onChange={e => field('enrolled_date', e.target.value)} />
            </div>
            <div>
              <label className={INPUT.label}>Opt-Out Date</label>
              <input type="date" className={INPUT.base}
                value={form.opt_out_date}
                onChange={e => field('opt_out_date', e.target.value)} />
            </div>
          </div>

          <div>
            <label className={INPUT.label}>Re-enrolment Date</label>
            <input type="date" className={INPUT.base}
              value={form.re_enrolled_date}
              onChange={e => field('re_enrolled_date', e.target.value)} />
            <p className="text-xs text-gray-400 mt-1">Typically 3 years after opt-out date.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>EE Contribution Override (%)</label>
              <input type="number" step="0.1" min="0" max="100" className={INPUT.base}
                value={form.contribution_override_employee}
                onChange={e => field('contribution_override_employee', e.target.value)}
                placeholder={config ? `${(config.employee_rate * 100).toFixed(1)} (default)` : ''} />
            </div>
            <div>
              <label className={INPUT.label}>ER Contribution Override (%)</label>
              <input type="number" step="0.1" min="0" max="100" className={INPUT.base}
                value={form.contribution_override_employer}
                onChange={e => field('contribution_override_employer', e.target.value)}
                placeholder={config ? `${(config.employer_rate * 100).toFixed(1)} (default)` : ''} />
            </div>
          </div>

          <div>
            <label className={INPUT.label}>Notes</label>
            <textarea className={INPUT.base} rows={2}
              value={form.notes}
              onChange={e => field('notes', e.target.value)}
              placeholder="e.g. Opted out by written notice 15 Jan 2026" />
          </div>
        </div>

        <div className={MODAL.footer}>
          <button className={BTN.secondary} onClick={() => setShowModal(false)} disabled={saving}>
            Cancel
          </button>
          <button
            className={BTN.primary}
            onClick={handleSave}
            disabled={saving || !form.staff_id || !form.status}
          >
            {saving ? 'Saving...' : 'Save Enrolment'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
