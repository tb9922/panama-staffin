import { useState, useMemo, useEffect, useCallback } from 'react';
import { CARD, BTN, BADGE, INPUT, MODAL, PAGE, TABLE } from '../lib/design.js';
import { formatDate, parseDate } from '../lib/rotation.js';
import { useLiveDate } from '../hooks/useLiveDate.js';
import { downloadXLSX } from '../lib/excel.js';
import Modal from '../components/Modal.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import {
  getCurrentHome, getLoggedInUser, getPolicies, createPolicy, updatePolicy, deletePolicy,
} from '../lib/api.js';
import {
  getPolicyStatus, getPolicyStats,
  POLICY_STATUSES,
} from '../lib/policyReview.js';

const STATUS_ORDER = { overdue: 0, due: 1, current: 2 };

const EMPTY_FORM = {
  policy_name: '',
  policy_ref: '',
  category: '',
  version: '1.0',
  last_reviewed: '',
  next_review_due: '',
  review_frequency_months: 12,
  reviewed_by: '',
  approved_by: '',
  changes: [],
  notes: '',
};

export default function PolicyReviewTracker() {
  const isAdmin = getLoggedInUser()?.role === 'admin';
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [filterStatus, setFilterStatus] = useState('');

  useDirtyGuard(showModal);

  const home = getCurrentHome();

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const result = await getPolicies(home);
      setPolicies(Array.isArray(result.policies) ? result.policies : []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [home]);

  useEffect(() => { load(); }, [load]);

  const today = useLiveDate();

  const stats = useMemo(() => getPolicyStats(policies, today), [policies, today]);

  const filtered = useMemo(() => {
    let list = [...policies];

    // Sort: overdue first, then due, then current
    list.sort((a, b) => {
      const sa = getPolicyStatus(a, today);
      const sb = getPolicyStatus(b, today);
      return (STATUS_ORDER[sa.status] ?? 3) - (STATUS_ORDER[sb.status] ?? 3);
    });

    if (filterStatus) {
      list = list.filter(p => getPolicyStatus(p, today).status === filterStatus);
    }

    return list;
  }, [policies, filterStatus, today]);

  function calculateNextReviewDue(lastReviewed, frequencyMonths) {
    if (!lastReviewed) return '';
    const d = parseDate(lastReviewed);
    const targetMonth = d.getUTCMonth() + (frequencyMonths || 12);
    const origDay = d.getUTCDate();
    d.setUTCMonth(targetMonth);
    // Clamp overflow: e.g. Jan 31 + 1 month → Mar 3, roll back to Feb 28
    if (d.getUTCDate() !== origDay) d.setUTCDate(0);
    return formatDate(d);
  }

  function openAdd() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  }

  function openEdit(policy) {
    setEditingId(policy.id);
    setForm({
      policy_name: policy.policy_name || '',
      policy_ref: policy.policy_ref || '',
      category: policy.category || '',
      version: policy.version || '1.0',
      last_reviewed: policy.last_reviewed || '',
      next_review_due: policy.next_review_due || '',
      review_frequency_months: policy.review_frequency_months || 12,
      reviewed_by: policy.reviewed_by || '',
      approved_by: policy.approved_by || '',
      changes: policy.changes || [],
      notes: policy.notes || '',
    });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.policy_name) return;

    // Auto-calculate next_review_due from last_reviewed + frequency
    const nextDue = form.last_reviewed
      ? calculateNextReviewDue(form.last_reviewed, form.review_frequency_months)
      : form.next_review_due;

    const record = {
      ...form,
      next_review_due: nextDue,
    };

    try {
      if (editingId) {
        await updatePolicy(home, editingId, record);
      } else {
        await createPolicy(home, {
          ...record,
          status: form.last_reviewed ? 'current' : 'not_reviewed',
        });
      }
      setShowModal(false);
      await load();
    } catch (e) {
      alert(e.message || 'Failed to save');
    }
  }

  async function handleMarkReviewed() {
    if (!editingId) return;
    const policy = policies.find(p => p.id === editingId);
    if (!policy) return;

    const oldVersion = policy.version || '1.0';

    // Bump version: "1.0" -> "1.1", "2.3" -> "2.4"
    const parts = oldVersion.split('.');
    const minor = parseInt(parts[1] || '0', 10) + 1;
    const newVersion = parts[0] + '.' + minor;

    const newChange = {
      version: newVersion,
      date: today,
      summary: 'Reviewed and approved',
    };

    const nextDue = calculateNextReviewDue(today, form.review_frequency_months);

    const record = {
      ...form,
      last_reviewed: today,
      next_review_due: nextDue,
      version: newVersion,
      changes: [...(policy.changes || []), newChange],
    };

    try {
      await updatePolicy(home, editingId, record);
      setShowModal(false);
      await load();
    } catch (e) {
      alert(e.message || 'Failed to save');
    }
  }

  async function handleDelete() {
    if (!editingId || !confirm('Delete this policy record?')) return;
    try {
      await deletePolicy(home, editingId);
      setShowModal(false);
      await load();
    } catch (e) {
      alert(e.message || 'Failed to delete');
    }
  }

  function handleExport() {
    const rows = filtered.map(p => {
      const s = getPolicyStatus(p, today);
      return [
        p.policy_name,
        p.policy_ref,
        p.category,
        p.version,
        p.last_reviewed || 'Never',
        p.next_review_due || '-',
        s.status.charAt(0).toUpperCase() + s.status.slice(1),
        p.reviewed_by,
        p.approved_by,
        p.notes,
      ];
    });
    downloadXLSX(`Policy_Reviews_${today}`, [{
      name: 'Policy Reviews',
      headers: ['Policy Name', 'Reference', 'Category', 'Version', 'Last Reviewed',
        'Next Due', 'Status', 'Reviewed By', 'Approved By', 'Notes'],
      rows,
    }]);
  }

  // Auto-update next_review_due when last_reviewed or frequency changes
  function updateFormField(field, value) {
    const updated = { ...form, [field]: value };
    if (field === 'last_reviewed' || field === 'review_frequency_months') {
      const reviewed = field === 'last_reviewed' ? value : form.last_reviewed;
      const freq = field === 'review_frequency_months' ? value : form.review_frequency_months;
      if (reviewed) {
        updated.next_review_due = calculateNextReviewDue(reviewed, freq);
      }
    }
    setForm(updated);
  }

  const statusBadge = (status) => {
    const def = POLICY_STATUSES.find(s => s.id === status);
    return def ? BADGE[def.badgeKey] : BADGE.gray;
  };

  const statusLabel = (status) => {
    const def = POLICY_STATUSES.find(s => s.id === status);
    return def ? def.name : 'Not Reviewed';
  };

  if (loading) {
    return (
      <div className={PAGE.container}>
        <div className="text-sm text-gray-500 py-12 text-center">Loading policy reviews...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={PAGE.container}>
        <div className="text-sm text-red-600 py-12 text-center">{error}</div>
      </div>
    );
  }

  return (
    <div className={PAGE.container}>
      {/* Header */}
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Policy Review Tracker</h1>
          <p className={PAGE.subtitle}>CQC Regulation 17 — Governance & Management</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
          {isAdmin && <button onClick={openAdd} className={BTN.primary}>+ New Policy</button>}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className={CARD.padded}>
          <div className="text-xs font-medium text-gray-500">Current</div>
          <div className="text-2xl font-bold text-emerald-700 mt-0.5">{stats.current}</div>
          <div className="text-[10px] text-gray-400">Up to date</div>
        </div>
        <div className={`${CARD.padded} ${stats.due > 0 ? 'border-amber-200 bg-amber-50' : ''}`}>
          <div className={`text-xs font-medium ${stats.due > 0 ? 'text-amber-600' : 'text-gray-500'}`}>Due for Review</div>
          <div className={`text-2xl font-bold ${stats.due > 0 ? 'text-amber-700' : 'text-gray-900'} mt-0.5`}>{stats.due}</div>
          <div className="text-[10px] text-gray-400">Within 30 days</div>
        </div>
        <div className={`${CARD.padded} ${stats.overdue > 0 ? 'border-red-200 bg-red-50' : ''}`}>
          <div className={`text-xs font-medium ${stats.overdue > 0 ? 'text-red-600' : 'text-gray-500'}`}>Overdue</div>
          <div className={`text-2xl font-bold ${stats.overdue > 0 ? 'text-red-700' : 'text-gray-900'} mt-0.5`}>{stats.overdue}</div>
          <div className="text-[10px] text-gray-400">Past review date</div>
        </div>
        <div className={CARD.padded}>
          <div className="text-xs font-medium text-gray-500">Compliance %</div>
          <div className={`text-2xl font-bold mt-0.5 ${stats.compliancePct >= 90 ? 'text-emerald-700' : stats.compliancePct >= 70 ? 'text-amber-700' : 'text-red-700'}`}>
            {stats.compliancePct}%
          </div>
          <div className="text-[10px] text-gray-400">Current + Due</div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-2 mb-4 print:hidden">
        <select className={`${INPUT.select} w-auto`} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {POLICY_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="text-xs text-gray-400 self-center">{filtered.length} policies</span>
      </div>

      {/* Policy Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Policy Name</th>
                <th scope="col" className={TABLE.th}>Ref</th>
                <th scope="col" className={TABLE.th}>Version</th>
                <th scope="col" className={TABLE.th}>Last Reviewed</th>
                <th scope="col" className={TABLE.th}>Next Due</th>
                <th scope="col" className={TABLE.th}>Status</th>
                <th scope="col" className={TABLE.th}>Reviewed By</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} className={TABLE.empty}>No policies recorded</td></tr>
              )}
              {filtered.map(policy => {
                const s = getPolicyStatus(policy, today);
                return (
                  <tr key={policy.id} className={`${TABLE.tr} ${isAdmin ? 'cursor-pointer' : ''}`} onClick={() => isAdmin && openEdit(policy)}>
                    <td className={TABLE.td}>{policy.policy_name}</td>
                    <td className={TABLE.td}>{policy.policy_ref || '-'}</td>
                    <td className={TABLE.td}>{policy.version}</td>
                    <td className={TABLE.td}>{policy.last_reviewed || 'Never'}</td>
                    <td className={TABLE.td}>{policy.next_review_due || '-'}</td>
                    <td className={TABLE.td}>
                      <span className={statusBadge(s.status)}>{statusLabel(s.status)}</span>
                    </td>
                    <td className={TABLE.td}>{policy.reviewed_by || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingId ? 'Edit Policy' : 'New Policy'} size="lg">

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Policy Name *</label>
                  <input type="text" className={INPUT.base} value={form.policy_name}
                    onChange={e => setForm({ ...form, policy_name: e.target.value })} />
                </div>
                <div>
                  <label className={INPUT.label}>Reference</label>
                  <input type="text" className={INPUT.base} placeholder="e.g. POL-001" value={form.policy_ref}
                    onChange={e => setForm({ ...form, policy_ref: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={INPUT.label}>Category</label>
                  <select className={INPUT.select} value={form.category}
                    onChange={e => setForm({ ...form, category: e.target.value })}>
                    <option value="">Select...</option>
                    <option value="safeguarding">Safeguarding</option>
                    <option value="governance">Governance</option>
                    <option value="health-safety">Health & Safety</option>
                    <option value="clinical">Clinical</option>
                    <option value="operational">Operational</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className={INPUT.label}>Version</label>
                  <input type="text" className={INPUT.base} value={form.version}
                    onChange={e => setForm({ ...form, version: e.target.value })} />
                </div>
                <div>
                  <label className={INPUT.label}>Review Frequency (months)</label>
                  <input type="number" className={INPUT.base} min="1" max="60" value={form.review_frequency_months}
                    onChange={e => updateFormField('review_frequency_months', parseInt(e.target.value) || 12)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Last Reviewed</label>
                  <input type="date" className={INPUT.base} value={form.last_reviewed}
                    onChange={e => updateFormField('last_reviewed', e.target.value)} />
                </div>
                <div>
                  <label className={INPUT.label}>Next Review Due</label>
                  <input type="date" className={`${INPUT.base} bg-gray-50`} value={form.next_review_due} readOnly />
                  <p className="text-[10px] text-gray-400 mt-0.5">Auto-calculated from last reviewed + frequency</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Reviewed By</label>
                  <input type="text" className={INPUT.base} placeholder="Name" value={form.reviewed_by}
                    onChange={e => setForm({ ...form, reviewed_by: e.target.value })} />
                </div>
                <div>
                  <label className={INPUT.label}>Approved By</label>
                  <input type="text" className={INPUT.base} placeholder="Name" value={form.approved_by}
                    onChange={e => setForm({ ...form, approved_by: e.target.value })} />
                </div>
              </div>

              <div>
                <label className={INPUT.label}>Notes</label>
                <textarea className={`${INPUT.base} h-16`} value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>

              {/* Version History (read-only) */}
              {form.changes.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Version History</div>
                  <div className="border border-gray-200 rounded-lg max-h-36 overflow-y-auto">
                    {[...form.changes].reverse().map((c, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-1.5 text-xs border-b border-gray-50 last:border-0">
                        <span className={BADGE.blue}>{c.version}</span>
                        <span className="text-gray-500">{c.date}</span>
                        <span className="text-gray-700 flex-1">{c.summary}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className={MODAL.footer}>
              {isAdmin && editingId && (
                <button onClick={handleDelete} className={`${BTN.danger} ${BTN.sm} mr-auto`}>Delete</button>
              )}
              {isAdmin && editingId && (
                <button onClick={handleMarkReviewed} className={BTN.success}>Mark as Reviewed</button>
              )}
              <button onClick={() => setShowModal(false)} className={BTN.ghost}>Cancel</button>
              {isAdmin && (
                <button onClick={handleSave} disabled={!form.policy_name} className={BTN.primary}>
                  {editingId ? 'Update' : 'Save'}
                </button>
              )}
            </div>
      </Modal>
    </div>
  );
}
