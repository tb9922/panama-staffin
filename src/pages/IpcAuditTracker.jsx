import { useState, useMemo, useEffect, useCallback } from 'react';
import { CARD, BTN, BADGE, INPUT, MODAL, PAGE, TABLE } from '../lib/design.js';
import { formatDate } from '../lib/rotation.js';
import { downloadXLSX } from '../lib/excel.js';
import {
  getIpcStats,
  DEFAULT_IPC_AUDIT_TYPES, OUTBREAK_STATUSES,
} from '../lib/ipc.js';
import {
  getCurrentHome, getIpcAudits, createIpcAudit, updateIpcAudit, deleteIpcAudit, getLoggedInUser,
} from '../lib/api.js';
import useDirtyGuard from '../hooks/useDirtyGuard';

const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'outbreak', label: 'Outbreak' },
];

const EMPTY_FORM = {
  audit_date: '', audit_type: '', auditor: '',
  overall_score: '', compliance_pct: '',
  risk_areas: [],
  corrective_actions: [],
  outbreak: {
    suspected: false, type: '', start_date: '', end_date: '',
    affected_staff: 0, affected_residents: 0, measures: '', status: '',
  },
  notes: '',
};

export default function IpcAuditTracker() {
  const isAdmin = getLoggedInUser()?.role === 'admin';
  const [audits, setAudits] = useState([]);
  const [auditTypes, setAuditTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  useDirtyGuard(showModal);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [activeTab, setActiveTab] = useState('details');
  const [filterType, setFilterType] = useState('');

  const home = getCurrentHome();

  const load = useCallback(async () => {
    try {
      setError(null);
      const result = await getIpcAudits(home);
      setAudits(result.audits || []);
      setAuditTypes((result.auditTypes || DEFAULT_IPC_AUDIT_TYPES).filter(t => t.active));
    } catch (err) {
      setError(err.message || 'Failed to load IPC audits');
    } finally {
      setLoading(false);
    }
  }, [home]);

  useEffect(() => { load(); }, [load]);

  const today = useMemo(() => formatDate(new Date()), []);

  const stats = useMemo(() => getIpcStats(audits, today), [audits, today]);

  const filtered = useMemo(() => {
    let list = [...audits].sort((a, b) => (b.audit_date || '').localeCompare(a.audit_date || ''));
    if (filterType) list = list.filter(a => a.audit_type === filterType);
    return list;
  }, [audits, filterType]);

  function openAdd() {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      audit_date: today,
      risk_areas: [],
      corrective_actions: [],
      outbreak: { ...EMPTY_FORM.outbreak },
    });
    setActiveTab('details');
    setShowModal(true);
  }

  function openEdit(audit) {
    setEditingId(audit.id);
    setForm({
      audit_date: audit.audit_date || '',
      audit_type: audit.audit_type || '',
      auditor: audit.auditor || '',
      overall_score: audit.overall_score ?? '',
      compliance_pct: audit.compliance_pct ?? '',
      risk_areas: audit.risk_areas || [],
      corrective_actions: audit.corrective_actions || [],
      outbreak: audit.outbreak ? { ...EMPTY_FORM.outbreak, ...audit.outbreak } : { ...EMPTY_FORM.outbreak },
      notes: audit.notes || '',
    });
    setActiveTab('details');
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.audit_date || !form.audit_type) return;

    const record = {
      ...form,
      overall_score: form.overall_score !== '' ? Number(form.overall_score) : null,
      compliance_pct: form.compliance_pct !== '' ? Number(form.compliance_pct) : null,
      outbreak: form.outbreak.suspected ? form.outbreak : null,
    };

    try {
      if (editingId) {
        await updateIpcAudit(home, editingId, record);
      } else {
        await createIpcAudit(home, record);
      }
      setShowModal(false);
      await load();
    } catch (err) {
      alert(err.message || 'Failed to save IPC audit');
    }
  }

  async function handleDelete() {
    if (!editingId || !confirm('Delete this IPC audit record?')) return;
    try {
      await deleteIpcAudit(home, editingId);
      setShowModal(false);
      await load();
    } catch (err) {
      alert(err.message || 'Failed to delete IPC audit');
    }
  }

  function handleExport() {
    const rows = filtered.map(audit => {
      const typeDef = auditTypes.find(t => t.id === audit.audit_type);
      const riskCount = (audit.risk_areas || []).length;
      const actionsDone = (audit.corrective_actions || []).filter(a => a.status === 'completed').length;
      const actionsTotal = (audit.corrective_actions || []).length;
      const hasOutbreak = audit.outbreak && (audit.outbreak.status === 'suspected' || audit.outbreak.status === 'confirmed');
      return [
        audit.audit_date,
        typeDef?.name || audit.audit_type,
        audit.auditor || '',
        audit.overall_score ?? '-',
        audit.compliance_pct != null ? `${audit.compliance_pct}%` : '-',
        riskCount,
        actionsTotal > 0 ? `${actionsDone}/${actionsTotal}` : '-',
        hasOutbreak ? 'Yes' : 'No',
        audit.outbreak?.type || '',
        audit.notes || '',
      ];
    });
    downloadXLSX(`IPC_Audit_Register_${today}`, [{
      name: 'IPC Audits',
      headers: ['Date', 'Type', 'Auditor', 'Score', 'Compliance', 'Risk Areas',
        'Actions', 'Active Outbreak', 'Outbreak Type', 'Notes'],
      rows,
    }]);
  }

  const statusBadge = (score) => {
    if (score == null) return BADGE.gray;
    if (score >= 90) return BADGE.green;
    if (score >= 70) return BADGE.amber;
    return BADGE.red;
  };

  const outbreakBadge = (status) => {
    const def = OUTBREAK_STATUSES.find(s => s.id === status);
    return def ? BADGE[def.badgeKey] : BADGE.gray;
  };

  if (loading) {
    return (
      <div className={PAGE.container}>
        <div className="text-center py-12 text-gray-400">Loading IPC audits...</div>
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
      {/* Header */}
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>IPC Audit Tracker</h1>
          <p className={PAGE.subtitle}>CQC Regulation 12 — Infection Prevention & Control</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
          {isAdmin && <button onClick={openAdd} className={BTN.primary}>+ New Audit</button>}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className={`${CARD.padded} ${stats.avgScore < 80 ? 'border-red-200 bg-red-50' : ''}`}>
          <div className={`text-xs font-medium ${stats.avgScore < 80 ? 'text-red-600' : 'text-gray-500'}`}>Avg Score</div>
          <div className={`text-2xl font-bold ${stats.avgScore < 80 ? 'text-red-700' : 'text-gray-900'} mt-0.5`}>{stats.avgScore}%</div>
          <div className="text-[10px] text-gray-400">All audits</div>
        </div>
        <div className={CARD.padded}>
          <div className="text-xs font-medium text-gray-500">Audits This Quarter</div>
          <div className="text-2xl font-bold text-gray-900 mt-0.5">{stats.auditsThisQuarter}</div>
          <div className="text-[10px] text-gray-400">Last 91 days</div>
        </div>
        <div className={`${CARD.padded} ${stats.activeOutbreaks > 0 ? 'border-red-200 bg-red-50' : ''}`}>
          <div className={`text-xs font-medium ${stats.activeOutbreaks > 0 ? 'text-red-600' : 'text-gray-500'}`}>Active Outbreaks</div>
          <div className={`text-2xl font-bold ${stats.activeOutbreaks > 0 ? 'text-red-700' : 'text-gray-900'} mt-0.5`}>{stats.activeOutbreaks}</div>
          <div className="text-[10px] text-gray-400">Suspected / Confirmed</div>
        </div>
        <div className={CARD.padded}>
          <div className="text-xs font-medium text-gray-500">Action Completion</div>
          <div className="text-2xl font-bold text-gray-900 mt-0.5">{stats.actionCompletion}%</div>
          <div className="text-[10px] text-gray-400">Corrective actions</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 print:hidden">
        <select className={`${INPUT.select} w-auto`} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {auditTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span className="text-xs text-gray-400 self-center">{filtered.length} audits</span>
      </div>

      {/* Audit Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th className={TABLE.th}>Date</th>
                <th className={TABLE.th}>Type</th>
                <th className={TABLE.th}>Auditor</th>
                <th className={TABLE.th}>Score</th>
                <th className={TABLE.th}>Risk Areas</th>
                <th className={TABLE.th}>Actions</th>
                <th className={TABLE.th}>Outbreak</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} className={TABLE.empty}>No IPC audits recorded</td></tr>
              )}
              {filtered.map(audit => {
                const typeDef = auditTypes.find(t => t.id === audit.audit_type);
                const riskCount = (audit.risk_areas || []).length;
                const actionsDone = (audit.corrective_actions || []).filter(a => a.status === 'completed').length;
                const actionsTotal = (audit.corrective_actions || []).length;
                const hasOutbreak = audit.outbreak && (audit.outbreak.status === 'suspected' || audit.outbreak.status === 'confirmed');
                return (
                  <tr key={audit.id} className={`${TABLE.tr} ${isAdmin ? 'cursor-pointer' : ''}`} onClick={() => isAdmin && openEdit(audit)}>
                    <td className={TABLE.td}>{audit.audit_date}</td>
                    <td className={TABLE.td}>{typeDef?.name || audit.audit_type}</td>
                    <td className={TABLE.td}>{audit.auditor || '-'}</td>
                    <td className={TABLE.td}>
                      <span className={statusBadge(audit.overall_score)}>
                        {audit.overall_score != null ? `${audit.overall_score}%` : '-'}
                      </span>
                    </td>
                    <td className={TABLE.td}>{riskCount > 0 ? riskCount : '-'}</td>
                    <td className={TABLE.td}>
                      {actionsTotal > 0 ? (
                        <span className={actionsDone === actionsTotal ? BADGE.green : BADGE.amber}>
                          {actionsDone}/{actionsTotal}
                        </span>
                      ) : '-'}
                    </td>
                    <td className={TABLE.td}>
                      {hasOutbreak ? (
                        <span className={outbreakBadge(audit.outbreak.status)}>
                          {OUTBREAK_STATUSES.find(s => s.id === audit.outbreak.status)?.name || audit.outbreak.status}
                        </span>
                      ) : <span className="text-gray-300">-</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className={MODAL.overlay} onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className={`${MODAL.panelLg} max-h-[90vh] overflow-y-auto`}>
            <h2 className={MODAL.title}>{editingId ? 'Edit IPC Audit' : 'New IPC Audit'}</h2>

            {/* Tabs */}
            <div className="flex gap-1 mb-4 border-b border-gray-100 pb-2">
              {TABS.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`${activeTab === tab.id ? BTN.primary : BTN.ghost} ${BTN.xs}`}>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Details Tab */}
            {activeTab === 'details' && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={INPUT.label}>Audit Type *</label>
                    <select className={INPUT.select} value={form.audit_type} onChange={e => setForm({ ...form, audit_type: e.target.value })}>
                      <option value="">Select...</option>
                      {auditTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={INPUT.label}>Date *</label>
                    <input type="date" className={INPUT.base} value={form.audit_date} onChange={e => setForm({ ...form, audit_date: e.target.value })} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Auditor</label>
                    <input type="text" className={INPUT.base} placeholder="Name" value={form.auditor} onChange={e => setForm({ ...form, auditor: e.target.value })} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={INPUT.label}>Overall Score (0-100)</label>
                    <input type="number" min="0" max="100" className={INPUT.base} value={form.overall_score}
                      onChange={e => setForm({ ...form, overall_score: e.target.value })} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Compliance % (0-100)</label>
                    <input type="number" min="0" max="100" className={INPUT.base} value={form.compliance_pct}
                      onChange={e => setForm({ ...form, compliance_pct: e.target.value })} />
                  </div>
                </div>

                {/* Risk Areas */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={INPUT.label}>Risk Areas</label>
                    <button type="button" className={`${BTN.ghost} ${BTN.xs}`}
                      onClick={() => setForm({ ...form, risk_areas: [...form.risk_areas, { area: '', severity: 'low', details: '' }] })}>
                      + Add Risk Area
                    </button>
                  </div>
                  {form.risk_areas.length === 0 && <p className="text-xs text-gray-400">No risk areas identified</p>}
                  {form.risk_areas.map((risk, i) => (
                    <div key={i} className="border border-gray-200 rounded-lg p-2 mb-2 space-y-1.5">
                      <div className="flex gap-2">
                        <input type="text" className={`${INPUT.sm} flex-1`} placeholder="Area" value={risk.area}
                          onChange={e => { const r = [...form.risk_areas]; r[i] = { ...r[i], area: e.target.value }; setForm({ ...form, risk_areas: r }); }} />
                        <select className={`${INPUT.sm} w-28`} value={risk.severity}
                          onChange={e => { const r = [...form.risk_areas]; r[i] = { ...r[i], severity: e.target.value }; setForm({ ...form, risk_areas: r }); }}>
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>
                        <button type="button" className="text-red-400 hover:text-red-600 text-xs px-1"
                          onClick={() => setForm({ ...form, risk_areas: form.risk_areas.filter((_, j) => j !== i) })}>Remove</button>
                      </div>
                      <textarea className={`${INPUT.sm} h-12`} placeholder="Details..."
                        value={risk.details}
                        onChange={e => { const r = [...form.risk_areas]; r[i] = { ...r[i], details: e.target.value }; setForm({ ...form, risk_areas: r }); }} />
                    </div>
                  ))}
                </div>

                {/* Corrective Actions */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={INPUT.label}>Corrective Actions</label>
                    <button type="button" className={`${BTN.ghost} ${BTN.xs}`}
                      onClick={() => setForm({ ...form, corrective_actions: [...form.corrective_actions, { id: 'ca-' + Date.now(), description: '', assigned_to: '', due_date: '', completed_date: '', status: 'open' }] })}>
                      + Add Action
                    </button>
                  </div>
                  {form.corrective_actions.length === 0 && <p className="text-xs text-gray-400">No corrective actions recorded</p>}
                  {form.corrective_actions.map((action, i) => (
                    <div key={i} className="border border-gray-200 rounded-lg p-2 mb-2 space-y-1.5">
                      <div className="flex gap-2">
                        <input type="text" className={`${INPUT.sm} flex-1`} placeholder="Action description" value={action.description}
                          onChange={e => { const a = [...form.corrective_actions]; a[i] = { ...a[i], description: e.target.value }; setForm({ ...form, corrective_actions: a }); }} />
                        <button type="button" className="text-red-400 hover:text-red-600 text-xs px-1"
                          onClick={() => setForm({ ...form, corrective_actions: form.corrective_actions.filter((_, j) => j !== i) })}>Remove</button>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <input type="text" className={INPUT.sm} placeholder="Assigned to" value={action.assigned_to}
                          onChange={e => { const a = [...form.corrective_actions]; a[i] = { ...a[i], assigned_to: e.target.value }; setForm({ ...form, corrective_actions: a }); }} />
                        <input type="date" className={INPUT.sm} title="Due date" value={action.due_date}
                          onChange={e => { const a = [...form.corrective_actions]; a[i] = { ...a[i], due_date: e.target.value }; setForm({ ...form, corrective_actions: a }); }} />
                        <input type="date" className={INPUT.sm} title="Completed date" value={action.completed_date}
                          onChange={e => { const a = [...form.corrective_actions]; a[i] = { ...a[i], completed_date: e.target.value }; setForm({ ...form, corrective_actions: a }); }} />
                        <select className={INPUT.sm} value={action.status}
                          onChange={e => { const a = [...form.corrective_actions]; a[i] = { ...a[i], status: e.target.value }; setForm({ ...form, corrective_actions: a }); }}>
                          <option value="open">Open</option>
                          <option value="in_progress">In Progress</option>
                          <option value="completed">Completed</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>

                <div>
                  <label className={INPUT.label}>Notes</label>
                  <textarea className={`${INPUT.base} h-16`} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
            )}

            {/* Outbreak Tab */}
            {activeTab === 'outbreak' && (
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-2">
                  <input type="checkbox" checked={form.outbreak.suspected}
                    onChange={e => setForm({ ...form, outbreak: { ...form.outbreak, suspected: e.target.checked } })}
                    className="accent-blue-600" />
                  Outbreak suspected / confirmed
                </label>
                {form.outbreak.suspected && (
                  <div className="ml-6 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={INPUT.label}>Outbreak Type</label>
                        <input type="text" className={INPUT.base} placeholder="e.g. Norovirus, COVID-19"
                          value={form.outbreak.type}
                          onChange={e => setForm({ ...form, outbreak: { ...form.outbreak, type: e.target.value } })} />
                      </div>
                      <div>
                        <label className={INPUT.label}>Status</label>
                        <select className={INPUT.select} value={form.outbreak.status}
                          onChange={e => setForm({ ...form, outbreak: { ...form.outbreak, status: e.target.value } })}>
                          <option value="">Select...</option>
                          {OUTBREAK_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={INPUT.label}>Start Date</label>
                        <input type="date" className={INPUT.base} value={form.outbreak.start_date}
                          onChange={e => setForm({ ...form, outbreak: { ...form.outbreak, start_date: e.target.value } })} />
                      </div>
                      <div>
                        <label className={INPUT.label}>End Date</label>
                        <input type="date" className={INPUT.base} value={form.outbreak.end_date}
                          onChange={e => setForm({ ...form, outbreak: { ...form.outbreak, end_date: e.target.value } })} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={INPUT.label}>Affected Staff</label>
                        <input type="number" min="0" className={INPUT.base} value={form.outbreak.affected_staff}
                          onChange={e => setForm({ ...form, outbreak: { ...form.outbreak, affected_staff: Number(e.target.value) || 0 } })} />
                      </div>
                      <div>
                        <label className={INPUT.label}>Affected Residents</label>
                        <input type="number" min="0" className={INPUT.base} value={form.outbreak.affected_residents}
                          onChange={e => setForm({ ...form, outbreak: { ...form.outbreak, affected_residents: Number(e.target.value) || 0 } })} />
                      </div>
                    </div>
                    <div>
                      <label className={INPUT.label}>Control Measures</label>
                      <textarea className={`${INPUT.base} h-20`} placeholder="Measures taken to contain outbreak..."
                        value={form.outbreak.measures}
                        onChange={e => setForm({ ...form, outbreak: { ...form.outbreak, measures: e.target.value } })} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <div className={MODAL.footer}>
              {editingId && isAdmin && (
                <button onClick={handleDelete} className={`${BTN.danger} ${BTN.sm} mr-auto`}>Delete</button>
              )}
              <button onClick={() => setShowModal(false)} className={BTN.ghost}>Cancel</button>
              <button onClick={handleSave} disabled={!form.audit_date || !form.audit_type} className={BTN.primary}>
                {editingId ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
