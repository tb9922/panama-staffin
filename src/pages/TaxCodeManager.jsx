import { useState, useEffect, useCallback, useMemo } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { getTaxCodes, upsertTaxCode, getCurrentHome, getSchedulingData } from '../lib/api.js';
import StaffPicker from '../components/StaffPicker.jsx';
import { useData } from '../contexts/DataContext.jsx';
import { useToast } from '../contexts/useToast.js';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import useTransientNotice from '../hooks/useTransientNotice.js';
import { todayLocalISO } from '../lib/localDates.js';

const BASIS_LABEL   = { cumulative: 'Cumulative', w1m1: 'W1/M1 (Emergency)' };
const SOURCE_LABEL  = { manual: 'Manual', p45: 'P45', hmrc: 'HMRC Notice', starter: 'Starter Checklist' };
const NI_CATEGORIES = ['A','B','C','F','H','I','J','L','M','S','V','Z'];

function emptyForm() {
  return {
    staff_id: '', tax_code: '1257L', basis: 'cumulative', ni_category: 'A',
    effective_from: todayLocalISO(),
    previous_pay: '', previous_tax: '', student_loan_plan: '',
    source: 'manual', notes: '',
  };
}

function fmt(n) {
  if (n == null || n === '') return '—';
  return `£${parseFloat(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function TaxCodeManager() {
  const homeSlug = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('payroll');
  const { notice, showNotice, clearNotice } = useTransientNotice();
  const { showToast } = useToast();

  const [schedData, setSchedData] = useState(null);
  const [codes, setCodes]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [saving, setSaving]     = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm]         = useState(emptyForm());
  const [editStaffId, setEditStaffId] = useState(null); // null = new, else = editing
  useDirtyGuard(!!showModal);

  useEffect(() => {
    if (!homeSlug) return;
    getSchedulingData(homeSlug).then(setSchedData).catch(e => setError(e.message || 'Failed to load'));
  }, [homeSlug]);

  const staffMap = useMemo(() => {
    const map = {};
    (schedData?.staff || []).forEach(s => { map[s.id] = s; });
    return map;
  }, [schedData]);

  const activeStaff = useMemo(() => (schedData?.staff || []).filter(s => s.active !== false), [schedData]);

  const load = useCallback(async () => {
    if (!homeSlug) return;
    try {
      setLoading(true);
      setError(null);
      const result = await getTaxCodes(homeSlug);
      setCodes(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug]);

  useEffect(() => { load(); }, [load]);

  // Staff with no tax code record on file (will default to 1257L)
  const staffWithCode = new Set(codes.map(c => c.staff_id));
  const missingCodes  = activeStaff.filter(s => !staffWithCode.has(s.id));

  function openNew() {
    setEditStaffId(null);
    setForm(emptyForm());
    setShowModal(true);
  }

  function openEdit(code) {
    setEditStaffId(code.staff_id);
    setForm({
      staff_id:          code.staff_id,
      tax_code:          code.tax_code || '1257L',
      basis:             code.basis || 'cumulative',
      ni_category:       code.ni_category || 'A',
      effective_from:    code.effective_from || todayLocalISO(),
      previous_pay:      code.previous_pay != null ? String(code.previous_pay) : '',
      previous_tax:      code.previous_tax != null ? String(code.previous_tax) : '',
      student_loan_plan: code.student_loan_plan || '',
      source:            code.source || 'manual',
      notes:             code.notes || '',
    });
    setShowModal(true);
  }

  function field(k, v) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function handleSave() {
    if (!form.staff_id || !form.tax_code || !form.effective_from) return;
    setSaving(true);
    try {
      await upsertTaxCode(homeSlug, {
        ...form,
        previous_pay:  form.previous_pay  !== '' ? parseFloat(form.previous_pay)  : 0,
        previous_tax:  form.previous_tax  !== '' ? parseFloat(form.previous_tax)  : 0,
        student_loan_plan: form.student_loan_plan.trim() || null,
        ni_category:   form.ni_category,
      });
      showNotice(editStaffId ? 'Tax code updated.' : 'Tax code recorded.');
      showToast({
        title: editStaffId ? 'Tax code updated' : 'Tax code added',
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

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading tax code data..." /></div>;

  return (
    <div className={PAGE.container}>
      {notice && (
        <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">
          {notice.content}
        </InlineNotice>
      )}
      {/* Header */}
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Tax Code Manager</h1>
          <p className="text-sm text-gray-500 mt-1">
            PAYE tax codes, NI categories, and student loan plans per staff member.
            Missing records default to 1257L cumulative (Category A).
          </p>
        </div>
        {canEdit && (
          <button className={BTN.primary} onClick={openNew}>Add / Update Tax Code</button>
        )}
      </div>

      {/* Error */}
      {error && (
        <ErrorState title="Tax code action needs attention" message={error} onRetry={() => void load()} className="mb-4" />
      )}

      {/* Missing code alert */}
      {missingCodes.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
          <strong>No tax code on file for {missingCodes.length} staff member{missingCodes.length !== 1 ? 's' : ''}:</strong>{' '}
          {missingCodes.map(s => s.name).join(', ')}.{' '}
          Payroll will use 1257L cumulative (Category A) for these staff. Add their tax codes to ensure accurate deductions.
        </div>
      )}

      {/* Tax codes table */}
      <div className={CARD.flush}>
        <table className={TABLE.table}>
          <thead className={TABLE.thead}>
            <tr>
              <th scope="col" className={TABLE.th}>Staff Member</th>
              <th scope="col" className={TABLE.th}>Tax Code</th>
              <th scope="col" className={TABLE.th}>Basis</th>
              <th scope="col" className={TABLE.th}>NI Cat.</th>
              <th scope="col" className={TABLE.th}>Student Loan</th>
              <th scope="col" className={TABLE.th}>Prev. Pay (YTD)</th>
              <th scope="col" className={TABLE.th}>Prev. Tax (YTD)</th>
              <th scope="col" className={TABLE.th}>Effective</th>
              <th scope="col" className={TABLE.th}>Source</th>
              {canEdit && <th scope="col" className={TABLE.th}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {codes.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 10 : 9} className={TABLE.empty}>
                  <EmptyState
                    compact
                    title="No tax codes recorded yet"
                    description="All staff will use 1257L cumulative (Category A) until a tax code record is added."
                    actionLabel={canEdit ? 'Add / Update Tax Code' : undefined}
                    onAction={canEdit ? openNew : undefined}
                  />
                </td>
              </tr>
            )}
            {codes.map(code => {
              const staff = staffMap[code.staff_id];
              return (
                <tr key={code.id || code.staff_id} className={TABLE.tr}>
                  <td className={TABLE.td}>
                    <div className="font-medium text-gray-900">{staff?.name || code.staff_id}</div>
                    {staff?.ni_number && (
                      <div className="text-xs text-gray-500">NI: {canEdit ? staff.ni_number : staff.ni_number.replace(/.(?=.{2})/g, '*')}</div>
                    )}
                    {staff?.role && (
                      <div className="text-xs text-gray-400">{staff.role}</div>
                    )}
                  </td>
                  <td className={TABLE.td}>
                    <span className="font-mono font-semibold">{code.tax_code}</span>
                    {code.basis === 'w1m1' && (
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${BADGE.amber}`}>W1/M1</span>
                    )}
                  </td>
                  <td className={TABLE.td}>{BASIS_LABEL[code.basis] || code.basis}</td>
                  <td className={TABLE.td}>
                    <span className={`text-xs px-2 py-0.5 rounded font-mono ${BADGE.blue}`}>
                      Cat. {code.ni_category || 'A'}
                    </span>
                  </td>
                  <td className={TABLE.td}>{code.student_loan_plan || <span className="text-gray-400">None</span>}</td>
                  <td className={`${TABLE.td} font-mono text-sm`}>{fmt(code.previous_pay)}</td>
                  <td className={`${TABLE.td} font-mono text-sm`}>{fmt(code.previous_tax)}</td>
                  <td className={TABLE.td}>{code.effective_from}</td>
                  <td className={TABLE.td}>{SOURCE_LABEL[code.source] || code.source}</td>
                  {canEdit && (
                    <td className={TABLE.td}>
                      <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => openEdit(code)}>
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

      {/* Missing staff rows (shown below table) */}
      {missingCodes.length > 0 && (
        <div className={`${CARD.flush} mt-4`}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th} colSpan={canEdit ? 10 : 9}>
                  <span className="text-amber-700">Staff using default 1257L (no record on file)</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {missingCodes.map(s => (
                <tr key={s.id} className="bg-amber-50">
                  <td className={TABLE.td}>
                    <div className="font-medium text-gray-900">{s.name}</div>
                    {s.ni_number && <div className="text-xs text-gray-500">NI: {canEdit ? s.ni_number : s.ni_number.replace(/.(?=.{2})/g, '*')}</div>}
                    <div className="text-xs text-gray-400">{s.role}</div>
                  </td>
                  <td className={TABLE.td}><span className="font-mono text-gray-400">1257L (default)</span></td>
                  <td className={TABLE.td}><span className="text-gray-400">Cumulative</span></td>
                  <td className={TABLE.td}><span className="text-gray-400">A (default)</span></td>
                  <td className={TABLE.td} colSpan={5}><span className="text-gray-400">—</span></td>
                  {canEdit && (
                    <td className={TABLE.td}>
                      <button
                        className={BTN.primary + ' ' + BTN.xs}
                        onClick={() => {
                          setEditStaffId(null);
                          setForm({ ...emptyForm(), staff_id: s.id });
                          setShowModal(true);
                        }}
                      >
                        Add
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
          <strong>W1/M1 (Emergency):</strong> Each pay period treated independently. Use when HMRC instructs or for
          new starters without a P45.
        </p>
        <p>
          <strong>Previous Pay / Tax (YTD from previous employer):</strong> Taken from P45 Box 4/5. Enter these if the
          staff member started mid-year from another employer.
        </p>
        <p>
          <strong>Student Loan plans:</strong> Plan 1, Plan 2, Plan 4 (Scotland), or PG (Postgraduate). Enter as
          comma-separated values if multiple apply, e.g. &quot;1,PG&quot;.
        </p>
      </div>

      {/* Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editStaffId ? 'Update Tax Code' : 'Add Tax Code'}>
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

          <div className="grid grid-cols-2 gap-4">
            {/* Tax code */}
            <div>
              <label className={INPUT.label}>Tax Code</label>
              <input
                className={INPUT.base}
                value={form.tax_code}
                onChange={e => field('tax_code', e.target.value.toUpperCase())}
                placeholder="e.g. 1257L"
              />
              <p className="text-xs text-gray-400 mt-1">
                S prefix = Scotland. K codes apply addition to taxable pay.
              </p>
            </div>

            {/* Basis */}
            <div>
              <label className={INPUT.label}>Basis</label>
              <select className={INPUT.select} value={form.basis} onChange={e => field('basis', e.target.value)}>
                <option value="cumulative">Cumulative</option>
                <option value="w1m1">W1/M1 (Emergency)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* NI Category */}
            <div>
              <label className={INPUT.label}>NI Category</label>
              <select className={INPUT.select} value={form.ni_category} onChange={e => field('ni_category', e.target.value)}>
                {NI_CATEGORIES.map(c => (
                  <option key={c} value={c}>Category {c}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Most employees: Category A</p>
            </div>

            {/* Student Loan */}
            <div>
              <label className={INPUT.label}>Student Loan Plan</label>
              <input
                className={INPUT.base}
                value={form.student_loan_plan}
                onChange={e => field('student_loan_plan', e.target.value)}
                placeholder="e.g. 1 or 2 or 1,PG"
              />
              <p className="text-xs text-gray-400 mt-1">Leave blank if no deduction applies</p>
            </div>
          </div>

          {/* Effective from */}
          <div>
            <label className={INPUT.label}>Effective From</label>
            <input
              type="date"
              className={INPUT.base}
              value={form.effective_from}
              onChange={e => field('effective_from', e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">
              New records do not overwrite earlier effective dates — all history is preserved.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Previous pay */}
            <div>
              <label className={INPUT.label}>Previous Pay (P45 Box 4) £</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className={INPUT.base}
                value={form.previous_pay}
                onChange={e => field('previous_pay', e.target.value)}
                placeholder="0.00"
              />
            </div>

            {/* Previous tax */}
            <div>
              <label className={INPUT.label}>Previous Tax (P45 Box 5) £</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className={INPUT.base}
                value={form.previous_tax}
                onChange={e => field('previous_tax', e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Source */}
          <div>
            <label className={INPUT.label}>Source</label>
            <select className={INPUT.select} value={form.source} onChange={e => field('source', e.target.value)}>
              <option value="manual">Manual entry</option>
              <option value="p45">P45 from previous employer</option>
              <option value="starter">Starter checklist</option>
              <option value="hmrc">HMRC coding notice</option>
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className={INPUT.label}>Notes (optional)</label>
            <textarea
              className={INPUT.base}
              rows={2}
              value={form.notes}
              onChange={e => field('notes', e.target.value)}
              placeholder="e.g. Updated per HMRC P6 notice received 15 Jan 2026"
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
            disabled={saving || !form.staff_id || !form.tax_code || !form.effective_from}
          >
            {saving ? 'Saving...' : 'Save Tax Code'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
