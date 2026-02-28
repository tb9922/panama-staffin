import { useState, useMemo, useEffect, useCallback } from 'react';
import { CARD, BTN, BADGE, INPUT, MODAL, PAGE, TABLE } from '../lib/design.js';
import { formatDate, addDays, parseDate } from '../lib/rotation.js';
import { downloadXLSX } from '../lib/excel.js';
import Modal from '../components/Modal.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import {
  getMaintenanceStats,
  getMaintenanceStatus, MAINTENANCE_STATUSES, FREQUENCY_OPTIONS, DEFAULT_MAINTENANCE_CATEGORIES,
} from '../lib/maintenance.js';
import {
  getCurrentHome, getLoggedInUser, getMaintenance, createMaintenanceCheck, updateMaintenanceCheck, deleteMaintenanceCheck,
} from '../lib/api.js';

const EMPTY_FORM = {
  category: '', category_name: '', description: '', frequency: 'annual',
  last_completed: '', next_due: '', completed_by: '', contractor: '',
  items_checked: '', items_passed: '', items_failed: '',
  certificate_ref: '', certificate_expiry: '', notes: '',
};

export default function MaintenanceTracker() {
  const isAdmin = getLoggedInUser()?.role === 'admin';
  const [checks, setChecks] = useState([]);
  const [maintenanceCategories, setMaintenanceCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  useDirtyGuard(showModal);

  const home = getCurrentHome();

  const load = useCallback(async () => {
    try {
      setError(null);
      const result = await getMaintenance(home);
      setChecks(result.checks || []);
      setMaintenanceCategories(result.maintenanceCategories || DEFAULT_MAINTENANCE_CATEGORIES);
    } catch (err) {
      setError(err.message || 'Failed to load maintenance checks');
    } finally {
      setLoading(false);
    }
  }, [home]);

  useEffect(() => { load(); }, [load]);

  const today = useMemo(() => formatDate(new Date()), []);

  const stats = useMemo(() =>
    getMaintenanceStats(checks, today),
    [checks, today]);

  const items = useMemo(() => {
    let list = [...checks];
    // Add status to each
    list = list.map(m => ({ ...m, _status: getMaintenanceStatus(m, today) }));
    // Sort: overdue first, then due_soon, then compliant
    const order = { overdue: 0, due_soon: 1, not_started: 2, compliant: 3 };
    list.sort((a, b) => (order[a._status.status] ?? 9) - (order[b._status.status] ?? 9));

    if (filterCategory) list = list.filter(m => m.category === filterCategory);
    if (filterStatus) list = list.filter(m => m._status.status === filterStatus);
    return list;
  }, [checks, filterCategory, filterStatus, today]);

  function openAdd() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  }

  function openEdit(item) {
    setEditingId(item.id);
    setForm({ ...EMPTY_FORM, ...item });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.category) return;
    const catDef = maintenanceCategories.find(c => c.id === form.category);
    const saveItem = {
      ...form,
      category_name: catDef?.name || form.category_name || form.category,
    };
    // Auto-calc next_due from last_completed + frequency
    if (saveItem.last_completed && saveItem.frequency) {
      const freqDays = FREQUENCY_OPTIONS.find(f => f.id === saveItem.frequency)?.days || 365;
      saveItem.next_due = formatDate(addDays(parseDate(saveItem.last_completed), freqDays));
    }

    try {
      if (editingId) {
        await updateMaintenanceCheck(home, editingId, saveItem);
      } else {
        await createMaintenanceCheck(home, saveItem);
      }
      setShowModal(false);
      await load();
    } catch (err) {
      alert(err.message || 'Failed to save maintenance check');
    }
  }

  async function handleDelete() {
    if (!editingId || !confirm('Delete this maintenance record?')) return;
    try {
      await deleteMaintenanceCheck(home, editingId);
      setShowModal(false);
      await load();
    } catch (err) {
      alert(err.message || 'Failed to delete maintenance check');
    }
  }

  function handleExport() {
    const rows = items.map(m => [
      m.category_name || m.category,
      m.description || '',
      FREQUENCY_OPTIONS.find(f => f.id === m.frequency)?.name || m.frequency,
      m.last_completed || '',
      m._status.nextDue || m.next_due || '',
      m._status.status,
      m.completed_by || '',
      m.contractor || '',
      m.certificate_ref || '',
      m.items_checked || '',
      m.items_passed || '',
      m.items_failed || '',
    ]);
    downloadXLSX(`Maintenance_${today}`, [{
      name: 'Maintenance',
      headers: ['Category', 'Description', 'Frequency', 'Last Completed', 'Next Due',
        'Status', 'Completed By', 'Contractor', 'Certificate Ref',
        'Items Checked', 'Items Passed', 'Items Failed'],
      rows,
    }]);
  }

  const statusBadge = (status) => {
    const s = MAINTENANCE_STATUSES.find(st => st.id === status);
    return s ? <span className={BADGE[s.badgeKey]}>{s.name}</span> : status;
  };

  if (loading) {
    return (
      <div className={PAGE.container}>
        <div className="text-center py-12 text-gray-400">Loading maintenance checks...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={PAGE.container}>
        <div className="text-center py-12 text-red-500">{error}</div>
        <div className="text-center">
          <button onClick={load} className={BTN.primary}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <h1 className={PAGE.title}>Maintenance & Environment</h1>
        <div className="flex gap-2">
          <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
          {isAdmin && <button onClick={openAdd} className={`${BTN.primary} ${BTN.sm}`}>Add Check</button>}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className={CARD.padded}>
          <div className="text-xs text-gray-500 mb-1">Compliant</div>
          <div className="text-2xl font-bold text-emerald-600">{stats.compliant}</div>
          <div className="text-xs text-gray-400">of {stats.total} checks</div>
        </div>
        <div className={CARD.padded}>
          <div className="text-xs text-gray-500 mb-1">Overdue</div>
          <div className={`text-2xl font-bold ${stats.overdue > 0 ? 'text-red-600' : 'text-gray-900'}`}>{stats.overdue}</div>
          <div className="text-xs text-gray-400">require attention</div>
        </div>
        <div className={CARD.padded}>
          <div className="text-xs text-gray-500 mb-1">Due Soon</div>
          <div className={`text-2xl font-bold ${stats.dueSoon > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{stats.dueSoon}</div>
          <div className="text-xs text-gray-400">within 30 days</div>
        </div>
        <div className={CARD.padded}>
          <div className="text-xs text-gray-500 mb-1">Compliance</div>
          <div className={`text-2xl font-bold ${stats.compliancePct >= 90 ? 'text-emerald-600' : stats.compliancePct >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
            {stats.compliancePct}%
          </div>
          <div className="text-xs text-gray-400">compliant + due soon</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className={`${INPUT.select} ${INPUT.sm}`}>
          <option value="">All Categories</option>
          {maintenanceCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={`${INPUT.select} ${INPUT.sm}`}>
          <option value="">All Statuses</option>
          {MAINTENANCE_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className={CARD.flush}>
        <div className="overflow-x-auto">
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th className={TABLE.th}>Category</th>
                <th className={TABLE.th}>Frequency</th>
                <th className={TABLE.th}>Last Completed</th>
                <th className={TABLE.th}>Next Due</th>
                <th className={TABLE.th}>Status</th>
                <th className={TABLE.th}>Certificate</th>
                <th className={TABLE.th}></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan="7" className={`${TABLE.td} text-center text-gray-400`}>No maintenance checks recorded</td></tr>
              )}
              {items.map(m => (
                <tr key={m.id} className={TABLE.tr}>
                  <td className={TABLE.td}>
                    <div className="text-sm font-medium">{m.category_name || m.category}</div>
                    {m.description && <div className="text-xs text-gray-400 max-w-xs truncate">{m.description}</div>}
                  </td>
                  <td className={TABLE.td}>{FREQUENCY_OPTIONS.find(f => f.id === m.frequency)?.name || m.frequency}</td>
                  <td className={TABLE.tdMono}>{m.last_completed || '--'}</td>
                  <td className={TABLE.tdMono}>{m._status.nextDue || m.next_due || '--'}</td>
                  <td className={TABLE.td}>
                    {statusBadge(m._status.status)}
                    {m._status.isOverdue && <div className="text-xs text-red-500 mt-0.5">{m._status.daysOverdue}d overdue</div>}
                  </td>
                  <td className={TABLE.td}>{m.certificate_ref || '--'}</td>
                  <td className={TABLE.td}>
                    {isAdmin && <button onClick={() => openEdit(m)} className={`${BTN.ghost} ${BTN.xs}`}>Edit</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingId ? 'Edit Maintenance Check' : 'Add Maintenance Check'} size="lg">

            <div className="max-h-[60vh] overflow-y-auto space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Category</label>
                  <select value={form.category} onChange={e => {
                    const cat = maintenanceCategories.find(c => c.id === e.target.value);
                    setForm({ ...form, category: e.target.value, category_name: cat?.name || '', frequency: cat?.frequency || form.frequency });
                  }} className={INPUT.select}>
                    <option value="">Select...</option>
                    {maintenanceCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={INPUT.label}>Frequency</label>
                  <select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })}
                    className={INPUT.select}>
                    {FREQUENCY_OPTIONS.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className={INPUT.label}>Description</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                  className={INPUT.base} placeholder="e.g. Annual PAT test for all portable appliances" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Last Completed</label>
                  <input type="date" value={form.last_completed}
                    onChange={e => setForm({ ...form, last_completed: e.target.value })} className={INPUT.base} />
                </div>
                <div>
                  <label className={INPUT.label}>Next Due (auto-calculated)</label>
                  <input type="date" value={form.next_due}
                    onChange={e => setForm({ ...form, next_due: e.target.value })} className={INPUT.base} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Completed By</label>
                  <input value={form.completed_by} onChange={e => setForm({ ...form, completed_by: e.target.value })}
                    className={INPUT.base} placeholder="Engineer / staff name" />
                </div>
                <div>
                  <label className={INPUT.label}>Contractor</label>
                  <input value={form.contractor} onChange={e => setForm({ ...form, contractor: e.target.value })}
                    className={INPUT.base} placeholder="Company name" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={INPUT.label}>Items Checked</label>
                  <input type="number" value={form.items_checked}
                    onChange={e => setForm({ ...form, items_checked: parseInt(e.target.value) || '' })} className={INPUT.base} />
                </div>
                <div>
                  <label className={INPUT.label}>Items Passed</label>
                  <input type="number" value={form.items_passed}
                    onChange={e => setForm({ ...form, items_passed: parseInt(e.target.value) || '' })} className={INPUT.base} />
                </div>
                <div>
                  <label className={INPUT.label}>Items Failed</label>
                  <input type="number" value={form.items_failed}
                    onChange={e => setForm({ ...form, items_failed: parseInt(e.target.value) || '' })} className={INPUT.base} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Certificate Ref</label>
                  <input value={form.certificate_ref} onChange={e => setForm({ ...form, certificate_ref: e.target.value })}
                    className={INPUT.base} placeholder="e.g. PAT-2026-001" />
                </div>
                <div>
                  <label className={INPUT.label}>Certificate Expiry</label>
                  <input type="date" value={form.certificate_expiry}
                    onChange={e => setForm({ ...form, certificate_expiry: e.target.value })} className={INPUT.base} />
                </div>
              </div>

              <div>
                <label className={INPUT.label}>Notes</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                  className={INPUT.base} rows={2} />
              </div>

              {/* Regulation info */}
              {form.category && (() => {
                const cat = maintenanceCategories.find(c => c.id === form.category);
                return cat?.regulation ? (
                  <div className="text-xs text-gray-400 bg-gray-50 p-2 rounded">
                    Regulation: {cat.regulation}
                  </div>
                ) : null;
              })()}
            </div>

            <div className={MODAL.footer}>
              {isAdmin && editingId && <button onClick={handleDelete} className={BTN.danger}>Delete</button>}
              <div className="flex-1" />
              <button onClick={() => setShowModal(false)} className={BTN.secondary}>Cancel</button>
              {isAdmin && <button onClick={handleSave} className={BTN.primary}>Save</button>}
            </div>
      </Modal>
    </div>
  );
}
