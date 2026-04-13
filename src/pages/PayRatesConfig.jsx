import { useState, useEffect, useCallback } from 'react';
import { BTN, CARD, TABLE, INPUT, MODAL, BADGE, PAGE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import FileAttachments from '../components/FileAttachments.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import {
  getPayRateRules, createPayRateRule, updatePayRateRule, deletePayRateRule, getNMWRates,
  getCurrentHome, getRecordAttachments, uploadRecordAttachment, deleteRecordAttachment, downloadRecordAttachment,
} from '../lib/api.js';
import useDirtyGuard from '../hooks/useDirtyGuard';
import { useData } from '../contexts/DataContext.jsx';

const APPLIES_TO_LABELS = {
  night:        'Night Shifts',
  weekend_sat:  'Saturday',
  weekend_sun:  'Sunday',
  bank_holiday: 'Bank Holidays',
  sleep_in:     'Sleep-in',
  overtime:     'Overtime (OT)',
  on_call:      'On-Call (OC-*)',
};

const RATE_TYPE_LABELS = {
  percentage:     '% of base rate',
  fixed_hourly:   '£/hr on top',
  flat_per_shift: '£ flat per shift',
};

const EMPTY_RULE = {
  name: '', rate_type: 'percentage', amount: '', applies_to: 'night', priority: 0,
};

export default function PayRatesConfig() {
  const homeSlug = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('payroll');

  const [rules, setRules] = useState([]);
  const [nmwRates, setNmwRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null); // null | { mode: 'add' | 'edit', rule? }
  const [form, setForm] = useState(EMPTY_RULE);
  const [saving, setSaving] = useState(false);
  useDirtyGuard(!!modal);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const load = useCallback(async () => {
    if (!homeSlug) return;
    try {
      setLoading(true);
      setError(null);
      const [r, n] = await Promise.all([getPayRateRules(homeSlug), getNMWRates()]);
      setRules(r);
      setNmwRates(n);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [homeSlug]);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setForm(EMPTY_RULE);
    setModal({ mode: 'add' });
  }

  function openEdit(rule) {
    setForm({
      name: rule.name, rate_type: rule.rate_type,
      amount: rule.amount, applies_to: rule.applies_to, priority: rule.priority,
    });
    setModal({ mode: 'edit', rule });
  }

  async function handleSave() {
    if (!form.name || !form.amount) return;
    setSaving(true);
    try {
      const payload = { ...form, amount: parseFloat(form.amount) };
      if (modal.mode === 'add') {
        await createPayRateRule(homeSlug, payload);
      } else {
        await updatePayRateRule(homeSlug, modal.rule.id, payload);
      }
      setModal(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(ruleId) {
    setSaving(true);
    try {
      await deletePayRateRule(homeSlug, ruleId);
      setDeleteConfirm(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function formatAmount(rule) {
    const amt = parseFloat(rule.amount) || 0;
    if (rule.rate_type === 'percentage')     return `${amt}%`;
    if (rule.rate_type === 'fixed_hourly')   return `+£${amt.toFixed(2)}/hr`;
    if (rule.rate_type === 'flat_per_shift') return `£${amt.toFixed(2)} flat`;
    return amt;
  }

  // Group NMW rates by bracket for display
  const nmwByBracket = {};
  for (const r of nmwRates) {
    if (!nmwByBracket[r.age_bracket]) nmwByBracket[r.age_bracket] = [];
    nmwByBracket[r.age_bracket].push(r);
  }

  if (!homeSlug) return (
    <div className={PAGE.container}>
      <p className="text-gray-500">Select a home to manage pay rate rules.</p>
    </div>
  );

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Pay Rate Rules</h1>
          <p className={PAGE.subtitle}>Enhancement rules applied on top of each staff member's base hourly rate</p>
        </div>
        {canEdit && (
          <button className={BTN.primary} onClick={openAdd}>+ Add Rule</button>
        )}
      </div>

      {error && <ErrorState title="Pay rate action needs attention" message={error} onRetry={load} className="mb-4" />}

      {/* Enhancement Rules */}
      <div className={`${CARD.flush} mb-6`}>
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-700">Active Enhancement Rules</h2>
          <p className="text-xs text-gray-500 mt-0.5">Enhancements stack additively — not multiplicatively. A Sunday night shift gets night% + sunday%, not multiplied.</p>
        </div>
        {loading ? (
          <LoadingState message="Loading rules…" compact />
        ) : (
          <div className={TABLE.wrapper}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th scope="col" className={TABLE.th}>Rule Name</th>
                  <th scope="col" className={TABLE.th}>Applies To</th>
                  <th scope="col" className={TABLE.th}>Rate Type</th>
                  <th scope="col" className={TABLE.th}>Amount</th>
                  <th scope="col" className={TABLE.th}>Effective From</th>
                  {canEdit && <th scope="col" className={TABLE.th}></th>}
                </tr>
              </thead>
              <tbody>
                {rules.length === 0 ? (
                  <tr>
                    <td colSpan={canEdit ? 6 : 5} className={TABLE.empty}>
                      <EmptyState
                        compact
                        title="No active rules. Click + Add Rule to create one."
                        description="Create enhancement rules here for nights, weekends, bank holidays, sleep-ins, and overtime."
                      />
                    </td>
                  </tr>
                ) : rules.map(rule => (
                  <tr key={rule.id} className={TABLE.tr}>
                    <td className={`${TABLE.td} font-medium`}>{rule.name}</td>
                    <td className={TABLE.td}>
                      <span className={BADGE.blue}>{APPLIES_TO_LABELS[rule.applies_to] || rule.applies_to}</span>
                    </td>
                    <td className={TABLE.td + ' text-gray-500 text-xs'}>{RATE_TYPE_LABELS[rule.rate_type]}</td>
                    <td className={`${TABLE.td} font-mono font-semibold`}>{formatAmount(rule)}</td>
                    <td className={TABLE.td + ' text-gray-500'}>{rule.effective_from}</td>
                    {canEdit && (
                      <td className={TABLE.td}>
                        <div className="flex gap-2">
                          <button className={`${BTN.secondary} ${BTN.xs}`} onClick={() => openEdit(rule)}>Edit</button>
                          <button className={`${BTN.danger} ${BTN.xs}`} onClick={() => setDeleteConfirm(rule)}>Remove</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* NMW Reference Table */}
      <div className={CARD.flush}>
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-700">National Minimum Wage Reference</h2>
          <p className="text-xs text-gray-500 mt-0.5">Payroll engine checks every shift against the applicable rate. Approval is blocked if any shift falls below NMW.</p>
        </div>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Age Bracket</th>
                <th scope="col" className={TABLE.th}>Effective From</th>
                <th scope="col" className={TABLE.th}>Hourly Rate</th>
              </tr>
            </thead>
            <tbody>
              {nmwRates.map(r => (
                <tr key={r.id} className={TABLE.tr}>
                  <td className={TABLE.td}>
                    <span className={BADGE.gray}>{r.age_bracket}</span>
                  </td>
                  <td className={TABLE.td + ' text-gray-500'}>{r.effective_from}</td>
                  <td className={`${TABLE.td} font-mono font-semibold`}>£{parseFloat(r.hourly_rate).toFixed(2)}/hr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={!!modal} onClose={() => setModal(null)} title={modal?.mode === 'add' ? 'Add Pay Rate Rule' : 'Edit Pay Rate Rule'} size="lg">
        <div className="space-y-4">
          <div>
            <label className={INPUT.label}>Rule Name</label>
            <input className={INPUT.base} value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Night Enhancement" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={INPUT.label}>Applies To</label>
              <select className={INPUT.select} value={form.applies_to}
                onChange={e => setForm(f => ({ ...f, applies_to: e.target.value }))}>
                {Object.entries(APPLIES_TO_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={INPUT.label}>Rate Type</label>
              <select className={INPUT.select} value={form.rate_type}
                onChange={e => setForm(f => ({ ...f, rate_type: e.target.value }))}>
                {Object.entries(RATE_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={INPUT.label}>
              Amount {form.rate_type === 'percentage' ? '(%)' : form.rate_type === 'flat_per_shift' ? '(£ flat)' : '(£/hr)'}
            </label>
            <input className={INPUT.base} type="number" step="0.01" min="0" value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              placeholder={form.rate_type === 'percentage' ? 'e.g. 15' : 'e.g. 2.00'} />
            {form.rate_type === 'percentage' && form.amount && (
              <p className="text-xs text-gray-500 mt-1">
                Example: 12hr night shift at £12.00/hr → +£{(12 * 12 * parseFloat(form.amount || 0) / 100).toFixed(2)} enhancement
              </p>
            )}
          </div>
          {modal?.mode === 'edit' && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded p-2">
              Editing creates a new version of this rule dated today. The previous version is preserved for historical payroll records.
            </p>
          )}
          <FileAttachments
            caseType="payroll_rate_rule"
            caseId={modal?.mode === 'edit' ? modal?.id : null}
            readOnly={!canEdit}
            title="Rate Rule Evidence"
            emptyText="No rate rule evidence uploaded yet."
            saveFirstText="Save this pay rate rule first, then attach agreements, approvals, and supporting evidence."
            getFiles={getRecordAttachments}
            uploadFile={uploadRecordAttachment}
            deleteFile={deleteRecordAttachment}
            downloadFile={downloadRecordAttachment}
          />
        </div>
        <div className={MODAL.footer}>
          <button className={BTN.secondary} onClick={() => setModal(null)}>Cancel</button>
          <button className={BTN.primary} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : modal?.mode === 'add' ? 'Add Rule' : 'Save Changes'}
          </button>
        </div>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Remove Rule" size="sm">
        <p className="text-sm text-gray-600">
          Remove <strong>{deleteConfirm?.name}</strong>? This deactivates the rule — it remains visible in historical payroll records but will no longer apply to new calculations.
        </p>
        <div className={MODAL.footer}>
          <button className={BTN.secondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
          <button className={BTN.danger} onClick={() => deleteConfirm && handleDelete(deleteConfirm.id)} disabled={saving}>
            {saving ? 'Removing…' : 'Remove Rule'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
