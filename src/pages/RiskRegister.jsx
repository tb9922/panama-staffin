import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { CARD, BTN, BADGE, INPUT, MODAL, PAGE, TABLE } from '../lib/design.js';
import Modal from '../components/Modal.jsx';
import TabBar from '../components/TabBar.jsx';
import { useLiveDate } from '../hooks/useLiveDate.js';
import { downloadXLSX } from '../lib/excel.js';
import {
  getCurrentHome, getRisks, createRisk, updateRisk, deleteRisk, getLoggedInUser,
} from '../lib/api.js';
import {
  getRiskScore, getRiskBand, getRiskStats,
  RISK_CATEGORIES, LIKELIHOOD_LABELS, IMPACT_LABELS,
  RISK_SCORE_BANDS, RISK_STATUSES,
} from '../lib/riskRegister.js';
import useDirtyGuard from '../hooks/useDirtyGuard';

const TABS = [
  { id: 'details', label: 'Risk Details' },
  { id: 'actions', label: 'Actions' },
];

const EMPTY_FORM = {
  title: '', description: '', category: '', owner: '',
  likelihood: 1, impact: 1,
  controls: [],
  residual_likelihood: 1, residual_impact: 1,
  actions: [],
  last_reviewed: '', next_review: '', status: 'open',
};

// Band color mapping for the 5x5 heatmap cells
const HEATMAP_COLORS = {
  low:      { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300' },
  medium:   { bg: 'bg-amber-100',   text: 'text-amber-800',   border: 'border-amber-300' },
  high:     { bg: 'bg-red-100',     text: 'text-red-800',     border: 'border-red-300' },
  critical: { bg: 'bg-purple-100',  text: 'text-purple-800',  border: 'border-purple-300' },
};

export default function RiskRegister() {
  const isAdmin = getLoggedInUser()?.role === 'admin';
  const [risks, setRisks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  useDirtyGuard(showModal);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [activeTab, setActiveTab] = useState('details');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterBand, setFilterBand] = useState('');

  const home = getCurrentHome();

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const result = await getRisks(home);
      setRisks(Array.isArray(result.risks) ? result.risks : []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [home]);

  useEffect(() => { load(); }, [load]);

  const today = useLiveDate();

  const stats = useMemo(() => getRiskStats(risks, today), [risks, today]);

  // Sorted by risk_score descending (highest risk first), filtered
  const filtered = useMemo(() => {
    let list = [...risks].sort((a, b) => {
      const sa = a.risk_score || getRiskScore(a.likelihood, a.impact);
      const sb = b.risk_score || getRiskScore(b.likelihood, b.impact);
      return sb - sa;
    });
    if (filterCategory) list = list.filter(r => r.category === filterCategory);
    if (filterBand) {
      const band = RISK_SCORE_BANDS.find(b => b.id === filterBand);
      if (band) list = list.filter(r => {
        const score = r.risk_score || getRiskScore(r.likelihood, r.impact);
        return score >= band.min && score <= band.max;
      });
    }
    return list;
  }, [risks, filterCategory, filterBand]);

  // Build heatmap counts: key = "L-I" -> count of open risks at that likelihood x impact
  const heatmapCounts = useMemo(() => {
    const counts = {};
    for (const risk of risks) {
      if (risk.status === 'closed') continue;
      const key = `${risk.likelihood}-${risk.impact}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [risks]);

  // Auto-calc scores in the form
  const formInherentScore = getRiskScore(form.likelihood, form.impact);
  const formResidualScore = getRiskScore(form.residual_likelihood, form.residual_impact);

  function openAdd() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, last_reviewed: today, next_review: '' });
    setActiveTab('details');
    setShowModal(true);
  }

  function openEdit(risk) {
    setEditingId(risk.id);
    // Migrate legacy string controls to array format
    let controls = risk.controls || [];
    if (typeof controls === 'string') {
      controls = controls.trim() ? [{ description: controls, effectiveness: '' }] : [];
    }
    setForm({
      title: risk.title || '', description: risk.description || '',
      category: risk.category || '', owner: risk.owner || '',
      likelihood: risk.likelihood || 1, impact: risk.impact || 1,
      controls,
      residual_likelihood: risk.residual_likelihood || 1, residual_impact: risk.residual_impact || 1,
      actions: risk.actions || [],
      last_reviewed: risk.last_reviewed || '', next_review: risk.next_review || '',
      status: risk.status || 'open',
    });
    setActiveTab('details');
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.title || !form.category) return;
    const record = {
      ...form,
      risk_score: getRiskScore(form.likelihood, form.impact),
      residual_score: getRiskScore(form.residual_likelihood, form.residual_impact),
    };
    try {
      if (editingId) {
        await updateRisk(home, editingId, record);
      } else {
        await createRisk(home, record);
      }
      setShowModal(false);
      await load();
    } catch (e) {
      alert(e.message || 'Failed to save');
    }
  }

  async function handleDelete() {
    if (!editingId || !confirm('Delete this risk?')) return;
    try {
      await deleteRisk(home, editingId);
      setShowModal(false);
      await load();
    } catch (e) {
      alert(e.message || 'Failed to delete');
    }
  }

  function handleExport() {
    const rows = filtered.map(risk => {
      const catDef = RISK_CATEGORIES.find(c => c.id === risk.category);
      const band = getRiskBand(risk.risk_score || getRiskScore(risk.likelihood, risk.impact));
      const resBand = getRiskBand(risk.residual_score || getRiskScore(risk.residual_likelihood, risk.residual_impact));
      const statusDef = RISK_STATUSES.find(s => s.id === risk.status);
      const actionsDone = (risk.actions || []).filter(a => a.status === 'completed').length;
      const actionsTotal = (risk.actions || []).length;
      return [
        risk.title, catDef?.name || risk.category, risk.owner,
        risk.likelihood, risk.impact,
        risk.risk_score || getRiskScore(risk.likelihood, risk.impact), band.name,
        Array.isArray(risk.controls) ? risk.controls.map(c => c.description).join('; ') : (risk.controls || ''),
        risk.residual_likelihood, risk.residual_impact,
        risk.residual_score || getRiskScore(risk.residual_likelihood, risk.residual_impact), resBand.name,
        actionsTotal > 0 ? `${actionsDone}/${actionsTotal}` : '-',
        risk.last_reviewed, risk.next_review,
        statusDef?.name || risk.status,
      ];
    });
    downloadXLSX(`Risk_Register_${today}`, [{
      name: 'Risk Register',
      headers: ['Title', 'Category', 'Owner',
        'Likelihood', 'Impact', 'Inherent Score', 'Band',
        'Controls',
        'Residual L', 'Residual I', 'Residual Score', 'Residual Band',
        'Actions', 'Last Reviewed', 'Next Review', 'Status'],
      rows,
    }]);
  }

  const bandBadge = (score) => {
    const band = getRiskBand(score);
    return BADGE[band.badgeKey] || BADGE.gray;
  };
  const statusBadge = (status) => {
    const def = RISK_STATUSES.find(s => s.id === status);
    return def ? BADGE[def.badgeKey] : BADGE.gray;
  };

  if (loading) {
    return (
      <div className={PAGE.container}>
        <div className="text-sm text-gray-500 py-12 text-center">Loading risk register...</div>
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
          <h1 className={PAGE.title}>Risk Register</h1>
          <p className={PAGE.subtitle}>CQC Regulation 17 — Governance & Management</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className={`${BTN.secondary} ${BTN.sm}`}>Export Excel</button>
          {isAdmin && <button onClick={openAdd} className={BTN.primary}>+ New Risk</button>}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className={CARD.padded}>
          <div className="text-xs font-medium text-gray-500">Total Open Risks</div>
          <div className="text-2xl font-bold text-gray-900 mt-0.5">{stats.total}</div>
          <div className="text-[10px] text-gray-400">Excluding closed</div>
        </div>
        <div className={`${CARD.padded} ${stats.critical > 0 ? 'border-purple-200 bg-purple-50' : ''}`}>
          <div className={`text-xs font-medium ${stats.critical > 0 ? 'text-purple-600' : 'text-gray-500'}`}>Critical Risks</div>
          <div className={`text-2xl font-bold ${stats.critical > 0 ? 'text-purple-700' : 'text-gray-900'} mt-0.5`}>{stats.critical}</div>
          <div className="text-[10px] text-gray-400">Score 16-25</div>
        </div>
        <div className={`${CARD.padded} ${stats.reviewsOverdue > 0 ? 'border-red-200 bg-red-50' : ''}`}>
          <div className={`text-xs font-medium ${stats.reviewsOverdue > 0 ? 'text-red-600' : 'text-gray-500'}`}>Reviews Overdue</div>
          <div className={`text-2xl font-bold ${stats.reviewsOverdue > 0 ? 'text-red-700' : 'text-gray-900'} mt-0.5`}>{stats.reviewsOverdue}</div>
          <div className="text-[10px] text-gray-400">Past next review date</div>
        </div>
        <div className={`${CARD.padded} ${stats.actionsOverdue > 0 ? 'border-red-200 bg-red-50' : ''}`}>
          <div className={`text-xs font-medium ${stats.actionsOverdue > 0 ? 'text-red-600' : 'text-gray-500'}`}>Actions Overdue</div>
          <div className={`text-2xl font-bold ${stats.actionsOverdue > 0 ? 'text-red-700' : 'text-gray-900'} mt-0.5`}>{stats.actionsOverdue}</div>
          <div className="text-[10px] text-gray-400">Past due date</div>
        </div>
      </div>

      {/* 5x5 Risk Matrix Heatmap */}
      <div className={`${CARD.padded} mb-5`}>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Risk Matrix (Likelihood x Impact)</h2>
        <div className="flex gap-4">
          {/* Y-axis label */}
          <div className="flex flex-col items-center justify-center">
            <span className="text-[10px] font-medium text-gray-500 writing-mode-vertical"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
              LIKELIHOOD
            </span>
          </div>
          <div className="flex-1">
            {/* Grid: rows = likelihood 5 down to 1, cols = impact 1 to 5 */}
            <div className="grid grid-cols-6 gap-0.5" style={{ maxWidth: '420px' }}>
              {/* Header row: empty corner + impact labels */}
              <div />
              {IMPACT_LABELS.map(imp => (
                <div key={imp.value} className="text-center text-[10px] font-medium text-gray-500 pb-1">
                  {imp.value}
                </div>
              ))}
              {/* Rows: likelihood 5 (top) down to 1 (bottom) */}
              {[5, 4, 3, 2, 1].map(likelihood => (
                <React.Fragment key={likelihood}>
                  <div className="flex items-center justify-center text-[10px] font-medium text-gray-500 pr-1">
                    {likelihood}
                  </div>
                  {[1, 2, 3, 4, 5].map(impact => {
                    const score = likelihood * impact;
                    const band = getRiskBand(score);
                    const count = heatmapCounts[`${likelihood}-${impact}`] || 0;
                    const colors = HEATMAP_COLORS[band.id];
                    return (
                      <div key={`${likelihood}-${impact}`}
                        className={`flex items-center justify-center h-12 rounded border text-sm font-bold ${colors.bg} ${colors.text} ${colors.border}`}
                        title={`L${likelihood} x I${impact} = ${score} (${band.name})${count > 0 ? ` — ${count} risk${count > 1 ? 's' : ''}` : ''}`}>
                        {count > 0 ? count : ''}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
              {/* Bottom labels row */}
              <div />
              {IMPACT_LABELS.map(imp => (
                <div key={`blabel-${imp.value}`} className="text-center text-[9px] text-gray-400 pt-0.5">
                  {imp.name}
                </div>
              ))}
            </div>
            <div className="text-center text-[10px] font-medium text-gray-500 mt-1" style={{ maxWidth: '420px' }}>
              IMPACT
            </div>
            {/* Legend */}
            <div className="flex gap-3 mt-2">
              {RISK_SCORE_BANDS.map(band => {
                const colors = HEATMAP_COLORS[band.id];
                return (
                  <div key={band.id} className="flex items-center gap-1">
                    <div className={`w-3 h-3 rounded ${colors.bg} ${colors.border} border`} />
                    <span className="text-[10px] text-gray-500">{band.name} ({band.min}-{band.max})</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 print:hidden">
        <select className={`${INPUT.select} w-auto`} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value="">All Categories</option>
          {RISK_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={`${INPUT.select} w-auto`} value={filterBand} onChange={e => setFilterBand(e.target.value)}>
          <option value="">All Risk Bands</option>
          {RISK_SCORE_BANDS.map(b => <option key={b.id} value={b.id}>{b.name} ({b.min}-{b.max})</option>)}
        </select>
        <span className="text-xs text-gray-400 self-center">{filtered.length} risks</span>
      </div>

      {/* Risk Table */}
      <div className={CARD.flush}>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}>
              <tr>
                <th scope="col" className={TABLE.th}>Title</th>
                <th scope="col" className={TABLE.th}>Category</th>
                <th scope="col" className={TABLE.th}>Owner</th>
                <th scope="col" className={TABLE.th}>Inherent Score</th>
                <th scope="col" className={TABLE.th}>Residual Score</th>
                <th scope="col" className={TABLE.th}>Next Review</th>
                <th scope="col" className={TABLE.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} className={TABLE.empty}>No risks recorded</td></tr>
              )}
              {filtered.map(risk => {
                const catDef = RISK_CATEGORIES.find(c => c.id === risk.category);
                const inherent = risk.risk_score || getRiskScore(risk.likelihood, risk.impact);
                const residual = risk.residual_score || getRiskScore(risk.residual_likelihood, risk.residual_impact);
                const _inherentBand = getRiskBand(inherent);
                const _residualBand = getRiskBand(residual);
                const reviewOverdue = risk.next_review && risk.next_review < today;
                return (
                  <tr key={risk.id} className={`${TABLE.tr} ${isAdmin ? 'cursor-pointer' : ''}`} onClick={() => isAdmin && openEdit(risk)}>
                    <td className={TABLE.td}>
                      <div className="font-medium text-gray-900">{risk.title}</div>
                      {risk.description && <div className="text-xs text-gray-400 truncate max-w-xs">{risk.description}</div>}
                    </td>
                    <td className={TABLE.td}>{catDef?.name || risk.category}</td>
                    <td className={TABLE.td}>{risk.owner || '-'}</td>
                    <td className={TABLE.td}>
                      <span className={bandBadge(inherent)}>
                        {inherent} ({risk.likelihood}x{risk.impact})
                      </span>
                    </td>
                    <td className={TABLE.td}>
                      <span className={bandBadge(residual)}>
                        {residual} ({risk.residual_likelihood}x{risk.residual_impact})
                      </span>
                    </td>
                    <td className={TABLE.td}>
                      {risk.next_review ? (
                        <span className={reviewOverdue ? 'text-red-600 font-medium' : ''}>{risk.next_review}</span>
                      ) : <span className="text-gray-300">-</span>}
                    </td>
                    <td className={TABLE.td}><span className={statusBadge(risk.status)}>{RISK_STATUSES.find(s => s.id === risk.status)?.name || risk.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingId ? 'Edit Risk' : 'New Risk'} size="lg">
          <div className="max-h-[75vh] overflow-y-auto">
            {/* Tabs */}
            <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

            {/* Risk Details Tab */}
            {activeTab === 'details' && (
              <div className="space-y-3">
                <div>
                  <label className={INPUT.label}>Title *</label>
                  <input type="text" className={INPUT.base} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
                </div>
                <div>
                  <label className={INPUT.label}>Description</label>
                  <textarea className={`${INPUT.base} h-16`} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={INPUT.label}>Category *</label>
                    <select className={INPUT.select} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                      <option value="">Select...</option>
                      {RISK_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={INPUT.label}>Owner</label>
                    <input type="text" className={INPUT.base} value={form.owner} onChange={e => setForm({ ...form, owner: e.target.value })} />
                  </div>
                  <div>
                    <label className={INPUT.label}>Status</label>
                    <select className={INPUT.select} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                      {RISK_STATUSES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>

                {/* Inherent Risk */}
                <div className="border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Inherent Risk (before controls)</div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={INPUT.label}>Likelihood (1-5)</label>
                      <select className={INPUT.select} value={form.likelihood} onChange={e => setForm({ ...form, likelihood: Number(e.target.value) })}>
                        {LIKELIHOOD_LABELS.map(l => <option key={l.value} value={l.value}>{l.value} — {l.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={INPUT.label}>Impact (1-5)</label>
                      <select className={INPUT.select} value={form.impact} onChange={e => setForm({ ...form, impact: Number(e.target.value) })}>
                        {IMPACT_LABELS.map(i => <option key={i.value} value={i.value}>{i.value} — {i.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={INPUT.label}>Risk Score</label>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-lg font-bold ${bandBadge(formInherentScore)}`}>
                          {formInherentScore}
                        </span>
                        <span className="text-xs text-gray-400">{getRiskBand(formInherentScore).name}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={INPUT.label}>Controls / Mitigations</label>
                    <button type="button" className={`${BTN.ghost} ${BTN.xs}`}
                      onClick={() => setForm({ ...form, controls: [...form.controls, { description: '', effectiveness: '' }] })}>
                      + Add Control
                    </button>
                  </div>
                  {form.controls.length === 0 && <p className="text-xs text-gray-400">No controls recorded</p>}
                  {form.controls.map((ctrl, i) => (
                    <div key={i} className="border border-gray-200 rounded-lg p-2 mb-2 space-y-1.5">
                      <div className="flex gap-2">
                        <input type="text" className={`${INPUT.sm} flex-1`} placeholder="Control description" value={ctrl.description}
                          onChange={e => { const c = [...form.controls]; c[i] = { ...c[i], description: e.target.value }; setForm({ ...form, controls: c }); }} />
                        <button type="button" className="text-red-400 hover:text-red-600 text-xs px-1"
                          onClick={() => setForm({ ...form, controls: form.controls.filter((_, j) => j !== i) })}>Remove</button>
                      </div>
                      <select className={INPUT.sm} value={ctrl.effectiveness || ''}
                        onChange={e => { const c = [...form.controls]; c[i] = { ...c[i], effectiveness: e.target.value }; setForm({ ...form, controls: c }); }}>
                        <option value="">Effectiveness...</option>
                        <option value="effective">Effective</option>
                        <option value="partially_effective">Partially Effective</option>
                        <option value="ineffective">Ineffective</option>
                      </select>
                    </div>
                  ))}
                </div>

                {/* Residual Risk */}
                <div className="border-t border-gray-100 pt-3">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Residual Risk (after controls)</div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={INPUT.label}>Residual Likelihood (1-5)</label>
                      <select className={INPUT.select} value={form.residual_likelihood} onChange={e => setForm({ ...form, residual_likelihood: Number(e.target.value) })}>
                        {LIKELIHOOD_LABELS.map(l => <option key={l.value} value={l.value}>{l.value} — {l.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={INPUT.label}>Residual Impact (1-5)</label>
                      <select className={INPUT.select} value={form.residual_impact} onChange={e => setForm({ ...form, residual_impact: Number(e.target.value) })}>
                        {IMPACT_LABELS.map(i => <option key={i.value} value={i.value}>{i.value} — {i.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={INPUT.label}>Residual Score</label>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-lg font-bold ${bandBadge(formResidualScore)}`}>
                          {formResidualScore}
                        </span>
                        <span className="text-xs text-gray-400">{getRiskBand(formResidualScore).name}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Review Dates */}
                <div className="border-t border-gray-100 pt-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={INPUT.label}>Last Reviewed</label>
                      <input type="date" className={INPUT.base} value={form.last_reviewed} onChange={e => setForm({ ...form, last_reviewed: e.target.value })} />
                    </div>
                    <div>
                      <label className={INPUT.label}>Next Review</label>
                      <input type="date" className={INPUT.base} value={form.next_review} onChange={e => setForm({ ...form, next_review: e.target.value })} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Actions Tab */}
            {activeTab === 'actions' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-1">
                  <label className={INPUT.label}>Risk Actions</label>
                  <button type="button" className={`${BTN.ghost} ${BTN.xs}`}
                    onClick={() => setForm({ ...form, actions: [...form.actions, { id: 'act-' + Date.now(), description: '', owner: '', due_date: '', status: 'open', completed_date: '' }] })}>
                    + Add Action
                  </button>
                </div>
                {form.actions.length === 0 && <p className="text-xs text-gray-400">No actions recorded</p>}
                {form.actions.map((action, i) => (
                  <div key={action.id || i} className="border border-gray-200 rounded-lg p-2 mb-2 space-y-1.5">
                    <div className="flex gap-2">
                      <input type="text" className={`${INPUT.sm} flex-1`} placeholder="Action description" value={action.description}
                        onChange={e => { const a = [...form.actions]; a[i] = { ...a[i], description: e.target.value }; setForm({ ...form, actions: a }); }} />
                      <button type="button" className="text-red-400 hover:text-red-600 text-xs px-1"
                        onClick={() => setForm({ ...form, actions: form.actions.filter((_, j) => j !== i) })}>Remove</button>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <input type="text" className={INPUT.sm} placeholder="Owner" value={action.owner}
                        onChange={e => { const a = [...form.actions]; a[i] = { ...a[i], owner: e.target.value }; setForm({ ...form, actions: a }); }} />
                      <input type="date" className={INPUT.sm} title="Due date" value={action.due_date}
                        onChange={e => { const a = [...form.actions]; a[i] = { ...a[i], due_date: e.target.value }; setForm({ ...form, actions: a }); }} />
                      <input type="date" className={INPUT.sm} title="Completed date" value={action.completed_date}
                        onChange={e => { const a = [...form.actions]; a[i] = { ...a[i], completed_date: e.target.value }; setForm({ ...form, actions: a }); }} />
                      <select className={INPUT.sm} value={action.status}
                        onChange={e => { const a = [...form.actions]; a[i] = { ...a[i], status: e.target.value }; setForm({ ...form, actions: a }); }}>
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>
            {/* Footer */}
            <div className={MODAL.footer}>
              {editingId && isAdmin && (
                <button onClick={handleDelete} className={`${BTN.danger} ${BTN.sm} mr-auto`}>Delete</button>
              )}
              <button onClick={() => setShowModal(false)} className={BTN.ghost}>Cancel</button>
              {isAdmin && <button onClick={handleSave} disabled={!form.title || !form.category} className={BTN.primary}>
                {editingId ? 'Update' : 'Save'}
              </button>}
            </div>
      </Modal>
    </div>
  );
}
