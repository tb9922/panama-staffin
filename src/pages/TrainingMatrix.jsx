import { useState, useMemo, useEffect, useRef } from 'react';
import { isCareRole, formatDate } from '../lib/rotation.js';
import { getTrainingTypes, ensureTrainingDefaults, buildComplianceMatrix, getComplianceStats, calculateExpiry, TRAINING_METHODS, TRAINING_STATUS, STATUS_DISPLAY } from '../lib/training.js';
import { downloadXLSX } from '../lib/excel.js';
import { CARD, TABLE, INPUT, BTN, BADGE, MODAL } from '../lib/design.js';

const TEAMS = ['Day A', 'Day B', 'Night A', 'Night B', 'Float'];

const CELL_COLORS = {
  compliant:     'bg-emerald-200 text-emerald-800 hover:bg-emerald-300 cursor-pointer hover:shadow-sm',
  expiring_soon: 'bg-amber-200 text-amber-800 hover:bg-amber-300 cursor-pointer hover:shadow-sm',
  urgent:        'bg-red-200 text-red-800 hover:bg-red-300 cursor-pointer hover:shadow-sm',
  expired:       'bg-red-300 text-red-900 hover:bg-red-400 cursor-pointer hover:shadow-sm',
  not_started:   'bg-gray-100 text-gray-400 border border-dashed border-gray-300 hover:bg-gray-200 cursor-pointer hover:shadow-sm',
  not_required:  'bg-white text-gray-300 cursor-default opacity-30',
};

export default function TrainingMatrix({ data, updateData }) {
  const [view, setView] = useState('matrix');
  const [filterTeam, setFilterTeam] = useState('All');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterCompliance, setFilterCompliance] = useState('all');
  const [search, setSearch] = useState('');
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [modalData, setModalData] = useState({ staffId: '', typeId: '', completed: '', trainer: '', method: 'classroom', certificate_ref: '', notes: '', existing: false });
  const [showManageTypes, setShowManageTypes] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const initRef = useRef(false);

  // Ensure defaults on first load
  useEffect(() => {
    if (initRef.current) return;
    const updated = ensureTrainingDefaults(data);
    if (updated) {
      initRef.current = true;
      updateData(updated);
    }
  }, [data]);

  const today = new Date();
  const trainingTypes = useMemo(() => getTrainingTypes(data.config).filter(t => t.active), [data.config]);
  const activeStaff = useMemo(() => data.staff.filter(s => s.active !== false), [data.staff]);
  const trainingData = data.training || {};

  const matrix = useMemo(() => buildComplianceMatrix(activeStaff, trainingTypes, trainingData, today), [activeStaff, trainingTypes, trainingData]);
  const stats = useMemo(() => getComplianceStats(matrix), [matrix]);

  // Filtered types
  const filteredTypes = useMemo(() => {
    if (filterCategory === 'all') return trainingTypes;
    return trainingTypes.filter(t => t.category === filterCategory);
  }, [trainingTypes, filterCategory]);

  // Filtered staff
  const filteredStaff = useMemo(() => {
    let list = activeStaff;
    if (filterTeam !== 'All') list = list.filter(s => s.team === filterTeam);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }
    if (filterCompliance === 'non-compliant') {
      list = list.filter(s => {
        const staffMap = matrix.get(s.id);
        if (!staffMap) return false;
        for (const [, r] of staffMap) {
          if (r.status === TRAINING_STATUS.EXPIRED || r.status === TRAINING_STATUS.URGENT || r.status === TRAINING_STATUS.NOT_STARTED) return true;
        }
        return false;
      });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [activeStaff, filterTeam, search, filterCompliance, matrix]);

  function openRecordModal(staffId, typeId) {
    const existing = trainingData[staffId]?.[typeId];
    if (existing) {
      setModalData({ staffId, typeId, completed: existing.completed, trainer: existing.trainer || '', method: existing.method || 'classroom', certificate_ref: existing.certificate_ref || '', notes: existing.notes || '', existing: true });
    } else {
      setModalData({ staffId, typeId, completed: formatDate(today), trainer: '', method: 'classroom', certificate_ref: '', notes: '', existing: false });
    }
    setShowRecordModal(true);
  }

  function handleSaveRecord() {
    const type = trainingTypes.find(t => t.id === modalData.typeId);
    if (!type || !modalData.staffId || !modalData.completed) return;
    const newTraining = JSON.parse(JSON.stringify(trainingData));
    if (!newTraining[modalData.staffId]) newTraining[modalData.staffId] = {};
    newTraining[modalData.staffId][modalData.typeId] = {
      completed: modalData.completed,
      expiry: calculateExpiry(modalData.completed, type.refresher_months),
      trainer: modalData.trainer,
      method: modalData.method,
      certificate_ref: modalData.certificate_ref,
      notes: modalData.notes,
    };
    updateData({ ...data, training: newTraining });
    setShowRecordModal(false);
  }

  function handleDeleteRecord() {
    if (!confirm('Remove this training record?')) return;
    const newTraining = JSON.parse(JSON.stringify(trainingData));
    if (newTraining[modalData.staffId]) {
      delete newTraining[modalData.staffId][modalData.typeId];
      if (Object.keys(newTraining[modalData.staffId]).length === 0) delete newTraining[modalData.staffId];
    }
    updateData({ ...data, training: newTraining });
    setShowRecordModal(false);
  }

  // Auto-calculated expiry for modal
  const modalExpiry = useMemo(() => {
    if (!modalData.completed || !modalData.typeId) return '';
    const type = trainingTypes.find(t => t.id === modalData.typeId);
    if (!type) return '';
    return calculateExpiry(modalData.completed, type.refresher_months);
  }, [modalData.completed, modalData.typeId, trainingTypes]);

  // Per-staff compliance %
  function staffCompliancePct(staffId) {
    const staffMap = matrix.get(staffId);
    if (!staffMap) return 100;
    let required = 0, compliant = 0;
    for (const [, r] of staffMap) {
      if (r.status === TRAINING_STATUS.NOT_REQUIRED) continue;
      required++;
      if (r.status === TRAINING_STATUS.COMPLIANT || r.status === TRAINING_STATUS.EXPIRING_SOON) compliant++;
    }
    return required > 0 ? Math.round((compliant / required) * 100) : 100;
  }

  // Training type management
  function addTrainingType() {
    const id = 'custom-' + Date.now();
    const types = [...getTrainingTypes(data.config), { id, name: 'New Training', category: 'mandatory', refresher_months: 12, roles: null, legislation: '', active: true }];
    updateData({ ...data, config: { ...data.config, training_types: types } });
  }

  function updateTrainingType(id, field, value) {
    const types = getTrainingTypes(data.config).map(t => t.id === id ? { ...t, [field]: value } : t);
    updateData({ ...data, config: { ...data.config, training_types: types } });
  }

  function removeTrainingType(id) {
    if (!confirm('Remove this training type? Existing records will be kept.')) return;
    const types = getTrainingTypes(data.config).filter(t => t.id !== id);
    updateData({ ...data, config: { ...data.config, training_types: types } });
  }

  // Excel export
  function handleExport() {
    const headers = ['Name', 'Team', 'Role', ...filteredTypes.map(t => t.name)];
    const rows = filteredStaff.map(s => {
      const staffMap = matrix.get(s.id);
      return [s.name, s.team, s.role, ...filteredTypes.map(t => {
        const r = staffMap?.get(t.id);
        if (!r) return '';
        if (r.status === TRAINING_STATUS.NOT_REQUIRED) return 'N/A';
        if (r.status === TRAINING_STATUS.NOT_STARTED) return 'Not Started';
        return r.record ? `${r.record.completed} (exp: ${r.record.expiry})` : r.status;
      })];
    });
    downloadXLSX('training_matrix', [{ name: 'Training Matrix', headers, rows }]);
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Print header */}
      <div className="hidden print:block print-header">
        <h1 className="text-xl font-bold">{data.config.home_name} — Training Matrix</h1>
        <p className="text-xs text-gray-500">Printed: {new Date().toLocaleDateString('en-GB')}</p>
      </div>

      <div className="flex items-center justify-between mb-5 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Training Matrix</h1>
          <p className="text-xs text-gray-500 mt-1">CQC Regulation 18 — Mandatory training compliance</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className={BTN.secondary}>Export Excel</button>
          <button onClick={() => window.print()} className={BTN.secondary}>Print</button>
          <button onClick={() => setView(view === 'matrix' ? 'list' : 'matrix')} className={BTN.secondary}>
            {view === 'matrix' ? 'List View' : 'Grid View'}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="rounded-xl p-3 bg-emerald-50 border border-emerald-200">
          <div className="text-xs font-medium text-emerald-600">Compliance</div>
          <div className={`text-2xl font-bold mt-0.5 ${stats.compliancePct >= 90 ? 'text-emerald-700' : stats.compliancePct >= 70 ? 'text-amber-700' : 'text-red-700'}`}>{stats.compliancePct}%</div>
          <div className="text-[10px] text-emerald-500">{stats.compliant}/{stats.totalRequired} items</div>
        </div>
        <div className="rounded-xl p-3 bg-red-50 border border-red-200">
          <div className="text-xs font-medium text-red-600">Expired</div>
          <div className="text-2xl font-bold text-red-700 mt-0.5">{stats.expired}</div>
          <div className="text-[10px] text-red-400">require immediate action</div>
        </div>
        <div className="rounded-xl p-3 bg-amber-50 border border-amber-200">
          <div className="text-xs font-medium text-amber-600">Expiring Soon</div>
          <div className="text-2xl font-bold text-amber-700 mt-0.5">{stats.expiringSoon + stats.urgent}</div>
          <div className="text-[10px] text-amber-400">within 60 days</div>
        </div>
        <div className="rounded-xl p-3 bg-gray-50 border border-gray-200">
          <div className="text-xs font-medium text-gray-500">Not Started</div>
          <div className="text-2xl font-bold text-gray-700 mt-0.5">{stats.notStarted}</div>
          <div className="text-[10px] text-gray-400">no record yet</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap print:hidden">
        <input type="text" placeholder="Search staff..." value={search} onChange={e => setSearch(e.target.value)} className={`${INPUT.sm} w-44`} />
        <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="All">All Teams</option>
          {TEAMS.map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="all">All Categories</option>
          <option value="statutory">Statutory</option>
          <option value="mandatory">Mandatory</option>
        </select>
        <select value={filterCompliance} onChange={e => setFilterCompliance(e.target.value)} className={`${INPUT.select} w-auto`}>
          <option value="all">All Staff</option>
          <option value="non-compliant">Non-Compliant Only</option>
        </select>
        <span className="text-xs text-gray-400 self-center">{filteredStaff.length} staff | {filteredTypes.length} training types</span>
      </div>

      {/* Matrix View */}
      {view === 'matrix' && (
        <div className={CARD.flush}>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-2 px-2 text-left font-semibold text-gray-600 sticky left-0 bg-white z-10 min-w-[140px]">Staff</th>
                  {filteredTypes.map(t => (
                    <th key={t.id} className="py-2 px-0.5 text-center font-medium text-gray-600" style={{ minWidth: '80px', maxWidth: '120px', fontSize: '10px', lineHeight: '1.2' }}>
                      {t.name}
                    </th>
                  ))}
                  <th className="py-2 px-2 text-center font-semibold text-gray-600 min-w-[50px]">%</th>
                </tr>
              </thead>
              <tbody>
                {filteredStaff.map(s => {
                  const staffMap = matrix.get(s.id);
                  const pct = staffCompliancePct(s.id);
                  return (
                    <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50/30">
                      <td className="py-1 px-2 font-medium text-gray-800 sticky left-0 bg-white z-10">
                        <div>{s.name}</div>
                        <div className="text-[9px] text-gray-400">{s.team} · {s.role}</div>
                      </td>
                      {filteredTypes.map(t => {
                        const r = staffMap?.get(t.id);
                        if (!r) return <td key={t.id} className="py-1 px-0.5 text-center"><div className="w-full h-9" /></td>;
                        const display = STATUS_DISPLAY[r.status];
                        return (
                          <td key={t.id} className="py-1 px-0.5 text-center">
                            <button
                              onClick={() => r.status !== TRAINING_STATUS.NOT_REQUIRED && openRecordModal(s.id, t.id)}
                              disabled={r.status === TRAINING_STATUS.NOT_REQUIRED}
                              className={`w-full h-9 rounded-lg text-[10px] font-bold flex items-center justify-center transition-all ${CELL_COLORS[r.status]}`}
                              title={`${s.name} — ${t.name}: ${display.label}${r.daysUntilExpiry != null ? ` (${r.daysUntilExpiry}d)` : ''}`}
                            >
                              {display.symbol}
                            </button>
                          </td>
                        );
                      })}
                      <td className="py-1 px-2 text-center">
                        <span className={`text-xs font-bold ${pct >= 90 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-red-600'}`}>{pct}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredStaff.length === 0 && <div className="p-8 text-center text-sm text-gray-400">No staff match the current filters</div>}
        </div>
      )}

      {/* List View */}
      {view === 'list' && (
        <div className="space-y-2">
          {filteredStaff.map(s => {
            const staffMap = matrix.get(s.id);
            const pct = staffCompliancePct(s.id);
            const isExpanded = expanded === s.id;
            return (
              <div key={s.id} className={CARD.padded}>
                <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(isExpanded ? null : s.id)}>
                  <div>
                    <span className="font-medium text-gray-900">{s.name}</span>
                    <span className="text-xs text-gray-400 ml-2">{s.team} · {s.role}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold ${pct >= 90 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-red-600'}`}>{pct}%</span>
                    <span className="text-gray-400 text-xs">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                  </div>
                </div>
                {isExpanded && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {filteredTypes.map(t => {
                        const r = staffMap?.get(t.id);
                        if (!r || r.status === TRAINING_STATUS.NOT_REQUIRED) return null;
                        const display = STATUS_DISPLAY[r.status];
                        return (
                          <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 text-xs cursor-pointer hover:bg-gray-100 transition-colors"
                            onClick={() => openRecordModal(s.id, t.id)}>
                            <div>
                              <div className="font-medium text-gray-800">{t.name}</div>
                              {r.record && <div className="text-gray-400 mt-0.5">Completed: {r.record.completed} · Expires: {r.record.expiry}</div>}
                            </div>
                            <span className={BADGE[display.badgeKey]}>{display.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Manage Training Types */}
      <div className="mt-6 print:hidden">
        <button onClick={() => setShowManageTypes(!showManageTypes)} className={BTN.ghost}>
          {showManageTypes ? 'Hide' : 'Manage'} Training Types
        </button>
        {showManageTypes && (
          <div className={`mt-3 ${CARD.flush}`}>
            <table className={TABLE.table}>
              <thead className={TABLE.thead}>
                <tr>
                  <th className={TABLE.th}>Name</th>
                  <th className={TABLE.th}>Category</th>
                  <th className={TABLE.th}>Refresher</th>
                  <th className={TABLE.th}>Roles</th>
                  <th className={TABLE.th}>Legislation</th>
                  <th className={`${TABLE.th} text-center`}>Active</th>
                  <th className={TABLE.th}></th>
                </tr>
              </thead>
              <tbody>
                {getTrainingTypes(data.config).map(t => (
                  <tr key={t.id} className={`${TABLE.tr} ${!t.active ? 'opacity-50' : ''}`}>
                    <td className={`${TABLE.td} font-medium`}>
                      <input type="text" value={t.name} onChange={e => updateTrainingType(t.id, 'name', e.target.value)}
                        className="border border-gray-200 rounded px-1.5 py-0.5 text-xs w-full" />
                    </td>
                    <td className={TABLE.td}>
                      <select value={t.category} onChange={e => updateTrainingType(t.id, 'category', e.target.value)}
                        className="border border-gray-200 rounded px-1 py-0.5 text-xs">
                        <option value="statutory">Statutory</option>
                        <option value="mandatory">Mandatory</option>
                      </select>
                    </td>
                    <td className={TABLE.td}>
                      <div className="flex items-center gap-1">
                        <input type="number" min="1" max="60" value={t.refresher_months}
                          onChange={e => updateTrainingType(t.id, 'refresher_months', parseInt(e.target.value) || 12)}
                          className="border border-gray-200 rounded px-1 py-0.5 text-xs w-12" />
                        <span className="text-xs text-gray-400">mo</span>
                      </div>
                    </td>
                    <td className={`${TABLE.td} text-xs text-gray-500`}>{t.roles ? t.roles.join(', ') : 'All'}</td>
                    <td className={`${TABLE.td} text-xs text-gray-400`}>{t.legislation || '-'}</td>
                    <td className={`${TABLE.td} text-center`}>
                      <input type="checkbox" checked={t.active} onChange={e => updateTrainingType(t.id, 'active', e.target.checked)} />
                    </td>
                    <td className={TABLE.td}>
                      {t.id.startsWith('custom-') && (
                        <button onClick={() => removeTrainingType(t.id)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-3">
              <button onClick={addTrainingType} className={`${BTN.secondary} ${BTN.sm}`}>+ Add Custom Type</button>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-[10px] text-gray-500 mt-4 print:hidden">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-200" /> Compliant</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-200" /> Expiring 30-60d</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-200" /> Urgent &lt;30d</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-300" /> Expired</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-100 border border-dashed border-gray-300" /> Not Started</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-50" /> N/A</span>
      </div>

      {/* Record Training Modal */}
      {showRecordModal && (
        <div className={MODAL.overlay} onClick={e => { if (e.target === e.currentTarget) setShowRecordModal(false); }}>
          <div className={MODAL.panelLg}>
            <h2 className={MODAL.title}>{modalData.existing ? 'Edit' : 'Record'} Training</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Staff Member</label>
                  <select value={modalData.staffId} onChange={e => setModalData({ ...modalData, staffId: e.target.value })} className={INPUT.select}>
                    {activeStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={INPUT.label}>Training Type</label>
                  <select value={modalData.typeId} onChange={e => setModalData({ ...modalData, typeId: e.target.value })} className={INPUT.select}>
                    {trainingTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Completion Date</label>
                  <input type="date" value={modalData.completed} onChange={e => setModalData({ ...modalData, completed: e.target.value })} className={INPUT.base} />
                </div>
                <div>
                  <label className={INPUT.label}>Expiry Date (auto)</label>
                  <input type="date" value={modalExpiry} disabled className={`${INPUT.base} bg-gray-50 text-gray-500`} />
                  {modalData.typeId && (() => {
                    const t = trainingTypes.find(x => x.id === modalData.typeId);
                    return t ? <p className="text-[10px] text-gray-400 mt-0.5">{t.refresher_months} months from completion</p> : null;
                  })()}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={INPUT.label}>Trainer / Provider</label>
                  <input type="text" value={modalData.trainer} onChange={e => setModalData({ ...modalData, trainer: e.target.value })}
                    className={INPUT.base} placeholder="Name or organisation" />
                </div>
                <div>
                  <label className={INPUT.label}>Method</label>
                  <select value={modalData.method} onChange={e => setModalData({ ...modalData, method: e.target.value })} className={INPUT.select}>
                    {TRAINING_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={INPUT.label}>Certificate Reference</label>
                <input type="text" value={modalData.certificate_ref} onChange={e => setModalData({ ...modalData, certificate_ref: e.target.value })}
                  className={INPUT.base} placeholder="e.g. FS-2025-042" />
              </div>
              <div>
                <label className={INPUT.label}>Notes</label>
                <input type="text" value={modalData.notes} onChange={e => setModalData({ ...modalData, notes: e.target.value })}
                  className={INPUT.base} placeholder="Optional notes" />
              </div>
            </div>
            <div className={MODAL.footer}>
              {modalData.existing && (
                <button onClick={handleDeleteRecord} className={`${BTN.danger} ${BTN.sm} mr-auto`}>Remove</button>
              )}
              <button onClick={() => setShowRecordModal(false)} className={BTN.ghost}>Cancel</button>
              <button onClick={handleSaveRecord} disabled={!modalData.staffId || !modalData.typeId || !modalData.completed}
                className={`${BTN.primary} disabled:opacity-50`}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
